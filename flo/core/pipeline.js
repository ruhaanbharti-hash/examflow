// Flo · pipeline
//   student message
//     → understand intent            (nlu.js)
//     → student's ExamFlow context   (context.js, via the app bridge)
//     → search trusted knowledge     (knowledge.js)
//     → respond                      (modes.js, wording from the provider in provider.js)
//     → optionally act in ExamFlow   (actions.js, through the app's own save functions)

import { understand } from "./nlu.js";
import { buildContext } from "./context.js";
import { LocalProvider } from "./provider.js";
import * as M from "./modes.js";
import { clean } from "./text.js";

export function createFlo({ bridge, knowledge, provider = LocalProvider, now = () => new Date(), random = Math.random }) {
  let knowledgeOk = null;

  async function ensureKnowledge() {
    if (knowledgeOk !== null) return knowledgeOk;
    try { await knowledge.init(); knowledgeOk = true; } catch (e) { console.warn("[Flo] knowledge library unavailable", e); knowledgeOk = false; }
    return knowledgeOk;
  }

  function context() { return buildContext(bridge.get(), bridge.helpers || {}, now()); }

  async function handle(message, state) {
    state.turn = (state.turn || 0) + 1;
    const K = (await ensureKnowledge()) ? knowledge : null;
    const ctx = context();
    const c = clean(message);

    // Personal preferences: "always explain simply", "from now on keep it short".
    const pref = c.match(/\b(always|from now on|by default|in future)\b.*\b(simple|simply|simpler|detail|detailed|short|shorter|brief)\b/);
    if (pref) {
      const depth = /simple|simply|simpler/.test(pref[2]) ? "simple" : /detail/.test(pref[2]) ? "detailed" : "short";
      await bridge.act("updateFloPrefs", { depth });
      return reply(state, { blocks: [{ type: "text", text: `Got it — I'll keep explanations **${depth === "short" ? "short" : depth}** from now on. You can still say "in detail" or "simpler" anytime.` }] });
    }
    if (/\b(reset|clear|forget)\b.*\b(preference|preferences|style)\b/.test(c)) {
      await bridge.act("updateFloPrefs", { depth: null });
      return reply(state, { blocks: [{ type: "text", text: "Done — back to my normal explanation style." }] });
    }
    if (/\bwhat (topics|chapters|subjects) do you (know|have|cover)\b|\bwhat can you explain\b|\byour (topics|notes|library)\b/.test(c) && K) {
      return reply(state, M.topicsKnown({}, ctx, K));
    }

    const frame = understand(message, state, ctx, K);
    let r;
    switch (frame.intent) {
      case "crisis": r = M.crisis(); break;
      case "yes":
        if (state.pending) { const p = state.pending; state.pending = null; return reply(state, { blocks: [], run: p.action }); }
        r = { blocks: [{ type: "text", text: "👍 What would you like to do next?" }], chips: ["What should I study next?", "Make a study plan", "Quiz me"] };
        break;
      case "no": state.pending = null; r = { blocks: [{ type: "text", text: "No problem. Anything else?" }] }; break;
      case "math": r = M.math(frame); break;
      case "restyle": r = K ? await M.restyle(frame, ctx, K, provider, state) : offline(); break;
      case "nextTopic": r = K ? await M.nextTopic(frame, ctx, K, provider, state) : offline(); break;
      case "explain": r = K ? await M.explain(frame, ctx, K, provider, state) : offline(); break;
      case "notes": r = K ? await M.notes(frame, ctx, K, provider, state) : offline(); break;
      case "quiz": r = K ? await M.quiz(frame, ctx, K, provider, state, random) : offline(); break;
      case "revise": r = K ? await M.revise(frame, ctx, K, provider, state) : offline(); break;
      case "doubt": r = K ? await M.doubt(frame, ctx, K, provider, state, provider) : offline(); break;
      case "plan": r = M.plan(frame, ctx, K, provider, state); break;
      case "progress": r = M.progress(frame, ctx, K); break;
      case "next": r = M.next(frame, ctx, K); break;
      case "examInfo": r = M.examInfo(frame, ctx); break;
      case "tasks": r = M.tasks(frame, ctx); break;
      case "today": r = M.today(frame, ctx); break;
      case "focus": r = await M.focus(frame, ctx, K || nullKnowledge, provider, state); break;
      case "subject": r = await M.subject(frame, ctx, K || nullKnowledge); break;
      case "general": r = M.general(frame.general); break;
      case "greet": case "thanks": case "bye": case "who": case "help": r = M.smalltalk(frame.intent, ctx); break;
      default: r = M.unknown(frame, ctx);
    }
    return reply(state, r, frame);
  }

  function reply(state, r, frame) {
    if (r.focus) state.focus = { ...r.focus, turn: state.turn };
    state.pending = r.pending || null;
    if (frame) state.lastIntent = frame.intent;
    return r;
  }

  function offline() {
    return { blocks: [{ type: "notice", tone: "warn", text: "I couldn't load my study notes just now. Check your connection and try again — planning and progress still work." }], chips: ["Make a study plan", "Analyze my progress"] };
  }

  function finishQuiz(qz) {
    const ctx = context();
    const { result, reply: r } = M.quizFinished(qz, ctx);
    if (qz.examId && qz.chapterId) bridge.act("saveQuizResult", result);
    return r;
  }

  // Suggestions for the empty state, based on the student's real situation.
  function suggestions() {
    let ctx;
    try { ctx = context(); } catch (e) { return ["What can you do?"]; }
    const s = [];
    const soon = ctx.upcoming[0];
    if (soon && soon.daysLeft <= 7) s.push(`My ${soon.subject} exam is ${soon.daysLeft === 1 ? "tomorrow" : "in " + soon.daysLeft + " days"} — make a plan`);
    s.push("What should I study next?");
    if (ctx.needsRevision[0]) s.push(`Help me revise ${ctx.needsRevision[0].chapter.name}`);
    const learning = ctx.exams.flatMap((e) => e.chapters.filter((c) => c.status === "in_progress")).slice(0, 1);
    if (learning[0]) s.push(`Explain ${learning[0].name}`);
    s.push("Analyze my progress");
    return [...new Set(s)].slice(0, 4);
  }

  function statusLine() {
    try {
      const ctx = context();
      const soon = ctx.upcoming[0];
      if (soon) return `${soon.subject} exam ${soon.daysLeft === 0 ? "today" : soon.daysLeft === 1 ? "tomorrow" : "in " + soon.daysLeft + " days"} · ${soon.percent}% ready`;
      return ctx.exams.length ? `${ctx.exams.length} subjects · no upcoming exams` : "Add your subjects to get started";
    } catch (e) { return ""; }
  }

  return { handle, finishQuiz, suggestions, statusLine, context, ensureKnowledge, get provider() { return provider; } };
}

const nullKnowledge = { index: null, subjectKeyFor: () => null, matchChapter: () => null, subjectName: (k) => k, load: async () => null, search: () => [] };
