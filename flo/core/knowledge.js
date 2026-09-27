// Flo · knowledge system
// Trusted study content lives in /flo/knowledge as plain JSON files:
//   index.json                         → catalogue of subjects, chapters, topics and FAQs (small, loaded once)
//   class-9/science/atoms-and-molecules.json → the full chapter (loaded only when needed)
// Add a class, subject or chapter by adding a file and one entry in index.json. No code changes.

import { tokens, similar, clean } from "./text.js";

export function createKnowledge({ baseUrl, fetchJson }) {
  let index = null;
  let general = null;
  const cache = new Map();
  let docs = [];            // searchable documents: chapters, topics, faqs
  let df = new Map();       // document frequency per token
  let ready = null;

  const subjectAliases = new Map(); // alias token-string → subject key

  function addDoc(doc, text) {
    const toks = tokens(text);
    doc.tokens = toks;
    doc.tokenSet = new Set(toks);
    docs.push(doc);
    doc.tokenSet.forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      index = await fetchJson(baseUrl + "index.json");
      try { general = await fetchJson(baseUrl + (index.general || "general.json")); } catch (e) { general = { entries: [] }; }
      // A chapter added by hand only needs id/class/subject/name/file — fill in its topics from the file.
      await Promise.all((index.chapters || []).filter((ch) => ch.file && !ch.topics).map(async (ch) => {
        try {
          const full = await fetchJson(baseUrl + ch.file);
          ch.topics = (full.topics || []).map((t) => ({ id: t.id, title: t.title, keywords: t.keywords || [] }));
          ch.faqs = (full.faqs || []).map((f) => ({ q: f.q, keywords: f.keywords || [] }));
          cache.set(ch.id, Promise.resolve({ ...full, meta: ch }));
        } catch (e) { ch.topics = []; }
      }));
      index.chapters = (index.chapters || []).filter((ch) => ch.id && ch.name && ch.file);
      Object.entries(index.subjects || {}).forEach(([key, s]) => {
        [key, s.name, ...(s.aliases || [])].forEach((a) => subjectAliases.set(tokens(a, { keepStop: true }).join(" "), key));
      });
      (index.chapters || []).forEach((ch) => {
        const name = [ch.name, ...(ch.aliases || [])].join(" ");
        addDoc({ type: "chapter", chapter: ch }, [name, name, (ch.topics || []).map((t) => t.title).join(" ")].join(" "));
        (ch.topics || []).forEach((t) => addDoc({ type: "topic", chapter: ch, topic: t }, [t.title, t.title, (t.keywords || []).join(" ")].join(" ")));
        (ch.faqs || []).forEach((f) => addDoc({ type: "faq", chapter: ch, faq: f }, [f.q, (f.keywords || []).join(" ")].join(" ")));
      });
      return true;
    })();
    return ready;
  }

  const idf = (t) => Math.log(1 + (docs.length + 1) / ((df.get(t) || 0) + 0.5));

  // Map a student's own subject name ("Maths", "Science (Physics)", "Computer Applications") to a known subject.
  function subjectKeyFor(name) {
    if (!index || !name) return null;
    const full = tokens(name, { keepStop: true }).join(" ");
    if (subjectAliases.has(full)) return subjectAliases.get(full);
    const parts = tokens(name);
    for (const p of parts) if (subjectAliases.has(p)) return subjectAliases.get(p);
    for (const [alias, key] of subjectAliases) if (alias.length >= 5 && parts.some((p) => similar(p, alias))) return key;
    return null;
  }

  function subjectName(key) { return (index && index.subjects && index.subjects[key] && index.subjects[key].name) || key; }

  function classFit(ch, classNum) {
    if (!classNum || !ch.class) return 1;
    const d = Math.abs(ch.class - classNum);
    return d === 0 ? 1.25 : d === 1 ? 1.0 : 0.8;
  }

  // Core scorer: how well do query tokens cover a document? Rare words count more.
  function scoreDoc(qTokens, doc) {
    let hit = 0, total = 0, strong = 0;
    const uniq = [...new Set(qTokens)];
    uniq.forEach((q) => {
      const w = idf(q);
      total += w;
      if (doc.tokenSet.has(q)) { hit += w; strong++; return; }
      for (const t of doc.tokenSet) if (similar(q, t)) { hit += w * 0.75; strong++; return; }
    });
    return { score: total ? hit / total : 0, strong, frac: uniq.length ? strong / uniq.length : 0, n: uniq.length };
  }

  // Search chapters/topics/faqs. Options: types, subjectKey, classNum, chapterId.
  function search(query, { types = ["chapter", "topic", "faq"], subjectKey = null, classNum = null, chapterId = null, limit = 5 } = {}) {
    if (!index) return [];
    const q = tokens(query);
    if (!q.length) return [];
    const out = [];
    docs.forEach((d) => {
      if (!types.includes(d.type)) return;
      if (chapterId && d.chapter.id !== chapterId) return;
      const { score, strong, frac, n } = scoreDoc(q, d);
      if (!strong) return;
      // Coverage of the document's own name (or one of its key phrases) matters too ("tissue" ↔ "Tissues").
      const names = d.type === "chapter" ? [d.chapter.name, ...(d.chapter.aliases || [])] : d.type === "topic" ? [d.topic.title, ...(d.topic.keywords || [])] : [d.faq.q, ...(d.faq.keywords || [])];
      let nameCover = 0;
      names.forEach((n) => {
        const nt = tokens(n);
        if (!nt.length) return;
        const cov = nt.filter((x) => q.some((y) => similar(y, x))).length / nt.length;
        // a one-word key phrase only counts fully if the query is short (so "motion" doesn't swallow everything)
        nameCover = Math.max(nameCover, nt.length === 1 && q.length > 2 ? cov * 0.6 : cov);
      });
      // Tie-breaker: the document's own title names what was asked ("isotopes" → the "Isotopes and isobars" topic).
      const title = tokens(d.type === "chapter" ? d.chapter.name : d.type === "topic" ? d.topic.title : d.faq.q);
      const titleCover = title.length ? q.filter((y) => title.some((x) => similar(y, x))).length / q.length : 0;
      let s = score * 0.7 + nameCover * 0.3 + titleCover * 0.03;
      if (subjectKey) s *= d.chapter.subject === subjectKey ? 1.2 : 0.75;
      s *= classFit(d.chapter, classNum);
      // "covers": every topic word of the question appears in this document (or nearly all, for long questions).
      out.push({ ...d, score: s, nameCover, frac, covers: frac === 1 || (n >= 4 && frac >= 0.75 && score >= 0.7) });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Match one of the student's chapters (by its name) to a knowledge chapter.
  function matchChapter(name, { subjectKey = null, classNum = null } = {}) {
    if (!index) return null;
    const q = tokens(name);
    if (!q.length) return null;
    let best = null;
    (index.chapters || []).forEach((ch) => {
      if (subjectKey && ch.subject !== subjectKey) return;
      const names = [ch.name, ...(ch.aliases || [])];
      names.forEach((n) => {
        const nt = tokens(n);
        if (!nt.length) return;
        const a = nt.filter((t) => q.some((x) => similar(x, t))).length / nt.length;
        const b = q.filter((x) => nt.some((t) => similar(x, t))).length / q.length;
        const s = Math.min(a, b) * 0.6 + Math.max(a, b) * 0.4;
        const fit = s * classFit(ch, classNum);
        if (s >= 0.7 && (!best || fit > best.fit)) best = { ch, fit };
      });
    });
    return best ? best.ch : null;
  }

  async function load(chMeta) {
    if (!chMeta) return null;
    if (cache.has(chMeta.id)) return cache.get(chMeta.id);
    const p = fetchJson(baseUrl + chMeta.file).then((c) => ({ ...c, meta: chMeta })).catch(() => null);
    cache.set(chMeta.id, p);
    return p;
  }

  // General study knowledge (tips, wellbeing, how ExamFlow works).
  function generalMatch(text) {
    if (!general) return null;
    const q = tokens(text);
    const raw = " " + clean(text) + " ";
    let best = null;
    (general.entries || []).forEach((e) => {
      (e.patterns || []).forEach((p) => {
        const pt = tokens(p);
        let s;
        if (!pt.length) s = raw.includes(" " + clean(p) + " ") ? 1 : 0;
        else s = pt.filter((t) => q.some((x) => similar(x, t))).length / pt.length;
        if (s > 0 && (!best || s > best.s || (s === best.s && pt.length > best.len))) best = { e, s, len: pt.length };
      });
    });
    return best && best.s >= 0.99 ? best.e : null;
  }

  return {
    init, search, matchChapter, load, subjectKeyFor, subjectName, generalMatch,
    get index() { return index; },
    get general() { return general; },
    chaptersFor: (subjectKey, classNum) => (index ? index.chapters.filter((c) => (!subjectKey || c.subject === subjectKey) && (!classNum || !c.class || c.class === classNum)) : []),
    classesAvailable: () => (index ? [...new Set(index.chapters.map((c) => c.class).filter(Boolean))].sort((a, b) => a - b) : []),
  };
}
