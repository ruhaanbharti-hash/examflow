// Flo · the learner's own study material
// Notes, PDFs, pasted text or a syllabus that the learner gives Flo. It's kept in THIS browser
// only (it can be private and large), searched locally, and used as context for answers.
// Everything here works without any AI model:
//   - search:     find the passages that answer a question
//   - summarize:  pick the most important sentences (extractive summary)
//   - selfTest:   fill-in-the-blank cards from key sentences
//   - syllabus:   recognise "Subject → chapters" structure so ExamFlow can import it

import { tokens, clean } from "./text.js";

const MAX_DOC_CHARS = 150000;      // per document
const MAX_TOTAL_CHARS = 400000;    // everything kept in this browser

export function createMaterialStore(key, storage = safeStorage()) {
  let docs = load();

  function load() {
    try { const d = JSON.parse(storage.getItem(key) || "[]"); return Array.isArray(d) ? d.filter((x) => x && x.id && typeof x.text === "string") : []; } catch (e) { return []; }
  }
  function save() {
    // Keep the newest documents within the size budget.
    let total = 0;
    docs = docs.sort((a, b) => b.addedAt - a.addedAt).filter((d) => (total += d.text.length) <= MAX_TOTAL_CHARS);
    try { storage.setItem(key, JSON.stringify(docs)); return true; } catch (e) { return false; }
  }

  return {
    list: () => docs.map(({ text, ...meta }) => meta),
    get: (id) => docs.find((d) => d.id === id) || null,
    add({ name, text, kind = "text" }) {
      const body = normalise(text);
      if (!body) return { ok: false, reason: "empty" };
      const truncated = body.length > MAX_DOC_CHARS;
      const doc = {
        id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: String(name || "My notes").slice(0, 80), kind,
        text: body.slice(0, MAX_DOC_CHARS), words: countWords(body), addedAt: Date.now(), truncated,
      };
      docs.unshift(doc);
      const stored = save();
      return { ok: true, doc, stored, truncated };
    },
    remove(id) { docs = docs.filter((d) => d.id !== id); save(); },
    clear() { docs = []; save(); },
  };
}

function safeStorage() {
  try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) {}
  const mem = new Map();
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}

export function normalise(text) {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export const countWords = (t) => (String(t).match(/\S+/g) || []).length;

// ------------------------------------------------------------------ passages & search
export function passages(text, size = 700) {
  const paras = normalise(text).split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[.)]|chapter|unit)\s)/i).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = "";
  paras.forEach((p) => {
    if ((buf + "\n" + p).length > size && buf) { out.push(buf); buf = ""; }
    if (p.length > size * 1.6) sentences(p).forEach((s) => { if ((buf + " " + s).length > size && buf) { out.push(buf); buf = ""; } buf = buf ? buf + " " + s : s; });
    else buf = buf ? buf + "\n" + p : p;
  });
  if (buf) out.push(buf);
  return out;
}

// BM25 over the passages of one or more documents.
export function search(docs, query, { limit = 3 } = {}) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const items = [];
  docs.forEach((d) => passages(d.text).forEach((p, i) => items.push({ doc: d, i, text: p, toks: tokens(p) })));
  if (!items.length) return [];
  const N = items.length, avg = items.reduce((a, x) => a + x.toks.length, 0) / N;
  const df = new Map();
  items.forEach((x) => new Set(x.toks).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const k1 = 1.4, b = 0.75;
  items.forEach((x) => {
    const tf = new Map();
    x.toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    let s = 0, hit = 0;
    q.forEach((t) => {
      const f = tf.get(t) || 0;
      if (!f) return;
      hit++;
      const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * x.toks.length / avg));
    });
    x.score = s;
    x.coverage = hit / q.length;
  });
  return items.filter((x) => x.score > 0).sort((a, b2) => b2.score - a.score).slice(0, limit);
}

