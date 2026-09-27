// Flo · study modes
// Each responder turns an understood request + the student's data + trusted knowledge
// into a reply made of "blocks" (text, plan, quiz, notes, buttons…). No invented facts:
// if the knowledge library doesn't cover something, Flo says so.

import { pick, shuffle, plural } from "./text.js";
import { addDays, niceDate, STATUS_LABEL, daysBetween } from "./context.js";
import { buildPlan, planToSessions, itemLabel } from "./planner.js";
import { contentPhrase, contentTokens } from "./nlu.js";
import { tokens, similar } from "./text.js";

const R = (blocks, extra = {}) => ({ blocks: blocks.filter(Boolean), ...extra });
const T = (text) => ({ type: "text", text });
const btn = (label, action, opts = {}) => ({ label, action, ...opts });
const ask = (text) => ({ type: "ask", text });           // action: send a message as the student
const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`);
const SPACING = [1, 3, 7, 14, 30];

// ------------------------------------------------------------------ topic resolution
export async function resolveTopic(frame, ctx, K, state) {
  const out = { exam: frame.exam || null, chapter: frame.chapter || null, kMeta: null, k: null, topic: null, faq: null, confidence: 0 };
  const classNum = ctx.student.classNum;
  const subjectKey = frame.subjectKey || (out.exam && K ? K.subjectKeyFor(out.exam.subject) : null);
  out.subjectKey = subjectKey;
  if (!K || !K.index) return out;

  if (out.chapter) out.kMeta = K.matchChapter(out.chapter.name, { subjectKey, classNum });

  const hits = frame.kHits || [];
  const top = hits[0];
  // Did the student just name a whole chapter ("explain atoms and molecules")? Then stay at chapter level.
  const content = frame.content || contentTokens(frame.raw || "");
  const namesChapter = (meta) => {
    if (!meta || !content.length) return false;
    const names = [meta.name, ...(meta.aliases || [])].map((n) => tokens(n));
    return names.some((nt) => nt.length && content.every((c) => nt.some((t) => similar(c, t))));
  };
  if (top) {
    const sameCh = (h) => !out.kMeta || h.chapter.id === out.kMeta.id;
    const faq = hits.find((h) => h.type === "faq" && sameCh(h) && h.covers && (h.nameCover >= 0.4 || h.score >= 0.9));
    const topic = hits.find((h) => h.type === "topic" && sameCh(h) && h.covers && (h.nameCover >= 0.34 || h.score >= 0.8));
    const chap = hits.find((h) => h.type === "chapter" && h.covers && h.nameCover >= 0.5);
    if (!out.kMeta && chap) out.kMeta = chap.chapter;
    if (!out.kMeta && topic) out.kMeta = topic.chapter;
    if (!out.kMeta && faq) out.kMeta = faq.chapter;
    if (topic && out.kMeta && topic.chapter.id === out.kMeta.id && !namesChapter(out.kMeta)) { out.topicHit = topic; }
    if (faq && out.kMeta && faq.chapter.id === out.kMeta.id && !namesChapter(out.kMeta)) { out.faqHit = faq; }
    out.confidence = top.score;
  }

  // Follow-ups ("explain it simpler", "quiz me on this") reuse what we were just talking about.
  const f = frame.usedFocus ? frame.focusRef || state.focus : null;
  if (f && f.kChapterId) {
    if (!out.kMeta) out.kMeta = K.index.chapters.find((c) => c.id === f.kChapterId) || null;
    if (out.kMeta && out.kMeta.id === f.kChapterId && f.kTopicId && !out.topicHit) out.topicId = f.kTopicId;
  }

  if (out.kMeta) {
    out.k = await K.load(out.kMeta);
    if (out.k) {
      const tid = out.topicHit ? out.topicHit.topic.id : out.topicId;
      out.topic = tid ? (out.k.topics || []).find((t) => t.id === tid) || null : null;
      if (out.faqHit) out.faq = (out.k.faqs || []).find((f) => f.q === out.faqHit.faq.q) || out.faqHit.faq;
    }
    // Link back to the student's own chapter, so actions (revise, log, plan) attach correctly.
    if (!out.chapter) {
      for (const e of ctx.exams) {
        if (subjectKey && K.subjectKeyFor(e.subject) !== out.kMeta.subject) continue;
        const c = e.chapters.find((x) => { const m = K.matchChapter(x.name, { subjectKey: out.kMeta.subject, classNum }); return m && m.id === out.kMeta.id; });
        if (c) { out.exam = e; out.chapter = c; break; }
      }
    }
  }
  return out;
}

function sourceBlock(K, t) {
  if (!t.k) return null;
  const cls = t.k.class ? `Class ${t.k.class} ` : "";
  return { type: "source", text: `ExamFlow notes · ${cls}${K.subjectName(t.k.subject)} › ${t.k.name}${t.topic ? " › " + t.topic.title : ""}` };
}

function focusFrom(t, mode) {
  return { examId: t.exam ? t.exam.id : null, chapterId: t.chapter ? t.chapter.id : null, kChapterId: t.kMeta ? t.kMeta.id : null, kTopicId: t.topic ? t.topic.id : null, mode };
}

function levelStyle(ctx, frame) {
  if (frame.style) return frame.style;
  const p = ctx.student.prefs.depth;
  if (p) return p;
  // Pitch trusted notes at the learner's level: simple for younger learners, detailed for university / competitive exams.
  const d = (ctx.student.profile && ctx.student.profile.depth) || (ctx.student.classNum && ctx.student.classNum <= 7 ? "simple" : "standard");
  return d;
}

// Are these trusted notes written for roughly this learner's level?
export function levelFits(ctx, k) {
  const p = ctx.student.profile || {};
  if (!k || !k.class) return true;
  if (p.classNum) return Math.abs(p.classNum - k.class) <= 1;
  if (!p.level) return true;
  if (p.level === "high") return true;
  if (p.level === "primary" || p.level === "middle") return k.class <= 8;
  if (p.level === "college" || p.level === "competitive") return false;
  return true;
}

// When Flo needs to know which chapter/subject the student means.
function clarifyChapter(ctx, K, mode, frame) {
  if (frame.content && frame.content.length && !frame.exam) return noKnowledge(ctx, {}, mode, frame);
  if (frame.exam && K && K.index) {
    const key = K.subjectKeyFor(frame.exam.subject);
    const known = frame.exam.chapters.filter((c) => K.matchChapter(c.name, { subjectKey: key, classNum: ctx.student.classNum }));
    if (!known.length && ["explain", "notes", "quiz"].includes(mode)) {
      return R([T(`I don't have trusted notes for **${frame.exam.subject}** yet, so I can't ${mode === "quiz" ? "quiz you" : mode === "notes" ? "make notes" : "explain it"} without guessing. I can still plan it, track it and schedule revision.`)],
        { chips: [`Make a study plan for ${frame.exam.subject}`, `Analyze my ${frame.exam.subject} progress`, "What topics do you know?"] });
    }
  }
  const verb = { explain: "Explain", notes: "Make notes on", quiz: "Quiz me on", revise: "Help me revise", doubt: "Explain" }[mode] || "Explain";
  const opts = [];
  const pool = frame.exam ? [frame.exam] : ctx.upcoming.length ? ctx.upcoming : ctx.exams;
  pool.forEach((e) => e.chapters.forEach((c) => {
    const known = K && K.index ? !!K.matchChapter(c.name, { subjectKey: K.subjectKeyFor(e.subject), classNum: ctx.student.classNum }) : false;
    const pri = (c.status === "needs_revision" ? 3 : c.status === "in_progress" ? 2 : c.status === "not_started" ? 1 : 0) + (known ? 2 : 0) + (e.daysLeft != null && e.daysLeft >= 0 ? 3 / (1 + e.daysLeft) : 0);
    opts.push({ label: `${verb} ${c.name}`, pri });
  }));
  const chips = opts.sort((a, b) => b.pri - a.pri).slice(0, 5).map((o) => o.label);
  const which = frame.exam ? `Which ${frame.exam.subject} chapter?` : "Which chapter or topic?";
  const text = mode === "quiz" ? `Sure, let's quiz! ${which}` : mode === "notes" ? `Happy to make notes. ${which}` : mode === "revise" ? `Let's revise. ${which}` : `${which} Type it, or pick one:`;
  return R([T(text)], { chips, clarify: { mode } });
}

function askedPhrase(raw) {
  let p = String(raw || "").trim().replace(/[?!.]+$/, "");
  const lead = /^(please |pls |can you |could you |hey |flo,? )?(explain|what is|what are|what's|whats|tell me about|teach me|define|meaning of|describe|help me understand|make notes on|notes on|quiz me on|revise)\s+/i;
  for (let i = 0; i < 3 && lead.test(p); i++) p = p.replace(lead, "");
  return p.replace(/^(the|a|an)\s+/i, "").replace(/\s+(please|pls|plz|for me|simply|in detail)$/i, "").slice(0, 60);
}

function noKnowledge(ctx, t, mode, frame) {
  const name = t.chapter ? t.chapter.name : askedPhrase(frame.raw) || contentPhrase(frame.raw) || "that";
  const blocks = [T(`I don't have trusted notes for **${name}** yet, so I won't guess and risk teaching you something wrong.`)];
  const buttons = [];
  if (t.chapter && t.exam) {
    blocks.push(T(mode === "quiz"
      ? "What I can do for this chapter:\n- Put a revision session in your plan\n- Start a focus session on it\n- Show your textbook-based self-test method below"
      : "What still works well:\n- **Blurt method:** close the book, write everything you remember about it, then check and fill the gaps\n- **Make 5 questions** from the chapter headings and answer them without looking\n- **Teach it out loud** in 2 minutes"));
    buttons.push(btn("Schedule a revision", { type: "addRevision", examId: t.exam.id, chapterId: t.chapter.id, date: addDays(ctx.today, 1) }, { icon: "calendar" }));
    buttons.push(btn("Start focus on it", { type: "openFocus", examId: t.exam.id, chapterId: t.chapter.id }, { icon: "timer" }));
  }
  return R([...blocks, buttons.length && { type: "actions", buttons }], { chips: ["What should I study next?", "Analyze my progress"], focus: focusFrom(t, mode) });
}

// ------------------------------------------------------------------ 💡 Explain
export async function explain(frame, ctx, K, P, state) {
  const t = await resolveTopic(frame, ctx, K, state);
  if (!t.kMeta && !t.chapter) return clarifyChapter(ctx, K, "explain", frame);
  if (!t.k) return noKnowledge(ctx, t, "explain", frame);
  const style = levelStyle(ctx, frame);
  if (t.faq && (!t.topic || (t.faqHit && t.topicHit && t.faqHit.nameCover > t.topicHit.nameCover))) return doubt(frame, ctx, K, P, state);

  if (!t.topic) {
    // Whole chapter: overview + pick a topic.
    const lines = [`**${t.k.name}** — ${t.k.summary}`];
    if (style === "detailed") (t.k.topics || []).forEach((tp) => lines.push(`\n**${tp.title}**\n${P.present({ topic: tp, style: "short" })}`));
    const chips = (t.k.topics || []).slice(0, 5).map((tp) => `Explain ${tp.title}`);
    return R([sourceBlock(K, t), T(lines.join("\n")), T(style === "detailed" ? "" : "Pick a topic and I'll explain it properly:")].filter((b) => b && b.text !== ""),
      { chips: [...chips, `Notes on ${t.k.name}`, `Quiz me on ${t.k.name}`].slice(0, 6), focus: focusFrom(t, "explain") });
  }

  let body = P.present({ topic: t.topic, style });
  if (style === "example" && !body) body = `My notes don't have a worked example for this yet. Here's the idea again:\n\n${P.present({ topic: t.topic, style: "simple" })}`;
  const blocks = [sourceBlock(K, t), T(`**${t.topic.title}**\n\n${body}`)];
  if ((style === "standard" || style === "detailed") && t.topic.keyPoints && t.topic.keyPoints.length) blocks.push({ type: "keypoints", title: "Remember", items: t.topic.keyPoints });
  const chips = ["Explain simply", "Give an example", "In more detail", "Make notes on this", "Quiz me on this"].filter((c) => !(style === "simple" && c === "Explain simply") && !(style === "example" && c === "Give an example") && !(style === "detailed" && c === "In more detail"));
  return R(blocks, { chips, focus: focusFrom(t, "explain"), lastTopic: true });
}

// Restyle the last topic ("simpler", "give an example", "shorter").
export async function restyle(frame, ctx, K, P, state) {
  const f = state.focus || {};
  if (!f.kChapterId) return R([T("Sure — which topic should I explain again?")], { chips: ["What should I study next?"] });
  const meta = K.index.chapters.find((c) => c.id === f.kChapterId);
  const k = meta && (await K.load(meta));
  if (!k) return R([T("I lost track of that topic. Which one should I explain?")]);
  const topic = (k.topics || []).find((x) => x.id === f.kTopicId);
  if (!topic) return explain({ ...frame, usedFocus: true, kHits: [] }, ctx, K, P, state);
  const t = { k, kMeta: meta, topic, exam: f.examId ? ctx.findExam(f.examId) : null, chapter: f.examId && f.chapterId ? ctx.findChapter(f.examId, f.chapterId) : null };
  if (f.mode === "notes") return notes({ ...frame, usedFocus: true }, ctx, K, P, state, t);
  let body = P.present({ topic, style: frame.style });
  if (!body) body = `My notes don't have a worked example for this one yet. Here's the simple version:\n\n${P.present({ topic, style: "simple" })}`;
  const intro = { simple: "Simpler version:", detailed: "In more detail:", example: "An example:", short: "In short:" }[frame.style] || "";
  return R([sourceBlock(K, t), T(`**${topic.title}** · ${intro}\n\n${body}`)], { chips: ["Give an example", "Make notes on this", "Quiz me on this", "Explain the next topic"].filter((c) => !(frame.style === "example" && c === "Give an example")), focus: focusFrom(t, "explain") });
}

export async function nextTopic(frame, ctx, K, P, state) {
  const f = state.focus || {};
  const meta = K.index.chapters.find((c) => c.id === f.kChapterId);
  const k = meta && (await K.load(meta));
  if (!k) return R([T("Which topic should we do next?")], { chips: ["What should I study next?"] });
  const list = k.topics || [];
  const i = list.findIndex((x) => x.id === f.kTopicId);
  const nextT = list[i + 1];
  if (!nextT) return R([T(`That was the last topic in **${k.name}**. 🎉 Want to test yourself?`)], { chips: [`Quiz me on ${k.name}`, `Help me revise ${k.name}`, "What should I study next?"] });
  const t = { k, kMeta: meta, topic: nextT, exam: f.examId ? ctx.findExam(f.examId) : null, chapter: f.examId && f.chapterId ? ctx.findChapter(f.examId, f.chapterId) : null };
  const style = levelStyle(ctx, frame);
  const blocks = [sourceBlock(K, t), T(`**${nextT.title}**\n\n${P.present({ topic: nextT, style })}`)];
  if (style !== "simple" && nextT.keyPoints && nextT.keyPoints.length) blocks.push({ type: "keypoints", title: "Remember", items: nextT.keyPoints });
  return R(blocks, { chips: ["Explain simply", "Give an example", "Explain the next topic", "Quiz me on this"], focus: focusFrom(t, "explain") });
}

// ------------------------------------------------------------------ 📝 Notes
export async function notes(frame, ctx, K, P, state, preset) {
  const t = preset || (await resolveTopic(frame, ctx, K, state));
  if (!t.kMeta && !t.chapter) return clarifyChapter(ctx, K, "notes", frame);
  if (!t.k) return noKnowledge(ctx, t, "notes", frame);
  const short = frame.style === "short";
  const sections = [];
  if (/\bformula/.test(frame.c || "") && (t.k.formulas || []).length) {
    const plainF = `📐 ${t.k.name}: formulas\n\n` + t.k.formulas.map((f) => "• " + f).join("\n");
    return R([sourceBlock(K, t), { type: "notes", title: `${t.k.name}: formulas`, sections: [{ h: "Formulas", items: t.k.formulas }] }, { type: "actions", buttons: [btn("Save to my Notes", { type: "addNote", text: plainF, examId: t.exam ? t.exam.id : null }, { icon: "save", primary: true })] }], { chips: [`Quiz me on ${t.k.name}`, `Explain ${t.k.name}`], focus: focusFrom(t, "notes") });
  }
  const topics = t.topic ? [t.topic] : t.k.topics || [];
  if (!t.topic && t.k.summary) sections.push({ h: "In one line", items: [t.k.summary] });
  topics.forEach((tp) => sections.push({ h: tp.title, items: short ? [tp.summary || (tp.keyPoints || [])[0]].filter(Boolean) : (tp.keyPoints && tp.keyPoints.length ? tp.keyPoints : [tp.summary]).filter(Boolean) }));
  if (!t.topic && !short && (t.k.keyConcepts || []).length) sections.push({ h: "Key terms", items: t.k.keyConcepts.map((c) => `**${c.term}:** ${c.meaning}`) });
  if (!t.topic && (t.k.formulas || []).length) sections.push({ h: "Formulas", items: t.k.formulas });
  if (!t.topic && !short && (t.k.commonMistakes || []).length) sections.push({ h: "Common mistakes", items: t.k.commonMistakes });
  const title = t.topic ? `${t.topic.title} (${t.k.name})` : t.k.name;
  const plain = `📝 ${title}\n\n` + sections.map((s) => `${s.h.toUpperCase()}\n` + s.items.map((i) => "• " + String(i).replace(/\*\*/g, "")).join("\n")).join("\n\n");
  const buttons = [btn("Save to my Notes", { type: "addNote", text: plain, examId: t.exam ? t.exam.id : null }, { icon: "save", primary: true })];
  return R([sourceBlock(K, t), { type: "notes", title, sections }, { type: "actions", buttons }], { chips: [t.topic ? "Quiz me on this" : `Quiz me on ${t.k.name}`, "Make it shorter", "Help me revise this"], focus: focusFrom(t, "notes") });
}

// ------------------------------------------------------------------ 🧠 Quiz
export async function quiz(frame, ctx, K, P, state, rnd = Math.random) {
  const t = await resolveTopic(frame, ctx, K, state);
  if (!t.kMeta && !t.chapter) return clarifyChapter(ctx, K, "quiz", frame);
  if (!t.k || !(t.k.quiz || []).length) return noKnowledge(ctx, t, "quiz", frame);
  const count = Math.max(3, Math.min(10, frame.count || 5));
  let pool = t.k.quiz.map((q, i) => ({ ...q, _i: i }));
  if (t.topic) { const tp = pool.filter((q) => q.topic === t.topic.id); if (tp.length >= 3) pool = tp; }
  const lvl = /\b(easy|easier)\b/.test(frame.c) ? "easy" : /\b(hard|harder|difficult|tough)\b/.test(frame.c) ? "hard" : null;
  if (lvl) { const lp = pool.filter((q) => q.level === lvl); if (lp.length >= 3) pool = lp; }
  // Questions on topics the student got wrong last time come first.
  const last = t.chapter ? ctx.lastQuiz[t.chapter.id] : null;
  const weakTitles = new Set((last && last.weak) || []);
  const topicTitle = (id) => ((t.k.topics || []).find((x) => x.id === id) || {}).title || "";
  const ordered = shuffle(pool, rnd).sort((a, b) => (weakTitles.has(topicTitle(b.topic)) ? 1 : 0) - (weakTitles.has(topicTitle(a.topic)) ? 1 : 0));
  const questions = ordered.slice(0, count).map((q) => ({ q: q.q, options: q.options, answer: q.answer, explain: q.explain, topic: topicTitle(q.topic) }));
  const topicOnly = t.topic && pool.every((q) => q.topic === t.topic.id);
  const quizState = {
    id: "qz" + Date.now().toString(36), title: topicOnly ? t.topic.title : t.k.name, subject: t.exam ? t.exam.subject : K.subjectName(t.k.subject),
    examId: t.exam ? t.exam.id : null, chapterId: t.chapter ? t.chapter.id : null, chapterName: t.chapter ? t.chapter.name : t.k.name,
    questions, idx: 0, answers: [], done: false,
  };
  const intro = weakTitles.size ? `Here's a ${questions.length}-question quiz on **${quizState.title}**. I've included the areas you missed last time.` : `Here's a ${questions.length}-question quiz on **${quizState.title}**. Take your time!`;
  return R([sourceBlock(K, t), T(intro), { type: "quiz", quiz: quizState }], { focus: focusFrom(t, "quiz") });
}

