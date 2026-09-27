// Flo · Smart Study Mode (optional AI layer)
// Builds level-aware requests for an AI engine (see ai/engines.js) and turns its answers into
// Flo's normal reply blocks. Trusted content always comes first:
//   📚 ExamFlow notes / the learner's own material  → given to the model as reference
//   ✨ AI-generated                                  → always labelled as such
// If the engine isn't available (unsupported device, not downloaded, switched off), Flo simply
// keeps working without it — nothing in ExamFlow depends on this file.

import { audienceGuide } from "./profile.js";

const REF_BUDGET = 5200;        // characters of reference material per request (small models, small context)
const HISTORY_TURNS = 6;

export function createSmart({ engine }) {
  const smart = {
    engine,
    // Build a job for the UI to run. Every job: { tool, messages, kind: "stream"|"json", finalize(text) → reply }
    job(opts) { return buildJob(opts); },
    async run(job, { onToken } = {}) {
      const text = await engine.complete(job.messages, { onToken: job.kind === "stream" ? onToken : null, maxTokens: job.maxTokens, temperature: job.temperature });
      return text;
    },
  };
  return smart;
}

// ------------------------------------------------------------------ prompts
export function systemPrompt(ctx, { extra = "" } = {}) {
  const p = (ctx && ctx.student && ctx.student.profile) || {};
  const prefs = (ctx && ctx.student && ctx.student.prefs) || {};
  const who = p.label ? `The learner is ${p.label}.` : "The learner hasn't said their level — give a clear, general answer they can ask to make simpler or more advanced.";
  const depth = prefs.depth === "simple" ? " They prefer simple explanations." : prefs.depth === "detailed" ? " They prefer detailed explanations." : prefs.depth === "short" ? " They prefer short answers." : "";
  const subjects = ctx && ctx.exams && ctx.exams.length ? ` Their subjects in ExamFlow: ${ctx.exams.slice(0, 8).map((e) => e.subject + (e.daysLeft != null && e.daysLeft >= 0 ? ` (exam in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"})` : "")).join(", ")}.` : "";
  return [
    "You are Flo, the study companion inside the ExamFlow app. You help learners of every age and level, in any subject or course.",
    who + depth + subjects,
    "How to pitch your answer: " + audienceGuide(p),
    "Rules:",
    "- Be accurate and honest. If you are not sure, say \"I'm not completely sure\" and suggest checking a textbook, teacher or official source. Never invent facts, numbers, quotes, dates, names or references.",
    "- If REFERENCE MATERIAL is given, base your answer on it first. If it doesn't cover the question, say so briefly, then answer from general knowledge.",
    "- Format with short paragraphs, \"- \" bullet points and **bold** key terms. Do not use tables or # headings.",
    "- Keep it focused (about 120-250 words) unless asked for more. For maths or science problems, show the steps.",
    "- Be kind and encouraging. Help the learner understand; for homework, explain the method rather than only giving the final answer.",
    extra,
  ].filter(Boolean).join("\n");
}

const STYLE_LINE = {
  simple: "Explain it very simply, with an everyday example.",
  detailed: "Go deeper than usual: mechanisms, details and how it connects to related ideas.",
  example: "Focus on one or two concrete real-life or worked examples.",
  short: "Answer in 3-4 sentences.",
};

function refsBlock(refs = []) {
  if (!refs.length) return "";
  let used = 0;
  const parts = [];
  refs.forEach((r, i) => {
    const room = REF_BUDGET - used;
    if (room < 200) return;
    const t = String(r.text || "").slice(0, room);
    used += t.length;
    parts.push(`[${i + 1}] ${r.label}\n${t}`);
  });
  return `REFERENCE MATERIAL (trusted — use this first):\n${parts.join("\n\n")}\n\n`;
}

function historyMessages(history = []) {
  return history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.content || "").slice(0, 800) }));
}