// The sentences of a passage that best match a question (for a no-AI "from your material" answer).
export function bestSentences(text, query, n = 3) {
  const q = new Set(tokens(query));
  const sents = sentences(text);
  const scored = sents.map((s, i) => ({ s, i, score: tokens(s).filter((t) => q.has(t)).length + (/\b(is|are|means|called)\b/i.test(s) ? 0.3 : 0) }));
  return scored.filter((x) => x.score >= 1).sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}

// ------------------------------------------------------------------ summaries (no AI)
export function sentences(text) {
  return (String(text).replace(/\s+/g, " ").match(/[^.!?]+(?:[.!?]+|$)/g) || []).map((s) => s.trim()).filter((s) => s.length > 2);
}

const GENERIC = new Set("through which their there these those other also used using called into onto over under between because while where when after before during each every such many much more most very well only even into been being within without about above below like just than then them they what your from with that this have will would could should shall into upon make made take taken give given show shown include includes including example examples important".split(" "));
export function keyTerms(text, n = 8) {
  const tf = new Map();
  tokens(text).forEach((t) => { if (t.length > 3 && !/^\d+$/.test(t) && !GENERIC.has(t)) tf.set(t, (tf.get(t) || 0) + 1); });
  return [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

// Picks the most informative sentences and keeps them in their original order.
export function summarize(text, { maxSentences = 7 } = {}) {
  const sents = sentences(text).filter((s) => s.split(" ").length >= 5 && s.length < 400);
  if (!sents.length) return { points: [], outline: headings(text), terms: [] };
  const tf = new Map();
  const toks = sents.map((s) => tokens(s));
  toks.flat().forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  const max = Math.max(...tf.values());
  const scored = sents.map((s, i) => {
    const t = toks[i];
    const w = t.reduce((a, x) => a + (tf.get(x) || 0) / max, 0) / Math.sqrt(t.length + 1);
    const pos = i < 3 ? 0.25 : 0;                                   // opening sentences usually matter
    const def = /\b(is|are|means|refers to|is called|is known as|defined as)\b/i.test(s) ? 0.2 : 0;
    return { s, i, score: w + pos + def };
  });
  const n = Math.min(maxSentences, Math.max(4, Math.round(sents.length / 3)));
  const points = scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
  return { points, outline: headings(text), terms: keyTerms(text) };
}

export function headings(text) {
  return normalise(text).split("\n").map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 70 && !/[.,;]$/.test(l) &&
    (/^(chapter|unit|module|section|topic|part|lesson|week)\b/i.test(l) || /^\d+(\.\d+)*[.)]?\s+[A-Z]/.test(l) || (l === l.toUpperCase() && /[A-Z]{3}/.test(l) && l.split(" ").length <= 7))).slice(0, 20);
}

// Fill-in-the-blank self-test cards from key sentences.
export function selfTest(text, n = 6) {
  const { points } = summarize(text, { maxSentences: n + 4 });
  const terms = keyTerms(text, 30);
  const cards = [];
  const used = new Set();
  points.forEach((s) => {
    if (cards.length >= n) return;
    const words = s.split(/\s+/);
    // blank the most important content word in the sentence
    let best = -1, bestRank = 99;
    words.forEach((w, i) => { const t = tokens(w)[0]; if (!t) return; const r = terms.indexOf(t); if (r >= 0 && !used.has(t) && r < bestRank && w.replace(/[^A-Za-z0-9]/g, "").length > 3) { bestRank = r; best = i; } });
    if (best < 0) return;
    used.add(tokens(words[best])[0]);
    const answer = words[best].replace(/[^A-Za-z0-9'-]/g, "");
    const front = words.map((w, i) => (i === best ? w.replace(answer, "_____") : w)).join(" ");
    cards.push({ front, back: `**${answer}** — ${s}` });
  });
  return cards;
}

// ------------------------------------------------------------------ syllabus structure
const CHAPTER_LINE = /^\s*(?:(?:chapter|ch|unit|module|lesson|topic|week|part)\s*[-:.]?\s*[0-9ivxlc]+\s*[-:.)]?\s*|\d{1,2}\s*[.):-]\s*|[-•*▪●◦]\s*)(.{2,90})$/i;
const SUBJECT_LINE = /^\s*(?:subject\s*[:-]\s*)?([A-Z][A-Za-z &/+().-]{1,40}?)\s*:?\s*$/;