// Called by the UI when a quiz is finished.
export function quizFinished(qz, ctx) {
  const correct = qz.answers.filter((a) => a.correct).length;
  const total = qz.questions.length;
  const percent = Math.round((correct / total) * 100);
  const weak = [...new Set(qz.questions.filter((q, i) => !(qz.answers[i] && qz.answers[i].correct)).map((q) => q.topic).filter(Boolean))];
  const result = { id: "flo" + Date.now().toString(36), at: new Date().toISOString(), examId: qz.examId, chapterId: qz.chapterId, subject: qz.subject, chapter: qz.chapterName, type: "flo", total, correct, percent, weak };
  const verdict = percent >= 85 ? "Excellent — you really know this. 🏆" : percent >= 60 ? "Solid! A little more practice and you've got it. 💪" : "This one needs more work — and that's exactly what practice is for.";
  const buttons = [];
  if (qz.examId && qz.chapterId) {
    if (percent >= 90) buttons.push(btn("Mark chapter as Mastered", { type: "setStatus", examId: qz.examId, chapterId: qz.chapterId, status: "mastered" }, { icon: "star" }));
    if (percent < 60) buttons.push(btn("Mark as Needs revision", { type: "setStatus", examId: qz.examId, chapterId: qz.chapterId, status: "needs_revision" }, { icon: "flag" }));
    buttons.push(btn(percent < 60 ? "Revise it tomorrow" : "Schedule a revision", { type: "addRevision", examId: qz.examId, chapterId: qz.chapterId, date: addDays(ctx.today, percent < 60 ? 1 : 3) }, { icon: "calendar" }));
  }
  const blocks = [T(`**You scored ${correct}/${total} (${percent}%).** ${verdict}`)];
  if (weak.length) blocks.push(T(`To work on: ${weak.map((w) => `**${w}**`).join(", ")}.`));
  if (qz.examId && qz.chapterId) blocks.push({ type: "notice", tone: "info", text: "Saved to your Practice history — ExamFlow uses it to suggest what to study next." });
  if (buttons.length) blocks.push({ type: "actions", buttons });
  const chips = weak.length ? [`Explain ${weak[0]}`, "Quiz me again", "Help me revise this"] : ["Quiz me again", "What should I study next?"];
  return { result, reply: R(blocks, { chips }) };
}

