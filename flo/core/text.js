// Flo · text helpers
// Turning messy student language into something Flo can reason about.

const STOPWORDS = new Set((
  "a an the is am are was were be been being to of in on at for and or but if so as by with from into " +
  "i me my mine we our you your u ur it its this that these those there here " +
  "please pls plz can could would should will shall do does did done doing have has had " +
  "just really very quite some any also too then than what whats which who whom whose how " +
  "about tell give get got want wanna gonna need let lets make me im ive id youre dont cant wont isnt"
).split(" "));

// Common student spellings / shortcuts → one canonical word.
const SYNONYMS = {
  maths: "math", mathematics: "math", sci: "science", bio: "biology", chem: "chemistry", phy: "physics", phys: "physics",
  sst: "social", evs: "environment", eng: "english", grammer: "grammar", hw: "homework", ch: "chapter", chap: "chapter",
  chp: "chapter", lesson: "chapter", unit: "chapter", ques: "question", qs: "question", qn: "question", ans: "answer",
  exams: "exam", test: "exam", tests: "exam", paper: "exam", papers: "exam", boards: "board",
  revise: "revision", revising: "revision", revised: "revision", recap: "revision",
  explian: "explain", expalin: "explain", explane: "explain", xplain: "explain", teach: "explain",
  procastinate: "procrastinate", procrastinating: "procrastinate", procrastination: "procrastinate",
  concentrate: "focus", concentration: "focus", distracted: "focus",
  anxious: "stress", anxiety: "stress", nervous: "stress", tension: "stress", stressed: "stress", scared: "stress", panic: "stress",
  tmrw: "tomorrow", tmr: "tomorrow", tomorow: "tomorrow", tommorow: "tomorrow", "2day": "today", tdy: "today",
  wk: "week", hrs: "hour", hr: "hour", hours: "hour", mins: "minute", min: "minute", minutes: "minute",
  wat: "what", wht: "what", wot: "what", abt: "about", bcz: "because", coz: "because", cuz: "because",
  n: "and", nd: "and", r: "are", y: "why", k: "ok", okay: "ok", okk: "ok", thx: "thanks", ty: "thanks", thanku: "thanks",
};

export function clean(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9%+\-*/×÷^.()\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) return w.slice(0, -2);
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// "Tokens": normalised, synonym-mapped, stemmed words.
export function tokens(text, { keepStop = false } = {}) {
  const out = [];
  clean(text).replace(/[%+\-*/×÷^.()]/g, " ").split(" ").forEach((raw) => {
    if (!raw) return;
    const w = SYNONYMS[raw] || raw;
    if (!keepStop && STOPWORDS.has(w)) return;
    out.push(stem(w));
  });
  return out;
}

export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Same word, allowing for typos in longer words ("photosyntesis").
export function similar(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) {
    if (a.startsWith(b) || b.startsWith(a)) return Math.min(a.length, b.length) >= 5 && Math.abs(a.length - b.length) <= 3;
    const max = Math.min(a.length, b.length) >= 9 ? 2 : 1;   // one typo in normal words, two in long words
    return a[0] === b[0] && editDistance(a, b, max) <= max;
  }
  return false;
}

export function hasAny(text, words) {
  const c = " " + clean(text) + " ";
  return words.some((w) => c.includes(" " + w + " ") || (w.includes(" ") && c.includes(w)));
}

export function pick(list, rnd = Math.random) {
  return list[Math.floor(rnd() * list.length)];
}

export function shuffle(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

// Escape text for safe HTML, then allow **bold** and `code`.
export function richText(s) {
  const safe = String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}