export function looksLikeSyllabus(text) {
  const lines = normalise(text).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  const chapterish = lines.filter((l) => CHAPTER_LINE.test(l)).length;
  const short = lines.filter((l) => l.length <= 90).length;
  return /\b(syllabus|curriculum|course outline|chapters?|units?|modules?)\b/i.test(text.slice(0, 600)) ? chapterish >= 2 : chapterish >= 4 && short / lines.length > 0.6;
}

// Returns [{ subject, topics: [...] }] in the shape ExamFlow's own "Review & confirm" screen uses.
export function parseSyllabus(text, { knownSubjects = [], fallbackSubject = "" } = {}) {
  const lines = normalise(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const known = knownSubjects.map((s) => ({ s, c: clean(s), k: tokens(s).join(" ") }));
  const out = [];
  let cur = null;
  const start = (name) => { cur = out.find((x) => clean(x.subject) === clean(name)) || null; if (!cur) { cur = { subject: name, topics: [] }; out.push(cur); } };
  lines.forEach((l) => {
    const lc = clean(l.replace(/:$/, ""));
    const lk = tokens(lc.replace(/^subject\s*/, "").replace(/\s*syllabus$/, "")).join(" ");
    const k = known.find((x) => lc === x.c || lc === x.c + " syllabus" || lc.replace(/^subject\s*/, "") === x.c || (lk && lk === x.k));
    if (k) return start(k.s);
    const ch = l.match(CHAPTER_LINE);
    if (ch) {
      const name = tidyTopic(ch[1]);
      if (!name) return;
      if (!cur) start(fallbackSubject || guessSubject(text) || "My course");
      if (!cur.topics.some((t) => clean(t) === clean(name))) cur.topics.push(name);
      return;
    }
    const sm = l.match(SUBJECT_LINE);
    if (sm && l.length <= 42 && !/\b(syllabus|curriculum|term|session|marks|total|class|grade)\b/i.test(l) && (/:$/.test(l) || l === l.toUpperCase() || /^subject\s*[:-]/i.test(l))) {
      return start(titleish(sm[1]));
    }
  });
  return out.filter((x) => x.topics.length).map((x) => ({ ...x, topics: x.topics.slice(0, 60) }));
}

function tidyTopic(s) {
  return String(s).replace(/\s*[-–—:]\s*\d+\s*(marks?|periods?|hours?|hrs?)\b.*$/i, "").replace(/\(\s*\d+\s*(marks?|periods?)\s*\)/i, "").replace(/\s{2,}/g, " ").replace(/[.:;,-]+$/, "").trim().slice(0, 80);
}
function titleish(s) { const t = s.trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : t; }
function guessSubject(text) {
  const m = String(text).slice(0, 400).match(/\b(?:subject|course)\s*[:-]\s*([A-Za-z &]{3,40})/i) || String(text).slice(0, 200).match(/^\s*([A-Z][A-Za-z &]{2,30})\s+syllabus/im);
  return m ? titleish(m[1]) : "";
}

// Cut a long text down to the parts most relevant to a query, within a character budget.
export function focusText(text, query, budget = 6000) {
  if (text.length <= budget) return text;
  if (query && tokens(query).length) {
    const hits = search([{ id: "x", text }], query, { limit: 12 });
    let out = "";
    for (const h of hits) { if ((out + "\n\n" + h.text).length > budget) break; out += (out ? "\n\n" : "") + h.text; }
    if (out.length > budget / 3) return out;
  }
  const { points } = summarize(text, { maxSentences: 40 });
  const joined = points.join(" ");
  return joined.length > budget ? joined.slice(0, budget) : joined;
}