// ------------------------------------------------------------------ 🔄 Revise
export async function revise(frame, ctx, K, P, state) {
  const t = await resolveTopic(frame, ctx, K, state);
  if (!t.kMeta && !t.chapter) {
    // No chapter named: revise what ExamFlow says needs it most.
    const nr = ctx.needsRevision.slice(0, 4);
    if (nr.length) return R([T(`These are marked **Needs revision** in ExamFlow. Which one first?`)], { chips: nr.map((x) => `Help me revise ${x.chapter.name}`) });
    return clarifyChapter(ctx, K, "revise", frame);
  }
  const buttons = [];
  if (t.exam && t.chapter) {
    const next = SPACING[Math.min(SPACING.length - 1, Number(t.chapter.revisions) || 0)];
    buttons.push(btn("Log this revision ✓", { type: "markRevised", examId: t.exam.id, chapterId: t.chapter.id }, { icon: "check", primary: true }));
    buttons.push(btn(`Next revision ${inDays(next)}`, { type: "addRevision", examId: t.exam.id, chapterId: t.chapter.id, date: addDays(ctx.today, next) }, { icon: "calendar" }));
  }
  if (!t.k) {
    const r = noKnowledge(ctx, t, "revise", frame);
    if (buttons.length) r.blocks = [r.blocks[0], r.blocks[1], { type: "actions", buttons }];
    return r;
  }
  const points = t.topic ? t.topic.keyPoints || [] : t.k.revision || [];
  const cards = [];
  (t.k.keyConcepts || []).forEach((c) => cards.push({ front: `What is **${c.term}**?`, back: c.meaning }));
  (t.k.faqs || []).forEach((f) => cards.push({ front: f.q, back: f.a }));
  const blocks = [sourceBlock(K, t), T(`Quick revision: **${t.topic ? t.topic.title : t.k.name}**`), { type: "keypoints", title: "Must-know points", items: points }];
  if (cards.length) blocks.push({ type: "flashcards", title: "Test yourself — tap to flip", cards: shuffle(cards).slice(0, 5) });
  if (buttons.length) blocks.push({ type: "actions", buttons });
  return R(blocks, { chips: [`Quiz me on ${t.topic ? t.topic.title : t.k.name}`, "Make notes on this", "What should I study next?"], focus: focusFrom(t, "revise") });
}