export function buildJob({ tool, input = "", ctx, style = null, count = null, refs = [], history = [], grounded = null, title = null, question = null, examId = null }) {
  const sys = systemPrompt(ctx);
  const R = refsBlock(refs);
  const q = String(input).trim();
  let user, kind = "stream", maxTokens = 650, temperature = 0.4;
  switch (tool) {
    case "explain":
      user = `${R}Explain: ${q}\n${STYLE_LINE[style] || "Start with a one-line definition, then explain it clearly, then give one example. End with one short question to check understanding."}`;
      break;
    case "lesson":
      user = `${R}Teach me a short beginner lesson: ${q}\nStructure: what it is (1-2 lines); 3-5 key ideas, each with a tiny example (use \`code\` formatting for any code); one small practice task; what to learn next.`;
      maxTokens = 750;
      break;
    case "notes":
      user = `${R}Make concise revision notes on: ${q}\nUse these parts, each starting with a bold label on its own line: **Overview** (1-2 lines), **Key points** (bullets), **Key terms** (bullets: term – meaning), **Formulas** (only if relevant), **Common mistakes** (2-3 bullets).`;
      maxTokens = 750;
      break;
    case "quiz":
      kind = "json"; temperature = 0.3; maxTokens = 900;
      user = `${R}Write ${count || 5} multiple-choice questions on: ${q}\nMatch the learner's level. Each question has exactly 4 options and exactly one correct answer.\nReply with ONLY valid JSON, no other text, in this exact form:\n{"title":"short topic title","questions":[{"q":"question text","options":["option A","option B","option C","option D"],"answer":0,"explain":"one sentence on why the answer is right"}]}\n"answer" is the index (0-3) of the correct option.`;
      break;
    case "revise":
      kind = "json"; temperature = 0.3; maxTokens = 800;
      user = `${R}Help me revise: ${q}\nReply with ONLY valid JSON, no other text, in this exact form:\n{"title":"short topic title","points":["must-know point", "..."],"cards":[{"front":"short question","back":"short answer"}]}\nGive 5-7 points and 5 cards, matched to the learner's level.`;
      break;
    case "practice":
      maxTokens = 900;
      user = `${R}Write ${count || 5} practice questions on: ${q}\nGo from easier to harder and mix short-answer and longer questions, like a real test at the learner's level. Number them.\nThen write a line containing only the word ANSWERS, and give brief model answers numbered to match.`;
      break;
    case "summarize":
      maxTokens = 750;
      user = `${R}Summarize the reference material for the learner. Use only information from the material.\nParts, each starting with a bold label: **In short** (2-3 sentences), **Key points** (5-8 bullets), **Key terms** (bullets: term – meaning).`;
      break;
    case "improve":
      maxTokens = 850;
      user = `${R}${question ? `The question was: "${question}"\n` : ""}Here is my answer:\n"""\n${q.slice(0, 3500)}\n"""\nGive feedback suitable for my level, with these bold labels: **What's good**, **What's missing or wrong** (be specific and correct any factual errors), **Improved answer** (rewrite it well), **Tip** (one line).`;
      break;
    case "examprep":
      user = `${R}I'm preparing for: ${q}\nGive a focused preparation strategy: the key topics to prioritise, how to practise, a simple weekly routine, and common mistakes to avoid. If exam details (syllabus, pattern, dates) may have changed recently, say to check the official website.`;
      break;
    case "answer":
    default:
      user = `${R}${q}${style && STYLE_LINE[style] ? "\n" + STYLE_LINE[style] : ""}`;
  }
  // Small on-device models have a ~4k-token window: drop the oldest chat turns if the request is too long.
  const hist = historyMessages(history);
  const size = () => sys.length + user.length + hist.reduce((a, m) => a + m.content.length, 0);
  while (hist.length && size() > 9500) hist.shift();
  const messages = [{ role: "system", content: sys }, ...hist, { role: "user", content: user }];
  return { tool, kind, messages, maxTokens, temperature, input: q, grounded, title, examId, finalize: (text) => finalize({ tool, text, grounded, title: title || shortTitle(q), input: q, examId }) };
}

