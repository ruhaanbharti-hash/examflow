// Flo · pipeline
//   learner message
//     → understand intent                        (nlu.js)
//     → learner's ExamFlow context + profile     (context.js, profile.js — via the app bridge)
//     → trusted knowledge / learner's material   (knowledge.js, material.js)
//     → respond                                  (modes.js, tools.js; optional AI via smart.js)
//     → optionally act in ExamFlow               (actions.js, through the app's own save functions)
//
// The AI (Smart Study Mode) is optional. When it isn't available, every request still gets a
// useful, honest answer from ExamFlow's data, trusted notes and the learner's own material.

import { understand, contentPhrase, MATERIAL_REF } from "./nlu.js";
import { buildContext } from "./context.js";
import { LocalProvider } from "./provider.js";
import { parseProfileStatement } from "./profile.js";
import { focusText, search as searchMaterial, looksLikeSyllabus } from "./material.js";
import * as M from "./modes.js";
import * as X from "./tools.js";
import { clean, tokens, similar } from "./text.js";

const T = (text) => ({ type: "text", text });
const SMART_CHIP = "Turn on Smart mode";

export function createFlo({ bridge, knowledge, provider = LocalProvider, ai = null, materials = null, now = () => new Date(), random = Math.random }) {
  let knowledgeOk = null;

  async function ensureKnowledge() {
    if (knowledgeOk !== null) return knowledgeOk;
    try { await knowledge.init(); knowledgeOk = true; } catch (e) { console.warn("[Flo] knowledge library unavailable", e); knowledgeOk = false; }
    return knowledgeOk;
  }

  function context() { return buildContext(bridge.get(), bridge.helpers || {}, now()); }
  const aiUsable = () => !!(ai && ai.usable && ai.usable());
  const aiOffer = () => !!(ai && ai.supported && ai.supported() !== false && !(ai.enabled && ai.enabled()));

  async function handle(message, state) {
    state.turn = (state.turn || 0) + 1;
    state.hist = state.hist || [];
    const K = (await ensureKnowledge()) ? knowledge : null;
    let ctx = context();
    const c = clean(message);
    const AI = aiUsable();
    remember(state, "user", message);

    // Personal preferences: "always explain simply", "from now on keep it short".
    const pref = c.match(/\b(always|from now on|by default|in future)\b.*\b(simple|simply|simpler|detail|detailed|short|shorter|brief)\b/);
    if (pref) {
      const depth = /simple|simply|simpler/.test(pref[2]) ? "simple" : /detail/.test(pref[2]) ? "detailed" : "short";
      await bridge.act("updateFloPrefs", { depth });
      return reply(state, { blocks: [T(`Got it — I'll keep explanations **${depth}** from now on. You can still say "in detail" or "simpler" anytime.`)] });
    }
    if (/\b(reset|clear|forget)\b.*\b(preference|preferences|style)\b/.test(c)) {
      await bridge.act("updateFloPrefs", { depth: null });
      return reply(state, { blocks: [T("Done — back to my normal explanation style.")] });
    }

    // "I'm in class 7", "I'm preparing for JEE", "I'm a university student", "my board is ICSE"
    const ps = parseProfileStatement(message);
    let profileNotice = null;
    if (ps) {
      const cur = (ctx.student.prefs && ctx.student.prefs.profile) || {};
      await bridge.act("updateFloPrefs", { profile: { ...cur, ...ps } });
      ctx = context();
      const hasTask = /\b(explain|teach|quiz|notes?|revise|practice|summar|help me|what is|what are|why|how|plan|check)\b|\?/.test(c.replace(/\b(i am|im|i m) (preparing|studying) for\b/, ""));
      const msg = `Got it — I'll pitch things for **${ctx.student.profile.label || "you"}**. You can change this anytime in Flo's settings.`;
      if (!hasTask) return reply(state, { blocks: [T(msg)], chips: suggestions().slice(0, 3) });
      profileNotice = { type: "notice", tone: "info", text: msg };
    }

    if (/\bwhat (topics|chapters|subjects) do you (know|have|cover)\b|\bwhat can you explain\b|\byour (topics|notes|library)\b/.test(c) && K) {
      const r = M.topicsKnown({}, ctx, K);
      if (AI) r.blocks.push(T("With **Smart mode** on, I can also help with any other subject, course or topic — clearly labelled as AI-generated."));
      return reply(state, r);
    }

    const frame = understand(message, state, ctx, K);
    const docs = activeDocs(state);

    // Long pasted text becomes study material for this chat ("summarize this: …", a pasted syllabus…).
    const pastedSyllabus = message.length > 150 && message.split("\n").length >= 5 && looksLikeSyllabus(message);
    if (materials && (message.length > 700 || pastedSyllabus) && !["improve", "crisis"].includes(frame.intent)) {
      const body = message.replace(/^[^\n:]{0,80}:\s*/, "");
      const res = materials.add({ name: "Pasted text", text: body, kind: "paste" });
      if (res.ok) { attach(state, res.doc.id); docs.unshift(res.doc); if (!frame.intent || ["unknown", "doubt", "explain"].includes(frame.intent)) frame.intent = looksLikeSyllabus(body) ? "syllabus" : "summarize"; }
    }

    let r = await route(frame, state, ctx, K, AI, docs, message);
    if (profileNotice && r && r.blocks) r.blocks.unshift(profileNotice);
    return reply(state, r, frame);
  }

  async function route(frame, state, ctx, K, AI, docs, message) {
    const recentAI = state.focus && state.focus.aiTopic && (state.turn - (state.focus.turn || 0)) <= 4 ? state.focus : null;
    switch (frame.intent) {
      case "crisis": return M.crisis();
      case "yes":
        if (state.pending) { const p = state.pending; state.pending = null; return { blocks: [], run: p.action }; }
        return { blocks: [T("👍 What would you like to do next?")], chips: suggestions().slice(0, 3) };
      case "no": state.pending = null; return { blocks: [T("No problem. Anything else?")] };
      case "math": return M.math(frame);
      case "smartOn": return { blocks: [T(AI ? "Smart mode is already on ✨ Ask me anything." : "Opening Smart mode settings — you can turn it on there.")], openSettings: !AI, chips: AI ? suggestions().slice(0, 3) : [] };
      case "smartOff": return { blocks: [T("Smart mode is off. I'll use ExamFlow's trusted notes and your data only. You can turn it back on in settings anytime.")], smartOff: true };
      case "settings": return { blocks: [T("Opening your Flo settings.")], openSettings: true };
      case "plan":
        if (AI && !frame.exam && frame.content.length && !/\b(all|every|everything|my exams?)\b/.test(frame.c) && !ctx.upcoming.some((e) => clean(frame.raw).includes(clean(e.subject)))) {
          return aiJob(state, ctx, { tool: "examprep", input: contentPhrase(frame.raw) || frame.raw });
        }
        return M.plan(frame, ctx, K, provider, state);
      case "progress": return M.progress(frame, ctx, K);
      case "next": return M.next(frame, ctx, K);
      case "examInfo": return M.examInfo(frame, ctx);
      case "tasks": return M.tasks(frame, ctx);
      case "today": return M.today(frame, ctx);
      case "focus": return await M.focus(frame, ctx, K || nullKnowledge, provider, state);
      case "subject": return await M.subject(frame, ctx, K || nullKnowledge);
      case "general": return M.general(frame.general);
      case "greet": case "thanks": case "bye": case "who": case "help": return withSmart(M.smalltalk(frame.intent, ctx), frame.intent, AI);
    }

    // ---------- the learner's own material ----------
    const mat = materialRoute(frame, state, ctx, AI, docs);
    if (mat) return mat;

    // ---------- syllabus without material ----------
    if (frame.intent === "syllabus") return { blocks: [T("Sure — attach your syllabus (PDF or text) with the 📎 button, or paste it here, and I'll turn it into subjects and chapters in ExamFlow. You'll review everything before it's saved.")], openAttach: true };
    if (frame.intent === "summarize" && !frame.content.length) return { blocks: [T("What should I summarize? Attach a PDF or notes with the 📎 button, or paste the text here.")], openAttach: true };

    // ---------- ✍️ improve / check an answer ----------
    if (frame.intent === "improve") {
      const answer = extractAnswer(message);
      if (!answer || answer.split(/\s+/).length < 4) return { blocks: [T("Paste your answer (and the question, if you have it) and I'll check it. For example:\n\n*Check my answer: Q: What is photosynthesis? A: …*")] };
      if (AI) return aiJob(state, ctx, { tool: "improve", input: answer, question: extractQuestion(message), refs: trustedRefs(await safeResolve(frame, ctx, K, state, answer), K) });
      const local = K ? await X.improveLocal(frame, ctx, K, state, answer, extractQuestion(message)) : null;
      return local || offerSmart({ blocks: [T("Checking written answers needs **Smart mode**, and my trusted notes don't cover this topic. Tip: compare your answer with the textbook's definition, key terms and one example.")] });
    }

    // ---------- topic tools: explain, lesson, notes, quiz, revise, doubt, practice ----------
    const topicIntents = ["explain", "lesson", "notes", "quiz", "revise", "doubt", "practice", "restyle", "nextTopic", "summarize"];
    if (topicIntents.includes(frame.intent)) {
      if (frame.intent === "summarize") frame.intent = "notes";               // "summary of photosynthesis" = notes
      // Follow-ups on an AI answer ("simpler", "quiz me on this", "next lesson").
      if (recentAI && !frame.chapter && (!frame.content.length || frame.intent === "restyle" || /\b(it|this|that)\b/.test(frame.c))) {
        if (AI) {
          const tool = frame.intent === "restyle" ? "explain" : frame.intent === "lesson" || /next lesson/.test(frame.c) ? "lesson" : mapTool(frame.intent);
          const input = /next lesson/.test(frame.c) ? `the next lesson after "${recentAI.aiTopic}"` : recentAI.aiTopic;
          return aiJob(state, ctx, { tool, input, style: frame.style, count: frame.count });
        }
      }
      if (frame.intent === "restyle") return K ? await M.restyle(frame, ctx, K, provider, state) : offline();
      if (frame.intent === "nextTopic") return K ? await M.nextTopic(frame, ctx, K, provider, state) : offline();

      const t = K ? await M.resolveTopic(frame, ctx, K, state) : {};
      let trusted = !!(t.k && (t.topic || t.faq || (t.kMeta && (frame.chapter || namesChapterOnly(frame, t)))));
      // With Smart mode on, only a clear match in the trusted notes beats an AI answer
      // (e.g. "photosynthesis" merely mentioned inside the carbon-cycle topic isn't enough).
      if (trusted && AI && !frame.chapter && !frame.usedFocus) {
        const words = frame.content || [];
        const inTitle = t.topic && words.length && words.every((w) => tokens(t.topic.title).some((x) => similar(w, x)));
        const strong = (t.faq && t.faqHit && t.faqHit.nameCover >= 0.5) || inTitle || namesChapterOnly(frame, t);
        if (!strong) trusted = false;
      }
      const fits = trusted ? M.levelFits(ctx, t.k) : false;
      const mode = frame.intent === "lesson" ? "explain" : frame.intent;

      if (trusted && (fits || !AI) && mode !== "practice") {
        let r = await trustedResponder(mode, frame, ctx, K, state);
        if (r && r.unknown && AI) return aiJob(state, ctx, { tool: "answer", input: frame.raw, refs: trustedRefs(t, K), grounded: t.k ? "notes" : null });
        if (!fits && !state.levelNote && t.k && ctx.student.profile.isSet) {
          state.levelNote = true;
          r.blocks.push({ type: "notice", tone: "info", text: `These trusted notes are written for **Class ${t.k.class}**.${aiOffer() ? " Turn on Smart mode for explanations pitched at your level." : " Say \"in detail\" or \"simpler\" to adjust."}` });
        }
        return r;
      }
      if (mode === "practice" && trusted && fits && !AI) { const p = await X.practiceLocal(frame, ctx, K, state); if (p) return p; }

      if (AI && (frame.content.length || frame.chapter)) {
        const input = frame.chapter && !frame.content.length ? frame.chapter.name : askedTopic(frame);
        const tool = frame.intent === "lesson" ? "lesson" : frame.intent === "doubt" ? "answer" : mapTool(mode);
        const refs = trustedRefs(t, K);
        return aiJob(state, ctx, { tool, input: tool === "answer" ? frame.raw : input, style: frame.style, count: frame.count, refs, grounded: refs.length ? "notes" : null, examId: t.exam ? t.exam.id : null });
      }

      // No AI: trusted-only behaviour (clarify, or say honestly that there are no notes).
      if (mode === "practice") { const p = K ? await X.practiceLocal(frame, ctx, K, state) : null; if (p) return p; }
      const r = K ? await trustedResponder(mode === "practice" ? "quiz" : mode, frame, ctx, K, state) : offline();
      return offerSmart(r);
    }

    // ---------- anything else ----------
    if (AI && frame.raw.trim().split(/\s+/).length >= 2) return aiJob(state, ctx, { tool: "answer", input: frame.raw });
    return offerSmart(M.unknown(frame, ctx));
  }

  // ---------- material ----------
  function materialRoute(frame, state, ctx, AI, docs) {
    if (!docs.length) return null;
    const i = frame.intent;
    const refersToIt = MATERIAL_REF.test(frame.c) || /\b(this|it|that)\b/.test(frame.c) || !frame.content.length;
    const hits = searchMaterial(docs, frame.raw, { limit: 3 });
    const strong = hits[0] && hits[0].coverage >= 0.6;
    const name = docs[0].name;
    const matRefs = (query) => [{ label: `The learner's material: ${name}`, text: focusText(docs.map((d) => d.text).join("\n\n"), query, 5200) }];

    if (i === "syllabus") { const d = docs.find((x) => looksLikeSyllabus(x.text)) || docs[0]; return X.syllabusReply(d.text, ctx, { name: `**${d.name}**` }); }
    if (i === "summarize" && (refersToIt || strong)) return AI ? aiJob(state, ctx, { tool: "summarize", input: name, refs: matRefs(""), grounded: "material", title: name }) : X.summarizeLocal(docs);
    if (["notes", "quiz", "revise", "practice"].includes(i) && (refersToIt || strong) && !frame.chapter) {
      if (AI) return aiJob(state, ctx, { tool: i, input: frame.content.length ? contentPhrase(frame.raw) + ` (from my material "${name}")` : `my material "${name}"`, refs: matRefs(frame.raw), grounded: "material", count: frame.count, title: name });
      return i === "notes" ? X.summarizeLocal(docs) : X.materialCardsLocal(docs);
    }
    if (["explain", "doubt", "unknown", "lesson"].includes(i) && (strong || (MATERIAL_REF.test(frame.c)))) {
      if (AI) return aiJob(state, ctx, { tool: "answer", input: frame.raw, refs: matRefs(frame.raw), grounded: "material" });
      const local = X.materialAnswerLocal(docs, frame.raw);
      if (local) return local;
    }
    return null;
  }

  function activeDocs(state) {
    if (!materials) return [];
    return (state.materialIds || []).map((id) => materials.get(id)).filter(Boolean);
  }
  function attach(state, id) { state.materialIds = [id, ...(state.materialIds || []).filter((x) => x !== id)].slice(0, 3); }

  // ---------- helpers ----------
  async function trustedResponder(mode, frame, ctx, K, state) {
    switch (mode) {
      case "explain": return M.explain(frame, ctx, K, provider, state);
      case "notes": return M.notes(frame, ctx, K, provider, state);
      case "quiz": return M.quiz(frame, ctx, K, provider, state, random);
      case "revise": return M.revise(frame, ctx, K, provider, state);
      case "doubt": default: return M.doubt(frame, ctx, K, provider, state, provider);
    }
  }

  async function safeResolve(frame, ctx, K, state, text) {
    if (!K) return {};
    try { return await M.resolveTopic({ ...frame, raw: text, kHits: K.search(text, { classNum: ctx.student.classNum, limit: 6 }) }, ctx, K, state); } catch (e) { return {}; }
  }

  function trustedRefs(t, K) {
    if (!t || !t.k) return [];
    const src = `ExamFlow notes · ${t.k.class ? "Class " + t.k.class + " " : ""}${K ? K.subjectName(t.k.subject) : t.k.subject} › ${t.k.name}`;
    if (t.faq) return [{ label: src, text: `Q: ${t.faq.q}\nA: ${t.faq.a}` }];
    if (t.topic) return [{ label: `${src} › ${t.topic.title}`, text: [t.topic.explain || t.topic.simple, t.topic.deep, (t.topic.keyPoints || []).map((p) => "- " + p).join("\n")].filter(Boolean).join("\n\n") }];
    return [{ label: src, text: [t.k.summary, ...(t.k.topics || []).map((x) => `${x.title}: ${x.summary || ""}`), ...(t.k.revision || []).map((p) => "- " + p)].join("\n") }];
  }

  function aiJob(state, ctx, opts) {
    const history = state.hist.slice(0, -1);         // everything before this message
    const job = ai.job({ ...opts, ctx, history });
    const topic = opts.tool === "answer" ? (contentPhrase(opts.input) || opts.input).slice(0, 80) : String(opts.input).slice(0, 80);
    return { blocks: [], ai: job, focus: { aiTopic: topic, aiTool: opts.tool } };
  }

  function offerSmart(r) {
    if (!r || !aiOffer()) return r;
    const unknownish = r.unknown || (r.blocks || []).some((b) => b.type === "text" && /don't have (trusted notes|enough information)|won't guess|needs \*\*Smart mode\*\*/.test(b.text || ""));
    if (unknownish) r.chips = [SMART_CHIP, ...(r.chips || []).filter((x) => x !== SMART_CHIP)].slice(0, 4);
    return r;
  }

  function withSmart(r, kind, AI) {
    if (kind === "who") r.blocks = [T(`I'm **Flo**, ExamFlow's own study companion. I use your ExamFlow subjects, exams and progress, a library of trusted study notes, and any material you give me.${AI ? " **Smart mode** is on, so I can also help with any subject using an AI model that runs privately on your device — its answers are labelled as AI-generated." : " I don't use any outside chatbot, and if I don't know something, I'll tell you instead of guessing."}`)];
    if (kind === "help") {
      const list = r.blocks.find((b) => b.type === "list");
      if (list) list.items.push(
        { title: "🎯 Practice questions", meta: "Exam-style questions with answers to check" },
        { title: "✍️ Improve my answer", meta: "Paste your answer for feedback" },
        { title: "📚 Your material", meta: "Attach notes or a PDF to summarize, quiz or add a syllabus" },
        { title: "✨ Smart mode", meta: AI ? "On — any subject, any level" : "Optional AI for any subject (in settings)" });
    }
    return r;
  }

  function reply(state, r, frame) {
    if (r.focus) state.focus = { ...r.focus, turn: state.turn };
    state.pending = r.pending || null;
    if (frame) state.lastIntent = frame.intent;
    if (!r.ai) remember(state, "assistant", (r.blocks || []).map((b) => b.text || (b.items ? b.items.join("; ") : "")).filter(Boolean).join("\n").slice(0, 600));
    return r;
  }

  function remember(state, role, content) {
    if (!content) return;
    state.hist = [...(state.hist || []), { role, content: String(content).slice(0, 800) }].slice(-12);
  }

  // The UI calls this after an AI answer finishes, so follow-up questions have context.
  function afterAI(state, text) { remember(state, "assistant", text); }

  function offline() {
    return { blocks: [{ type: "notice", tone: "warn", text: "I couldn't load my study notes just now. Check your connection and try again — planning and progress still work." }], chips: ["Make a study plan", "Analyze my progress"] };
  }

  function finishQuiz(qz) {
    const ctx = context();
    const { result, reply: r } = M.quizFinished(qz, ctx);
    if (qz.examId && qz.chapterId) bridge.act("saveQuizResult", result);
    return r;
  }

  // Suggestions for the empty state, based on the learner's real situation and level.
  function suggestions() {
    let ctx;
    try { ctx = context(); } catch (e) { return ["What can you do?"]; }
    const s = [];
    const soon = ctx.upcoming[0];
    if (soon && soon.daysLeft <= 7) s.push(`My ${soon.subject} exam is ${soon.daysLeft === 1 ? "tomorrow" : "in " + soon.daysLeft + " days"} — make a plan`);
    if (ctx.exams.length) s.push("What should I study next?");
    if (ctx.needsRevision[0]) s.push(`Help me revise ${ctx.needsRevision[0].chapter.name}`);
    const learning = ctx.exams.flatMap((e) => e.chapters.filter((c) => c.status === "in_progress")).slice(0, 1);
    if (learning[0]) s.push(`Explain ${learning[0].name}`);
    if (aiUsable()) {
      const lvl = ctx.student.profile.level;
      const ideas = {
        primary: ["Explain the water cycle simply", "Quiz me on fractions"],
        middle: ["Explain photosynthesis", "Give me practice questions on ratios"],
        high: ["Explain Newton's laws of motion", "Practice questions on quadratic equations"],
        college: ["Explain supply and demand in detail", "Summarize my lecture notes"],
        competitive: ["Most important topics in thermodynamics", "Practice questions on organic chemistry"],
        course: ["Teach me the basics of Python", "Give me an exercise to practise"],
        self: ["Teach me the basics of Python", "Explain how the internet works"],
      }[lvl] || ["Teach me the basics of Python", "Explain photosynthesis"];
      s.push(...ideas);
    } else if (!ctx.exams.length) {
      s.push("What topics do you know?", "How do I stop procrastinating?", "Add my syllabus to ExamFlow");
    }
    if (ctx.exams.length) s.push("Analyze my progress");
    return [...new Set(s)].slice(0, 4);
  }

  function statusLine() {
    try {
      const ctx = context();
      const soon = ctx.upcoming[0];
      if (soon) return `${soon.subject} exam ${soon.daysLeft === 0 ? "today" : soon.daysLeft === 1 ? "tomorrow" : "in " + soon.daysLeft + " days"} · ${soon.percent}% ready`;
      if (ctx.exams.length) return `${ctx.exams.length} subjects · no upcoming exams`;
      return aiUsable() ? "Learn mode · ask me anything" : ctx.student.profile.label ? "Learn mode" : "Add your subjects to get started";
    } catch (e) { return ""; }
  }

  return { handle, finishQuiz, suggestions, statusLine, context, ensureKnowledge, afterAI, attach, get provider() { return provider; } };
}