// ------------------------------------------------------------------ ❓ Doubt
export async function doubt(frame, ctx, K, P, state, provider) {
  const t = await resolveTopic(frame, ctx, K, state);
  if (t.faq) {
    const blocks = [sourceBlock(K, t), T(`**${t.faq.q}**\n\n${t.faq.a}`)];
    return R(blocks, { chips: ["Explain simply", "Give an example", `Quiz me on ${t.k ? t.k.name : "this"}`].filter((c) => t.topic || !/Explain simply|Give an example/.test(c)), focus: focusFrom(t, "explain") });
  }
  if (t.topic) return explain(frame, ctx, K, P, state);
  // Not covered: try a stronger model if one is plugged in, grounded on the nearest notes.
  if (provider && provider.canAnswerOpenQuestions) {
    const grounding = [];
    if (t.k) (t.k.topics || []).forEach((tp) => grounding.push({ title: tp.title, text: tp.explain || tp.simple || "" }));
    const a = await provider.answer({ question: frame.raw, grounding, student: ctx.student });
    if (a && a.text && a.confident) return R([T(a.text), { type: "notice", tone: "warn", text: "Generated by Flo's AI model — double-check with your textbook." }], { chips: ["Explain simply", "Quiz me on this"] });
  }
  const near = (frame.kHits || []).filter((h) => h.type !== "faq").slice(0, 3);
  const blocks = [T(t.k
    ? `My notes on **${t.k.name}** don't cover that exact question, so I'd rather not guess.`
    : "I don't have enough information to answer that confidently, so I won't guess.")];
  if (near.length) blocks.push(T("These might be close to what you're asking:"));
  else blocks.push(T("Try asking your teacher, or check the chapter in your textbook. I can still help you plan, revise or quiz on chapters I have notes for."));
  const chips = near.map((h) => `Explain ${h.type === "topic" ? h.topic.title : h.chapter.name}`);
  return R(blocks, { chips: chips.length ? chips : ["What topics do you know?", "What should I study next?"], unknown: true });
}

