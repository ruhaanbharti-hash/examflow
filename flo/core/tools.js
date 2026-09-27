// Flo · universal study tools that work WITHOUT any AI model
// Practice questions, answer checking, summaries and self-tests from the learner's own material,
// and syllabus import through ExamFlow's own "Review & confirm" screen.

import { resolveTopic, sourceBlock, focusFrom } from "./modes.js";
import { summarize, selfTest, search, bestSentences, parseSyllabus, looksLikeSyllabus, countWords } from "./material.js";
import { tokens, similar, shuffle } from "./text.js";

const R = (blocks, extra = {}) => ({ blocks: blocks.filter(Boolean), ...extra });
const T = (text) => ({ type: "text", text });
const matSource = (docs) => ({ type: "source", text: `Your material · ${docs.map((d) => d.name).join(", ")}`.slice(0, 120) });

// ------------------------------------------------------------------ 🎯 practice questions (trusted notes)
export async function practiceLocal(frame, ctx, K, state) {
  const t = K ? await resolveTopic(frame, ctx, K, state) : {};
  if (!t.k) return null;
  let items = (t.k.quiz || []).map((q) => ({ q: q.q, a: `${q.options[q.answer]} — ${q.explain || ""}`.trim(), topic: q.topic, level: q.level }));
  if (t.topic) { const f = items.filter((x) => x.topic === t.topic.id); if (f.length >= 3) items = f; }
  (t.k.faqs || []).forEach((f) => items.push({ q: f.q, a: f.a, level: "medium" }));
  const order = { easy: 0, medium: 1, hard: 2 };
  const n = Math.max(3, Math.min(10, frame.count || 6));
  const pick = shuffle(items).slice(0, n).sort((a, b) => (order[a.level] ?? 1) - (order[b.level] ?? 1));
  const title = t.topic ? t.topic.title : t.k.name;
  return R([
    sourceBlock(K, t),
    T(`**Practice: ${title}**\nWrite your answers first, then check.\n\n` + pick.map((x, i) => `${i + 1}. ${x.q}`).join("\n")),
    { type: "reveal", label: "Show answers", text: pick.map((x, i) => `${i + 1}. ${x.a}`).join("\n") },
  ], { chips: [`Quiz me on ${title}`, `Explain ${title}`], focus: focusFrom(t, "practice") });
}

// ------------------------------------------------------------------ ✍️ check my answer (trusted notes checklist)
export async function improveLocal(frame, ctx, K, state, answerText, question) {
  if (!K || !K.index) return null;
  const hits = K.search(question || answerText, { classNum: ctx.student.classNum, limit: 6 });
  const hit = hits.find((h) => h.type === "topic" && h.score >= 0.45) || hits.find((h) => h.type === "faq" && h.score >= 0.5) || hits.find((h) => h.type === "chapter" && h.score >= 0.5);
  if (!hit) return null;
  const k = await K.load(hit.chapter);
  if (!k) return null;
  const topic = hit.type === "topic" ? (k.topics || []).find((x) => x.id === hit.topic.id) : null;
  const t = { k, kMeta: hit.chapter, topic, exam: null, chapter: null };
  const points = topic ? topic.keyPoints || [] : (k.revision || []).slice(0, 8);
  if (!points.length) return null;
  const ans = tokens(answerText);
  const covered = (p) => { const pt = tokens(p).filter((x) => x.length > 3); if (!pt.length) return false; const hit2 = pt.filter((x) => ans.some((a) => similar(a, x))).length; return hit2 / pt.length >= 0.5; };
  const lines = points.map((p) => `${covered(p) ? "✅" : "⬜"} ${p}`);
  const got = lines.filter((l) => l.startsWith("✅")).length;
  const name = topic ? topic.title : k.name;
  return R([
    sourceBlock(K, t),
    T(`I can't grade writing without Smart mode, but here's a checklist from my trusted notes on **${name}**. Your answer seems to cover **${got} of ${points.length}** key points:`),
    { type: "keypoints", title: "Key points checklist", items: lines },
    T("Add the unticked points in your own words, use the correct terms, and give one example."),
  ], { chips: [`Explain ${name}`], focus: focusFrom(t, "improve") });
}