// ------------------------------------------------------------------ turning answers into blocks
export function tidy(text) {
  return String(text || "")
    .replace(/^\s*#{1,6}\s*(.+)$/gm, "**$1**")                       // headings → bold lines
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")                           // table separator rows
    .replace(/^\s*\|(.+)\|\s*$/gm, (m, row) => "- " + row.split("|").map((c) => c.trim()).filter(Boolean).join(" — "))
    .replace(/^\s*\*\s+/gm, "- ")                                    // "* item" → "- item"
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function label(grounded) {
  return { type: "ai", grounded: grounded || null };
}

function shortTitle(q) { return String(q || "").replace(/^(explain|notes on|make notes on|quiz me on|help me revise|teach me)\s+/i, "").slice(0, 60) || "this topic"; }

export function finalize({ tool, text, grounded, title, input, examId }) {
  const clean = tidy(text);
  const L = label(grounded);
  const empty = !clean || clean.length < 3;
  if (empty && tool !== "quiz" && tool !== "revise") return { blocks: [{ type: "notice", tone: "warn", text: "The AI didn't produce an answer. Try asking in a different way." }], chips: [] };
  switch (tool) {
    case "quiz": {
      const data = parseJson(text);
      const qs = validQuestions(data && data.questions);
      if (qs.length < 2) return { blocks: [{ type: "notice", tone: "warn", text: "I couldn't make a reliable quiz on that just now." }], chips: [`Practice questions on ${title}`, `Explain ${title}`], retryAs: "practice" };
      const quiz = { id: "qz" + Date.now().toString(36), title: (data.title || title).slice(0, 60), subject: "", examId: null, chapterId: null, chapterName: data.title || title, questions: qs, idx: 0, answers: [], done: false, ai: true };
      return { blocks: [L, { type: "text", text: `Here's a ${qs.length}-question quiz on **${quiz.title}**. Take your time!` }, { type: "quiz", quiz }], chips: [] };
    }
    case "revise": {
      const data = parseJson(text) || {};
      const points = (Array.isArray(data.points) ? data.points : []).map((x) => String(x)).filter((x) => x.length > 3).slice(0, 8);
      const cards = (Array.isArray(data.cards) ? data.cards : []).filter((c) => c && c.front && c.back).map((c) => ({ front: String(c.front), back: String(c.back) })).slice(0, 6);
      if (!points.length && !cards.length) return { blocks: [L, { type: "text", text: clean }], chips: [`Quiz me on ${title}`] };
      const blocks = [L, { type: "text", text: `Quick revision: **${(data.title || title).slice(0, 60)}**` }];
      if (points.length) blocks.push({ type: "keypoints", title: "Must-know points", items: points });
      if (cards.length) blocks.push({ type: "flashcards", title: "Test yourself — tap to flip", cards });
      return { blocks, chips: [`Quiz me on ${title}`, `Practice questions on ${title}`, `Make notes on ${title}`] };
    }
    case "practice": {
      const parts = clean.split(/^\s*\**\s*answers?\s*(?:key)?\s*\**\s*:?\s*\**\s*$/im);
      const blocks = [L, { type: "text", text: parts[0].trim() }];
      if (parts[1] && parts[1].trim()) blocks.push({ type: "reveal", label: "Show answers", text: parts.slice(1).join("\n").trim() });
      return { blocks, chips: [`Quiz me on ${title}`, `Explain ${title}`] };
    }
    case "notes": {
      const plain = `📝 ${title}\n\n` + clean.replace(/\*\*/g, "");
      return { blocks: [L, { type: "text", text: clean }, { type: "actions", buttons: [{ label: "Save to my Notes", action: { type: "addNote", text: plain, examId: examId || null }, icon: "save", primary: true }] }], chips: [`Quiz me on ${title}`, "Make it shorter", `Help me revise ${title}`] };
    }
    case "summarize":
      return { blocks: [L, { type: "text", text: clean }, { type: "actions", buttons: [{ label: "Save summary to Notes", action: { type: "addNote", text: `📚 Summary: ${title}\n\n` + clean.replace(/\*\*/g, ""), examId: null }, icon: "save", primary: true }] }], chips: ["Quiz me on this", "Make notes from this", "Practice questions on this"] };
    case "improve":
      return { blocks: [L, { type: "text", text: clean }], chips: ["Explain the mistakes simply", "Give me a similar question to try"] };
    case "lesson":
      return { blocks: [L, { type: "text", text: clean }], chips: ["Next lesson", "Give me an exercise", "Quiz me on this"] };
    default:
      return { blocks: [L, { type: "text", text: clean }], chips: tool === "explain" ? ["Explain simply", "Give an example", "In more detail", "Quiz me on this"] : ["Explain simply", "Give an example", "Quiz me on this"] };
  }
}

export function parseJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  // find the matching closing brace
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      const body = s.slice(start, i + 1);
      try { return JSON.parse(body); } catch (e) { try { return JSON.parse(body.replace(/,\s*([}\]])/g, "$1")); } catch (e2) { return null; } }
    }
  }
  return null;
}

export function validQuestions(list) {
  if (!Array.isArray(list)) return [];
  return list.map((q) => {
    if (!q || typeof q.q !== "string" || !Array.isArray(q.options)) return null;
    const options = q.options.map((o) => String(o).replace(/^\s*[A-D][.)]\s+/, "").trim()).filter(Boolean);
    let answer = q.answer;
    if (typeof answer === "string") { const L = answer.trim().toUpperCase(); answer = /^[A-D]$/.test(L) ? "ABCD".indexOf(L) : options.findIndex((o) => o.toLowerCase() === answer.trim().toLowerCase()); }
    if (options.length !== 4 || new Set(options.map((o) => o.toLowerCase())).size !== 4) return null;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
    return { q: q.q.trim(), options, answer, explain: String(q.explain || "").trim(), topic: "" };
  }).filter(Boolean).slice(0, 10);
}