// ------------------------------------------------------------------ 📅 Plan
export function plan(frame, ctx, K, P, state) {
  let targets = [];
  let assumed = null;
  const withDate = (e) => e && e.date && e.daysLeft >= 0;
  if (frame.exam) {
    if (withDate(frame.exam)) targets = [frame.exam];
    else if (frame.days != null && frame.days >= 1) {
      assumed = { ...frame.exam, date: addDays(ctx.today, frame.days), daysLeft: frame.days };
      targets = [assumed];
    } else if (frame.exam.date && frame.exam.daysLeft < 0) {
      return R([T(`Your **${frame.exam.subject}** exam date in ExamFlow (${niceDate(frame.exam.date)}) has already passed. If there's a new date, update it in **Exams** and I'll plan around it.`), { type: "actions", buttons: [btn("Open Exams", { type: "openPage", page: "exams" })] }]);
    } else {
      return R([T(`Your **${frame.exam.subject}** exam doesn't have a date in ExamFlow yet. When is it?`)], { chips: [`My ${frame.exam.subject} exam is in 3 days`, `My ${frame.exam.subject} exam is in 1 week`, `My ${frame.exam.subject} exam is in 2 weeks`] });
    }
  } else if (/\b(all|every|everything|whole|all my)\b/.test(frame.c) || ctx.upcoming.length === 1) {
    targets = ctx.upcoming.filter((e) => e.daysLeft <= 21);
    if (!targets.length) targets = ctx.upcoming.slice(0, 1);
  } else if (ctx.upcoming.length > 1) {
    const chips = ctx.upcoming.slice(0, 4).map((e) => `Make a study plan for ${e.subject}`);
    chips.push("Plan for all my exams");
    const soon = frame.days != null ? ctx.upcoming.filter((e) => Math.abs(e.daysLeft - frame.days) <= 1) : [];
    if (soon.length === 1) targets = soon;
    else return R([T("Which exam should I plan for?")], { chips, clarify: { mode: "plan" } });
  }
  if (!targets.length) {
    return R([T(ctx.exams.length ? "You don't have any upcoming exam dates in ExamFlow. Add a date in **Exams**, or tell me when it is (e.g. \"Science exam in 5 days\")." : "You haven't added any subjects yet. Add your exams in ExamFlow and I'll build a plan from your real syllabus."), { type: "actions", buttons: [btn("Open Exams", { type: "openPage", page: "exams" })] }]);
  }
  const t0 = targets[0];
  if (targets.length === 1 && t0.daysLeft === 0) {
    const left = t0.remaining.slice(0, 5).map((c) => c.name);
    return R([T(`Your **${t0.subject}** exam is **today** — no new chapters now. Last-minute game plan:\n- Skim your notes and key formulas for 30–40 minutes\n- Look only at headings, diagrams and definitions${left.length ? ` (especially ${left.slice(0, 2).join(", ")})` : ""}\n- Eat, drink water and reach early\n- In the exam: read the whole paper first, answer what you know first\n\nYou've got this. 💜`)], { chips: ["I feel stressed about exams"] });
  }

  const minutesPerDay = frame.hoursPerDay || null;
  const p = buildPlan(ctx, targets, { minutesPerDay });
  if (p.tooLate || !p.days.length) return R([T("There isn't a study day left before that exam. Focus on a calm quick revision today.")]);

  const blocks = [];
  const dataNote = frame.exam && frame.days != null && withDate(frame.exam) && Math.abs(frame.exam.daysLeft - frame.days) >= 1
    ? ` (ExamFlow has it on **${niceDate(frame.exam.date)}**, ${inDays(frame.exam.daysLeft)} — I've used that)` : "";
  const leftCount = targets.reduce((a, e) => a + e.remaining.length, 0);
  const needH = Math.round(p.needed / 60 * 10) / 10;
  if (targets.length === 1) {
    const e = t0;
    const ns = e.chapters.filter((c) => c.status === "not_started").length;
    const intro = assumed
      ? `Planning for your **${e.subject}** exam ${inDays(e.daysLeft)} (${niceDate(e.date)}) — it has no date in ExamFlow yet, so I used what you told me.`
      : `Your **${e.subject}** ${e.examName || "exam"} is ${inDays(e.daysLeft)} (${niceDate(e.date)})${dataNote}.`;
    const status = frame.notStarted && ns === e.chapters.length
      ? ` You haven't started any of its ${e.chapters.length} chapters yet — that's okay, let's be smart about it.`
      : ` You have **${plural(leftCount, "chapter")}** left (${e.done}/${e.chapters.length} done, ${e.percent}% ready).`;
    blocks.push(T(intro + status));
  } else {
    blocks.push(T(`Here's a combined plan for **${targets.map((e) => e.subject).join(", ")}** — ${plural(leftCount, "chapter")} left in total. Subjects with closer exams get more time.`));
  }

  if (!p.fits && !p.beyondHorizon) {
    const cut = p.unfit.slice(0, 4).map((x) => x.chapter ? x.chapter.name : x.exam.subject);
    blocks.push({ type: "notice", tone: "warn", text: `Honest check: that's about ${needH} hours of work, and at ${hm(p.minutesPerDay)} a day not everything fits. I've put the most important chapters first. Not yet planned: ${cut.join(", ")}${p.unfit.length > 4 ? "…" : ""}.${p.suggestMinutes ? ` To cover it all, aim for about ${hm(p.suggestMinutes)} a day.` : ""}` });
  } else if (p.beyondHorizon) {
    blocks.push({ type: "notice", tone: "info", text: `This covers the next ${p.days.length} days. Ask me again next week and I'll plan the rest.` });
  }

  const colorOf = (e) => e.color || "var(--indigo)";
  blocks.push({
    type: "plan",
    days: p.days.map((d) => ({ date: d.date, label: niceDate(d.date) + (d.date === ctx.today ? " · Today" : ""), minutes: d.minutes, items: d.items.map((it) => ({ time: `${it.start}–${it.end}`, title: itemLabel(it), subject: it.exam.subject, color: colorOf(it.exam), kind: it.kind })) })),
  });
  const tip = targets.length === 1 && t0.daysLeft <= 4 ? "Tip: study the hardest chapter when you're freshest, and do a 10-minute recap of yesterday's chapter before starting a new one." : "Tip: after each session, spend 5 minutes writing what you remember without looking. It's the fastest way to make it stick.";
  blocks.push(T(tip));

  const sessions = planToSessions(p, () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4));
  const buttons = [btn(`Add ${plural(sessions.length, "session")} to my Planner`, { type: "addSessions", sessions }, { icon: "calendar", primary: true })];
  const chips = [];
  [60, 120, 180].filter((m) => m !== p.minutesPerDay).slice(0, 2).forEach((m) => chips.push(`Plan ${targets.length === 1 ? "for " + t0.subject + " " : "all my exams "}with ${m / 60} hour${m === 60 ? "" : "s"} a day`));
  chips.push(targets.length === 1 ? `Quiz me on ${t0.remaining[0] ? t0.remaining[0].name : t0.subject}` : "Analyze my progress");
  return R([...blocks, { type: "actions", buttons }], { chips, pending: { label: "add the plan to your Planner", action: buttons[0].action }, focus: { examId: targets.length === 1 ? t0.id : null, mode: "plan" } });
}