// ------------------------------------------------------------------ 📚 your material (no AI)
export function summarizeLocal(docs) {
  const text = docs.map((d) => d.text).join("\n\n");
  const s = summarize(text, { maxSentences: 8 });
  if (!s.points.length) return R([T("I couldn't find enough full sentences in that material to summarize. If it's a list of topics, I can add it to ExamFlow as a syllabus instead.")], { chips: ["Add this syllabus to ExamFlow"] });
  const plain = `📚 Summary: ${docs[0].name}\n\n` + s.points.map((p) => "• " + p).join("\n");
  const blocks = [matSource(docs), T(`**Key ideas** (picked from your material — ${countWords(text).toLocaleString("en-IN")} words):`), { type: "keypoints", title: "Summary", items: s.points }];
  if (s.outline.length >= 2) blocks.push({ type: "keypoints", title: "Sections", items: s.outline.slice(0, 10) });
  if (s.terms.length) blocks.push(T(`**Key terms:** ${s.terms.slice(0, 8).join(", ")}`));
  blocks.push({ type: "actions", buttons: [{ label: "Save summary to Notes", action: { type: "addNote", text: plain, examId: null }, icon: "save", primary: true }] });
  return R(blocks, { chips: ["Make flashcards from this", "Ask a question about it"] });
}

export function materialCardsLocal(docs) {
  const cards = selfTest(docs.map((d) => d.text).join("\n\n"), 6);
  if (!cards.length) return R([T("I couldn't make self-test cards from that material — it may be mostly headings or lists.")]);
  return R([matSource(docs), T("Fill-in-the-blank cards from your material. Say the answer, then tap to check:"), { type: "flashcards", title: "Self-test — tap to flip", cards }], { chips: ["Summarize this", "More cards"] });
}

export function materialAnswerLocal(docs, question) {
  const hits = search(docs, question, { limit: 3 });
  if (!hits.length || hits[0].coverage < 0.5) return null;
  const lines = [];
  hits.forEach((h) => bestSentences(h.text, question, 2).forEach((s) => { if (!lines.includes(s)) lines.push(s); }));
  if (!lines.length) return null;
  return R([matSource(docs), T("Here's what your material says:\n\n" + lines.slice(0, 4).map((l) => `- ${l}`).join("\n"))], { chips: ["Summarize this", "Make flashcards from this"] });
}

// ------------------------------------------------------------------ 🗂️ syllabus → ExamFlow
export function syllabusReply(text, ctx, { name = "your syllabus" } = {}) {
  const subjects = parseSyllabus(text, { knownSubjects: ctx.exams.map((e) => e.subject), fallbackSubject: ctx.exams.length === 1 ? ctx.exams[0].subject : "" });
  if (!subjects.length) {
    return R([T(`I couldn't find a clear list of chapters in ${name}. A syllabus works best as lines like:\n\n- Science\n- 1. Nutrition in Plants\n- 2. Heat\n\nYou can also add subjects yourself in **Subjects**, or use ExamFlow's **Import syllabus** button.`)], { chips: ["Summarize this"] });
  }
  const total = subjects.reduce((a, s) => a + s.topics.length, 0);
  return R([
    T(`I found **${subjects.length} subject${subjects.length === 1 ? "" : "s"}** and **${total} chapters/topics** in ${name}. ExamFlow will show them so you can edit and confirm before anything is saved:`),
    { type: "list", items: subjects.slice(0, 6).map((s) => ({ title: s.subject, meta: s.topics.slice(0, 8).join(" · ") + (s.topics.length > 8 ? ` · +${s.topics.length - 8} more` : "") })) },
    { type: "actions", buttons: [{ label: "Review & add to ExamFlow", action: { type: "reviewSyllabus", subjects: subjects.map((s) => ({ subject: s.subject, examDate: null, examTime: null, examName: null, topics: s.topics })) }, icon: "calendar", primary: true }] },
  ], { chips: [] });
}

export { looksLikeSyllabus };