// ---------- small text helpers ----------
function mapTool(mode) { return { explain: "explain", notes: "notes", quiz: "quiz", revise: "revise", practice: "practice", doubt: "answer" }[mode] || "answer"; }

function askedTopic(frame) {
  const p = M.askedPhrase(frame.raw).replace(/^(practice questions|practise questions|questions|problems|sample questions|worksheet|the basics of|basics of|an introduction to|introduction to|intro to)\s+(on|about|for|of)?\s*/i, "");
  return p || contentPhrase(frame.raw) || frame.raw;
}

function namesChapterOnly(frame, t) {
  // "explain Atoms and Molecules" → chapter overview is a trusted answer too.
  return !!(t.kMeta && frame.kHits && frame.kHits.some((h) => h.type === "chapter" && h.chapter.id === t.kMeta.id && h.nameCover >= 0.5));
}

function extractAnswer(message) {
  const m = String(message);
  const a = m.match(/(?:^|\n|\s)(?:a|ans|answer|my answer)\s*[:\-–]\s*([\s\S]+)$/i);
  if (a) return a[1].trim();
  const colon = m.indexOf(":");
  if (colon >= 0 && colon < 80) return m.slice(colon + 1).replace(/^\s*(q|question)\s*[:\-–][^\n]*\n/i, "").trim();
  const nl = m.indexOf("\n");
  return nl >= 0 ? m.slice(nl + 1).trim() : "";
}
function extractQuestion(message) {
  const q = String(message).match(/(?:^|\n|:\s*)(?:q|question)\s*[:\-–.]\s*([^\n]+?)(?=\s+(?:a|ans|answer|my answer)\s*[:\-–]|\n|$)/i);
  return q ? q[1].trim() : null;
}

const nullKnowledge = { index: null, subjectKeyFor: () => null, matchChapter: () => null, subjectName: (k) => k, load: async () => null, search: () => [] };