// ------------------------------------------------------------------ 📊 Progress
export function progress(frame, ctx, K) {
  if (!ctx.exams.length) return R([T("You haven't added any subjects yet, so there's nothing to analyse. Add your exams and chapters and I'll track everything for you.")], { chips: ["How do I add an exam?"] });
  const blocks = [];
  if (frame.exam) {
    const e = frame.exam;
    const by = {};
    e.chapters.forEach((c) => { (by[c.status] = by[c.status] || []).push(c.name); });
    const weakQ = ctx.weakFromQuizzes.filter((w) => w.exam.id === e.id);
    blocks.push(T(`**${e.subject}:** ${e.percent}% ready · ${e.done}/${e.chapters.length} chapters done${e.date ? ` · exam ${inDays(e.daysLeft)} (${niceDate(e.date)})` : " · no exam date yet"}${e.pace ? ` · ${e.pace}` : ""}.`));
    blocks.push({ type: "progress", rows: [{ subject: e.subject, percent: e.percent, pace: e.pace, daysLeft: e.daysLeft, color: e.color }] });
    const lines = ["needs_revision", "in_progress", "not_started", "completed", "mastered"].filter((s) => by[s]).map((s) => `- **${STATUS_LABEL[s]}:** ${by[s].join(", ")}`);
    blocks.push(T(lines.join("\n")));
    if (weakQ.length) blocks.push(T(`Low quiz scores: ${weakQ.map((w) => `**${w.chapter.name}** (${w.q.percent}%)`).join(", ")}.`));
    return R(blocks, { chips: [`Make a study plan for ${e.subject}`, "What should I study next?", e.remaining[0] ? `Explain ${e.remaining[0].name}` : "Analyze my progress"], focus: { examId: e.id, mode: "progress" } });
  }
  const total = ctx.exams.reduce((a, e) => a + e.chapters.length, 0);
  const done = ctx.exams.reduce((a, e) => a + e.done, 0);
  const overall = total ? Math.round(ctx.exams.reduce((a, e) => a + e.percent * e.chapters.length, 0) / total) : 0;
  const goalWeek = ctx.student.dailyGoalMinutes * 7;
  blocks.push(T(`Here's where you stand${ctx.student.name ? ", " + ctx.student.name : ""}: **${overall}% overall** · ${done}/${total} chapters done · ${hm(ctx.weekMinutes)} studied this week (goal ${hm(goalWeek)})${ctx.streak ? ` · 🔥 ${ctx.streak}-day streak` : ""}.`));
  blocks.push({ type: "progress", rows: [...ctx.exams].sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)).map((e) => ({ subject: e.subject, percent: e.percent, pace: e.pace, daysLeft: e.daysLeft, color: e.color })) });
  const insights = [];
  const behind = ctx.upcoming.filter((e) => e.pace === "Behind Schedule");
  if (behind.length) insights.push(`🔴 **Behind schedule:** ${behind.map((e) => `${e.subject} (exam ${inDays(e.daysLeft)}, ${e.percent}% ready)`).join(", ")}`);
  const strong = ctx.exams.filter((e) => e.percent >= 70 && e.chapters.length);
  if (strong.length) insights.push(`🟢 **Going well:** ${strong.map((e) => e.subject).join(", ")}`);
  if (ctx.needsRevision.length) insights.push(`↻ **Needs revision:** ${ctx.needsRevision.slice(0, 4).map((x) => x.chapter.name).join(", ")}`);
  if (ctx.weakFromQuizzes.length) insights.push(`🧠 **Low quiz scores:** ${ctx.weakFromQuizzes.slice(0, 3).map((w) => `${w.chapter.name} (${w.q.percent}%)`).join(", ")}`);
  if (ctx.overdueTasks.length) insights.push(`⏰ **Overdue:** ${plural(ctx.overdueTasks.length, "task")}`);
  if (ctx.missedSessions.length) insights.push(`📅 **Missed sessions:** ${plural(ctx.missedSessions.length, "planned session")} not done`);
  if (ctx.weekMinutes < goalWeek * 0.5) insights.push(`⏱️ You've studied less than half your weekly goal — even 30 focused minutes a day adds up.`);
  if (insights.length) blocks.push(T(insights.join("\n")));
  const focusExam = behind[0] || ctx.upcoming[0];
  const chips = [];
  if (focusExam) chips.push(`Make a study plan for ${focusExam.subject}`);
  chips.push("What should I study next?");
  if (ctx.needsRevision[0]) chips.push(`Help me revise ${ctx.needsRevision[0].chapter.name}`);
  return R(blocks, { chips });
}

// ------------------------------------------------------------------ ➡️ What next
export function next(frame, ctx, K) {
  const picks = [];
  const seen = new Set();
  const add = (exam, chapter, why) => { if (!exam || !chapter || seen.has(chapter.id)) return; seen.add(chapter.id); picks.push({ exam, chapter, why }); };
  if (frame.exam) {
    frame.exam.remaining.slice().sort((a, b) => (a.status === "needs_revision" ? -1 : 0) - (b.status === "needs_revision" ? -1 : 0)).slice(0, 3).forEach((c) => add(frame.exam, c, c.status === "needs_revision" ? "needs revision" : c.status === "in_progress" ? "you've started it" : "not started yet"));
  } else {
    ctx.nextUp().forEach((p) => add(p.exam, p.chapter, `exam ${inDays(p.daysLeft)}`));
    ctx.weakFromQuizzes.forEach((w) => add(w.exam, w.chapter, `quiz score ${w.q.percent}%`));
    ctx.needsRevision.forEach((x) => add(x.exam, x.chapter, "marked needs revision"));
  }
  if (!picks.length) {
    return R([T(ctx.exams.length ? "Everything on your list is done — nice work! 🎉 Do a quick revision or a quiz to keep it fresh." : "Add your exams and chapters in ExamFlow and I'll tell you exactly what to study next.")], { chips: ctx.exams.length ? ["Quiz me", "Analyze my progress"] : ["How do I add an exam?"] });
  }
  const top = picks.slice(0, 3);
  const blocks = [T(`Here's what I'd study${frame.exam ? ` for ${frame.exam.subject}` : ""} next, based on your exam dates and progress:`)];
  blocks.push({ type: "list", items: top.map((p, i) => ({ title: `${i + 1}. ${p.chapter.name}`, meta: `${p.exam.subject} · ${STATUS_LABEL[p.chapter.status] || ""} · ${p.why}`, color: p.exam.color })) });
  const first = top[0];
  blocks.push({ type: "actions", buttons: [
    btn(`Start focus: ${first.chapter.name}`, { type: "openFocus", examId: first.exam.id, chapterId: first.chapter.id }, { icon: "timer", primary: true }),
    btn("Explain it first", ask(`Explain ${first.chapter.name}`), { icon: "bulb" }),
  ] });
  return R(blocks, { chips: [`Quiz me on ${first.chapter.name}`, `Make notes on ${first.chapter.name}`, "Make a study plan"], focus: { examId: first.exam.id, chapterId: first.chapter.id, mode: "next" } });
}

// ------------------------------------------------------------------ data questions
export function examInfo(frame, ctx) {
  if (frame.exam) {
    const e = frame.exam;
    if (!e.date) return R([T(`You haven't added a date for **${e.subject}** yet. Add it in **Exams** and I'll count down and plan for you.`), { type: "actions", buttons: [btn("Open Exams", { type: "openPage", page: "exams" })] }]);
    if (e.daysLeft < 0) return R([T(`Your **${e.subject}** exam was on ${niceDate(e.date)}. It's done! 🎉`)]);
    return R([T(`Your **${e.subject}** ${e.examName || "exam"} is on **${niceDate(e.date)}**${e.time && e.time !== "09:00" ? ` at ${e.time}` : ""} — ${e.daysLeft === 0 ? "that's **today**. You've got this!" : `**${plural(e.daysLeft, "day")}** to go`}. You're ${e.percent}% ready${e.pace ? ` (${e.pace})` : ""}.`)], { chips: [`Make a study plan for ${e.subject}`, `What should I study for ${e.subject}?`], focus: { examId: e.id, mode: "info" } });
  }
  if (!ctx.upcoming.length) return R([T(ctx.exams.length ? "You don't have any upcoming exam dates. Add them in **Exams** whenever you know them." : "You haven't added any exams yet.")], { chips: ["How do I add an exam?"] });
  return R([T("Your upcoming exams:"), { type: "progress", rows: ctx.upcoming.map((e) => ({ subject: `${e.subject}${e.examName ? " · " + e.examName : ""}`, percent: e.percent, pace: e.pace, daysLeft: e.daysLeft, color: e.color, date: niceDate(e.date) })) }], { chips: [`Make a study plan for ${ctx.upcoming[0].subject}`, "Plan for all my exams"] });
}

export function tasks(frame, ctx) {
  const list = [...ctx.overdueTasks.map((t) => ({ t, tag: "overdue" })), ...ctx.todayTasks.map((t) => ({ t, tag: "today" })), ...ctx.openTasks.filter((t) => t.dueDate && t.dueDate > ctx.today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((t) => ({ t, tag: "upcoming" }))];
  if (!list.length) return R([T("You have no open tasks. Clean slate! ✨")], { chips: ["What should I study next?"] });
  const items = list.slice(0, 6).map(({ t, tag }) => ({ title: t.title, meta: `${t.subject ? t.subject + " · " : ""}${tag === "overdue" ? "Overdue (" + niceDate(t.dueDate) + ")" : tag === "today" ? "Due today" : "Due " + niceDate(t.dueDate)}`, tone: tag === "overdue" ? "red" : tag === "today" ? "amber" : null }));
  const head = ctx.overdueTasks.length ? `You have **${plural(ctx.overdueTasks.length, "overdue task")}** — let's clear those first.` : `Here's what's on your list:`;
  return R([T(head), { type: "list", items }, { type: "actions", buttons: [btn("Open Tasks", { type: "openPage", page: "tasks" })] }]);
}

export function today(frame, ctx) {
  const items = [];
  ctx.busyOn(ctx.today).forEach((b) => items.push({ title: `${String(Math.floor(b.start / 60)).padStart(2, "0")}:${String(b.start % 60).padStart(2, "0")} ${b.title || ""}`, meta: b.kind === "session" ? "Study session" : b.kind || "", tone: b.kind === "session" ? "indigo" : null }));
  ctx.todayTasks.forEach((t) => items.push({ title: t.title, meta: "Task due today", tone: "amber" }));
  const free = ctx.freeSlotsOn(ctx.today, { notBefore: ctx.now.getHours() * 60 + ctx.now.getMinutes() }).reduce((a, s) => a + (s.end - s.start), 0);
  const blocks = [T(items.length ? "Here's your day:" : "Nothing is scheduled for today yet.")];
  if (items.length) blocks.push({ type: "list", items });
  if (free >= 30) blocks.push(T(`You have about **${hm(free)}** free for studying today.`));
  return R(blocks, { chips: ["What should I study next?", "Make a study plan"] });
}

export async function focus(frame, ctx, K, P, state) {
  const t = frame.chapter ? { exam: frame.exam, chapter: frame.chapter } : await resolveTopic(frame, ctx, K, state);
  const exam = t.exam || (ctx.nextUp()[0] || {}).exam;
  const chapter = t.chapter || (!t.exam ? (ctx.nextUp()[0] || {}).chapter : null);
  if (!exam) return R([T("Add a subject first, then I can start a focus session for it.")]);
  return R([T(`Ready to focus on **${chapter ? chapter.name : exam.subject}**? The focus timer will open — phone away, one task, go. 🎯`), { type: "actions", buttons: [btn("Start focus timer", { type: "openFocus", examId: exam.id, chapterId: chapter ? chapter.id : null }, { icon: "timer", primary: true })] }], { pending: { label: "start the focus timer", action: { type: "openFocus", examId: exam.id, chapterId: chapter ? chapter.id : null } } });
}

export async function subject(frame, ctx, K) {
  const e = frame.exam;
  const kKey = K && K.index ? K.subjectKeyFor(e.subject) : null;
  const known = kKey ? e.chapters.filter((c) => K.matchChapter(c.name, { subjectKey: kKey, classNum: ctx.student.classNum })).length : 0;
  const blocks = [T(`**${e.subject}** — ${e.percent}% ready, ${e.done}/${e.chapters.length} chapters done${e.date ? `, exam ${inDays(e.daysLeft)} (${niceDate(e.date)})` : ", no exam date yet"}.${known ? ` I have trusted notes for ${known} of its chapters.` : ""} What would you like to do?`)];
  return R(blocks, { chips: [`Make a study plan for ${e.subject}`, `What should I study for ${e.subject}?`, `Analyze my ${e.subject} progress`, e.remaining[0] ? `Explain ${e.remaining[0].name}` : `Quiz me on ${e.subject}`], focus: { examId: e.id, mode: "subject" } });
}

// ------------------------------------------------------------------ small talk, safety, maths
export function crisis() {
  return R([
    T("I'm really sorry you're feeling this way. You matter, and you don't have to handle this alone. 💜"),
    T("Please talk to someone right now — a parent, a teacher, or another adult you trust.\n\nIn India you can call **Tele-MANAS: 14416** (free, 24×7, many languages). If you're in immediate danger, call **112**."),
    T("I'm a study companion, so please reach out to a real person who can help. I'll be here for studying whenever you're ready."),
  ], { safety: true });
}

export function smalltalk(kind, ctx) {
  const name = ctx.student.name ? ` ${ctx.student.name}` : "";
  const soon = ctx.upcoming[0];
  switch (kind) {
    case "greet": return R([T(pick([`Hey${name}! 👋`, `Hi${name}!`, `Hey${name}, good to see you.`]) + (soon ? ` Your ${soon.subject} exam is ${inDays(soon.daysLeft)} — want a plan, or should we get studying?` : " What are we studying today?"))], { chips: soon ? [`Make a study plan for ${soon.subject}`, "What should I study next?", "Quiz me"] : ["What should I study next?", "Quiz me"] });
    case "thanks": return R([T(pick(["Anytime! Keep going, you've got this 💪", "Happy to help! What's next?", "You're welcome! 🙌"]))]);
    case "bye": return R([T(pick(["Bye! Good luck with your studies 🌟", "See you soon — don't forget to take breaks!"]))]);
    case "who": return R([T("I'm **Flo**, ExamFlow's own study companion. I use your ExamFlow subjects, exams and progress, and a library of trusted study notes written for ExamFlow. I don't use any outside chatbot, and if I don't know something, I'll tell you instead of guessing.")], { chips: ["What can you do?"] });
    case "help": default: return R([T("Here's how I can help:"), { type: "list", items: [
      { title: "💡 Explain", meta: "Any topic from my notes, simply or in detail" },
      { title: "📝 Make notes", meta: "Clean notes you can save to ExamFlow" },
      { title: "🧠 Quiz me", meta: "Scored quizzes saved to your Practice history" },
      { title: "🔄 Revise", meta: "Key points, flashcards and spaced revision" },
      { title: "❓ Clear my doubt", meta: "Ask a question — I'll say if I'm not sure" },
      { title: "📅 Study plan", meta: "Built from your real exam dates and chapters" },
      { title: "📊 Analyze progress", meta: "What's on track and what needs attention" },
    ] }], { chips: ["What should I study next?", "Make a study plan", "Analyze my progress"] });
  }
}

export function general(entry) {
  return R([T(pick(entry.answers))], { chips: entry.chips || [] });
}

export function math(frame) {
  const t = frame.c.replace(/−/g, "-");
  let m;
  const fmt = (v, label) => R([T(`🧮 ${label} = **${Math.round(v * 1e6) / 1e6}**`)]);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/))) return fmt((Number(m[1]) / 100) * Number(m[2]), `${m[1]}% of ${m[2]}`);
  if ((m = t.match(/(?:square root|sqrt)\s*(?:of)?\s*(\d+(?:\.\d+)?)/))) return fmt(Math.sqrt(Number(m[1])), `√${m[1]}`);
  let expr = t.replace(/^(what is|whats|calculate|calc|solve|compute)\s+/, "").replace(/[=?]\s*$/, "").trim();
  expr = expr.replace(/(\d)\s*[x×]\s*(?=\d)/g, "$1*").replace(/÷/g, "/").replace(/\^/g, "**");
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return R([T("I can do quick sums like `12 x 15`, `20% of 250` or `square root of 144`.")]);
  try {
    const v = Function('"use strict"; return (' + expr + ");")();
    if (typeof v !== "number" || !Number.isFinite(v)) return R([T("That doesn't give a real number — maybe dividing by zero?")]);
    return fmt(v, expr.replace(/\*\*/g, "^").replace(/\*/g, " × ").replace(/\//g, " ÷ "));
  } catch (e) { return R([T("I couldn't work that out. Try something like `(3+4) x 2`.")]); }
}

export function unknown(frame, ctx) {
  const soon = ctx.upcoming[0];
  return R([T("I don't have enough information to answer that confidently, so I won't guess. I'm best with your ExamFlow subjects and the topics in my study notes.")], { chips: [soon ? `Make a study plan for ${soon.subject}` : "Make a study plan", "What should I study next?", "What topics do you know?"], unknown: true });
}

export function topicsKnown(frame, ctx, K) {
  const cls = ctx.student.classNum;
  const byClassSubject = new Map();
  (K.index ? K.index.chapters : []).forEach((c) => { const k = `${c.class ? "Class " + c.class : "All classes"} · ${K.subjectName(c.subject)}`; (byClassSubject.get(k) || byClassSubject.set(k, []).get(k)).push(c); });
  const items = [...byClassSubject.entries()].sort((a, b) => (a[1][0].class === cls ? -1 : 0) - (b[1][0].class === cls ? -1 : 0)).map(([k, list]) => ({ title: k, meta: list.map((c) => c.name).join(" · ") }));
  const mine = [];
  ctx.exams.forEach((e) => { const key = K.subjectKeyFor(e.subject); e.chapters.forEach((c) => { if (K.matchChapter(c.name, { subjectKey: key, classNum: cls })) mine.push(c.name); }); });
  const head = mine.length ? `I have trusted notes for **${plural(mine.length, "chapter")}** in your ExamFlow syllabus. My full library:` : "My trusted notes library so far:";
  return R([T(head), { type: "list", items }, T("For chapters I don't have notes on yet, I can still plan, track and schedule revision.")], { chips: mine.slice(0, 3).map((n) => `Explain ${n}`) });
}

export const _internal = { levelStyle, daysBetween };
export { sourceBlock, focusFrom, noKnowledge, askedPhrase };
