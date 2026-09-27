// Flo · understanding
// Works out what the student wants (the "intent"), which subject/chapter/topic they mean,
// and details like "in 3 days" or "explain simply". Uses the student's OWN subject and chapter
// names from ExamFlow, so newly added subjects work automatically. No hardcoded subject list.

import { clean, tokens, similar, hasAny } from "./text.js";

const MODE_WORDS = {
  explain: ["explain", "what is", "what are", "whats", "meaning of", "define", "definition", "tell me about", "teach me", "help me understand", "understand", "concept of", "how does", "describe", "what do you mean", "elaborate", "break down", "breakdown"],
  notes: ["notes", "note", "short notes", "make notes", "key points", "summary", "summarise", "summarize", "cheat sheet", "one pager", "points for", "formulas", "formula list", "all formulas", "formula sheet"],
  quiz: ["quiz", "test me", "question me", "ask me", "mcq", "mcqs", "practice questions", "practise questions", "check my knowledge", "check me", "questions on", "test my"],
  revise: ["revise", "revision", "recap", "brush up", "go over", "quick review", "review", "refresh", "flashcards", "flash cards"],
  doubt: ["doubt", "why", "how come", "confused", "dont understand", "didnt understand", "dont get", "didnt get", "not clear", "difference between", "differentiate", "compare", " vs ", "versus", "how is", "is it true", "can you clear", "clear my"],
  plan: ["plan", "study plan", "timetable", "time table", "schedule for", "prepare", "preparation", "how should i study", "how do i study", "crash plan", "strategy", "havent started", "not started", "no preparation", "zero preparation", "nothing done", "cover everything", "finish syllabus", "finish the syllabus", "complete syllabus", "complete the syllabus", "exam in", "exam is in", "exams in"],
  progress: ["progress", "how am i doing", "how i am doing", "analysis", "analyse", "analyze", "report card", "performance", "am i on track", "on track", "behind", "where do i stand", "weak areas", "weak subjects", "my weak", "strengths", "how much done", "how much have i", "how far"],
};

const STYLE_WORDS = {
  simple: ["simply", "simple", "simpler", "easy words", "easier", "like im 10", "like i am 10", "like a kid", "eli5", "basic", "in short and simple", "dumb it down"],
  detailed: ["in detail", "detailed", "more detail", "more details", "deeper", "deep dive", "elaborate", "longer", "full explanation", "tell me more", "more about"],
  example: ["example", "examples", "real life", "real world", "give an example", "for instance", "show me an example"],
  short: ["shorter", "short", "brief", "briefly", "tldr", "in one line", "quickly", "sum it up", "shorten"],
};

const SMALL = {
  greet: ["hi", "hii", "hiii", "hello", "hey", "heyy", "yo", "hola", "namaste", "good morning", "good afternoon", "good evening", "sup", "wassup"],
  thanks: ["thanks", "thank you", "thank u", "tysm", "ty", "thx", "that helped", "helpful", "great help", "nice", "cool", "awesome", "perfect"],
  bye: ["bye", "goodbye", "see you", "see ya", "good night", "gn", "cya", "later"],
  who: ["who are you", "what are you", "your name", "are you ai", "are you a bot", "are you a robot", "who made you", "are you chatgpt", "are you gemini", "are you real", "are you human"],
  help: ["help", "what can you do", "how do you work", "how to use", "features", "commands", "menu", "options"],
  yes: ["yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "ok do it", "do it", "go ahead", "please do", "add it", "add them", "sounds good", "lets do it", "lets go", "alright", "haan", "ha", "hmm ok"],
  no: ["no", "nope", "nah", "not now", "later", "skip", "cancel", "never mind", "nevermind", "no thanks"],
};

const CRISIS = ["want to die", "wanna die", "kill myself", "end my life", "end it all", "hurt myself", "harm myself", "self harm", "selfharm", "suicide", "suicidal", "no reason to live", "dont want to live", "better off dead", "cut myself"];

const NEXT_PATTERNS = [/\bwhat (should|shall|do|can) i (study|do|focus on|work on|start|revise|learn)\b/, /\bwhat (to|should i) study\b/, /\bwhere (do|should) i (start|begin)\b/, /\bwhat next\b/, /\bstudy (now|today|tonight)\b/, /\bwhat.{0,10}\b(first|next)\b/, /\bsuggest.{0,15}\b(study|chapter|topic)\b/];
const EXAM_INFO = [/\bwhen (is|are)\b.{0,30}\bexam/, /\bhow many days\b/, /\bdays (left|until|till|to go|remaining)\b/, /\b(next|upcoming) exams?\b/, /\bmy exams?\b.{0,12}\b(dates?|schedule|list)\b/, /\bexam dates?\b/, /\bdate sheet\b/, /\bwhen\b.{0,20}\b(test|paper)\b/];
const TASK_INFO = [/\b(my|pending|due|open) (tasks|homework|assignments|to ?dos?)\b/, /\bwhats? (due|pending)\b/, /\bhomework (due|pending|left)\b/, /\bany (tasks|homework)\b/, /\boverdue\b/];
const TODAY_INFO = [/\b(todays?|today s) (plan|schedule|sessions?)\b/, /\bwhats? on today\b/, /\bmy (day|schedule) today\b/, /\bwhat.{0,12}planned (for )?today\b/, /\bfree time\b/];
const FOCUS = [/\b(start|begin|open)\b.{0,20}\b(focus|timer|pomodoro|session)\b/, /\bpomodoro\b/, /\bfocus timer\b/, /\bfocus mode\b/, /\btimer\b/];

// Words that describe WHAT the student wants to do, not WHICH topic. Removed before searching knowledge.
const FILLER = new Set(tokens([
  "explain explanation explaining teach tell know learn understand understanding meaning define definition describe concept",
  "notes note summary summarise summarize key points cheat sheet make create give write prepare",
  "quiz quizzes test question questions mcq mcqs practice practise check ask",
  "revise revision recap review brush refresh flashcards flash cards go over",
  "doubt doubts confused clear why how come difference between compare differentiate",
  "plan planning schedule timetable strategy study studying exam exams chapter chapters topic topics subject subjects lesson",
  "simple simply simpler easy easier detail detailed more deeper example examples short shorter brief briefly quickly",
  "help please want need can could would should me my i you it this that these those same above again next now today",
  "one some something thing stuff about on for of in the a an and or with properly fully just really very bit little",
  "progress analyze analyse analysis performance report doing done due pending overdue task tasks homework assignment",
  "today tonight tomorrow week weekend day days hour hours minute minutes time timer focus session sessions start begin",
  "finish complete completed left remaining ready preparation prepared started starting haven havent",
].join(" "), { keepStop: true }));

export function contentTokens(text) {
  return tokens(text).filter((t) => !FILLER.has(t));
}

// The topic words as the student typed them ("photosyntesis"), for honest "I don't know X" replies.
export function contentPhrase(text) {
  return clean(text).split(" ").filter((w) => w && !/^[\d%+\-*/().]+$/.test(w)).filter((w) => { const t = tokens(w); return t.length && !FILLER.has(t[0]); }).join(" ");
}

function matchAny(regexes, text) { return regexes.some((r) => r.test(text)); }

function detectStyle(raw) {
  for (const [style, words] of Object.entries(STYLE_WORDS)) if (hasAny(raw, words)) return style;
  return null;
}

function detectMode(raw, c) {
  // Order matters: more specific signals first.
  if (hasAny(raw, MODE_WORDS.quiz) || /\bquiz\b/.test(c) || /\btest (me|my)\b/.test(c)) return "quiz";
  if (hasAny(raw, MODE_WORDS.plan) && !/\bplanner\b/.test(c)) return "plan";
  if (hasAny(raw, MODE_WORDS.progress)) return "progress";
  if (hasAny(raw, MODE_WORDS.notes)) return "notes";
  if (hasAny(raw, MODE_WORDS.revise)) return "revise";
  if (hasAny(raw, MODE_WORDS.doubt)) return "doubt";
  if (hasAny(raw, MODE_WORDS.explain)) return "explain";
  return null;
}

function parseDays(c, today) {
  let m;
  if (/\bday after tomorrow\b/.test(c)) return 2;
  if (/\btomorrow\b/.test(c)) return 1;
  if (/\btoday\b/.test(c) && /\bexam\b/.test(c)) return 0;
  if ((m = c.match(/\b(\d{1,3})\s*(days?|d)\b/))) return Number(m[1]);
  if ((m = c.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/))) return ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"].indexOf(m[1]) + 1;
  if ((m = c.match(/\b(\d{1,2})\s*weeks?\b/))) return Number(m[1]) * 7;
  if (/\b(a|one) week\b/.test(c) || /\bnext week\b/.test(c)) return 7;
  if (/\bthis week\b/.test(c)) return 7 - new Date(today + "T00:00:00").getDay();
  if ((m = c.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(m[1]);
    const d = new Date(today + "T00:00:00").getDay();
    return ((target - d + 7) % 7) || 7;
  }
  return null;
}

function parseHoursPerDay(c) {
  let m;
  if ((m = c.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:hours?|hrs?|h)\b\s*(?:a|per|each|every)?\s*day\b/))) return Math.round(Number(m[1]) * 60);
  if ((m = c.match(/\b(\d{2,3})\s*(?:minutes?|mins?)\b\s*(?:a|per|each|every)\s*day\b/))) return Number(m[1]);
  return null;
}

// Find which of the student's own subjects (exams) the message is about.
function findStudentSubject(msgToks, raw, ctx, knowledge) {
  const found = [];
  ctx.exams.forEach((e) => {
    const st = tokens(e.subject);
    if (!st.length) return;
    const hit = st.filter((t) => msgToks.some((m) => similar(m, t))).length / st.length;
    if (hit >= 0.99 || (st.length >= 2 && hit >= 0.5)) found.push({ exam: e, score: hit + st.length * 0.01 });
  });
  // "physics" / "bio" → the student's Science exam, via the knowledge subject aliases.
  if (!found.length && knowledge && knowledge.index) {
    const keys = new Set();
    msgToks.forEach((t) => { const k = knowledge.subjectKeyFor(t); if (k) keys.add(k); });
    keys.forEach((k) => ctx.exams.forEach((e) => { if (knowledge.subjectKeyFor(e.subject) === k) found.push({ exam: e, score: 0.8, viaKey: k }); }));
    if (!found.length && keys.size) return { subjectKey: [...keys][0], exam: null };
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  return { exam: found[0].exam, subjectKey: knowledge ? knowledge.subjectKeyFor(found[0].exam.subject) : null, others: found.slice(1).map((f) => f.exam) };
}

// Find which of the student's chapters the message mentions.
// Words common in chapter titles that don't identify a chapter on their own ("Heron's Formula" vs "distance formula").
const GENERIC_CHAPTER_WORDS = new Set(tokens("formula formulas introduction exploring basics part", { keepStop: true }));

function findStudentChapter(msgToks, ctx, exam) {
  const pool = exam ? [exam] : ctx.exams;
  const all = pool.flatMap((e) => e.chapters.map((c) => ({ exam: e, chapter: c })));
  // document frequency of words across chapter names, so "the"/"and"/"motion" don't dominate.
  const df = new Map();
  all.forEach(({ chapter }) => new Set(tokens(chapter.name)).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  let best = null;
  all.forEach((x) => {
    const nt = tokens(x.chapter.name);
    if (!nt.length) return;
    let hitW = 0, totW = 0, hits = 0;
    nt.forEach((t) => {
      const w = 1 / (df.get(t) || 1);
      totW += w;
      if (msgToks.some((m) => similar(m, t))) { hitW += w; if (!GENERIC_CHAPTER_WORDS.has(t)) hits++; }
    });
    const cover = hitW / totW;
    const need = nt.length === 1 ? 1 : 0.5;
    if (hits && cover >= need && (!best || cover > best.cover || (cover === best.cover && hits > best.hits))) best = { ...x, cover, hits };
  });
  return best;
}

export function understand(message, state, ctx, knowledge) {
  const raw = String(message || "");
  const c = clean(raw);
  const msgToks = tokens(raw);
  const frame = { raw, c, intent: null, mode: null, style: detectStyle(raw), exam: null, chapter: null, subjectKey: null, kHits: [], days: parseDays(c, ctx.today), hoursPerDay: parseHoursPerDay(c), notStarted: /\b(havent|have not|not|didnt|did not|never) (even )?(started|begun|start|begin|studied|opened)\b|\bzero prep|\bnothing (done|prepared)\b/.test(c), count: null, usedFocus: false };
  const m = c.match(/\b(\d{1,2})\s*(questions?|qs|mcqs?)\b/); if (m) frame.count = Number(m[1]);

  if (hasAny(raw, CRISIS)) { frame.intent = "crisis"; return frame; }

  // Entities
  const subj = findStudentSubject(msgToks, raw, ctx, knowledge);
  if (subj) { frame.exam = subj.exam; frame.subjectKey = subj.subjectKey; frame.otherExams = subj.others || []; }
  const chap = findStudentChapter(contentTokens(raw), ctx, frame.exam);
  if (chap) { frame.chapter = chap.chapter; frame.exam = chap.exam; frame.subjectKey = frame.subjectKey || (knowledge ? knowledge.subjectKeyFor(chap.exam.subject) : null); }

  // Short, content-free messages: small talk, confirmations and follow-ups.
  const words = c.split(" ").filter(Boolean);
  const isShort = words.length <= 4;
  const onlySmall = (list) => hasAny(raw, list) && isShort;
  if (onlySmall(SMALL.yes) && !frame.chapter && !frame.exam && words.length <= 3) { frame.intent = "yes"; return frame; }
  if (onlySmall(SMALL.no) && words.length <= 3) { frame.intent = "no"; return frame; }

  // Calculations
  if (/^[\d\s+\-*/().x×÷^%]+[=?]?$/.test(c.replace(/^(what is|whats|calculate|calc|solve|compute)\s+/, "")) && /\d\s*[+\-*/x×÷^%]\s*\d|\broot\b/.test(c)) { frame.intent = "math"; return frame; }
  if ((/\b(square root|sqrt)\b/.test(c) && !/\b(explain|why|prove|proof|irrational|rational|show)\b/.test(c)) || /\b\d+(\.\d+)?\s*% of \d/.test(c)) { frame.intent = "math"; return frame; }

  frame.mode = detectMode(raw, c);

  // Questions about the student's own ExamFlow data ("what's due", "when is my exam", "what should I study").
  const info = matchAny(NEXT_PATTERNS, c) ? "next" : matchAny(EXAM_INFO, c) ? "examInfo" : matchAny(TASK_INFO, c) ? "tasks" : matchAny(TODAY_INFO, c) ? "today" : matchAny(FOCUS, c) ? "focus" : null;
  if (info && (!frame.mode || ["explain", "doubt"].includes(frame.mode) || (frame.mode === "revise" && info === "next" && !frame.chapter) || (info === "focus" && !["quiz", "plan", "notes"].includes(frame.mode)))) {
    frame.mode = null;
    frame.intent = info;
  }
  if (!frame.mode && !frame.intent) {
    if (hasAny(raw, SMALL.who)) frame.intent = "who";
    else if (onlySmall(SMALL.help) || /\bwhat can you do\b/.test(c)) frame.intent = "help";
    else if (onlySmall(SMALL.greet)) frame.intent = "greet";
    else if (onlySmall(SMALL.thanks)) frame.intent = "thanks";
    else if (onlySmall(SMALL.bye)) frame.intent = "bye";
  }

  // Style-only follow-ups: "simpler", "give an example", "shorter" → re-explain the last topic.
  const content = contentTokens(raw);
  frame.content = content;
  const recentFocus = state.focus && (state.turn || 0) - (state.focus.turn || 0) <= 4 ? state.focus : null;
  if (/\bnext topic\b|\bexplain the next\b/.test(c) && recentFocus && recentFocus.kChapterId) { frame.intent = "nextTopic"; return frame; }
  if (!frame.mode && !frame.intent && frame.style && !frame.chapter && !content.length && words.length <= 7) { frame.intent = "restyle"; return frame; }
  if (frame.mode && frame.style && !frame.chapter && !frame.exam && !content.length && ["explain", "notes"].includes(frame.mode) && recentFocus && recentFocus.kTopicId) { frame.intent = "restyle"; return frame; }

  // Knowledge hits (trusted content), searched with only the topic words and scoped to the subject when known.
  const query = content.length ? content.join(" ") : "";
  if (knowledge && knowledge.index && query) {
    frame.kHits = knowledge.search(query, { subjectKey: frame.subjectKey, classNum: ctx.student.classNum, limit: 6 });
  }
  const top = frame.kHits[0];
  const strongAcademic = !!(top && top.score >= 0.6 && top.nameCover >= 0.5);

  // General study knowledge (study tips, stress, ExamFlow how-to) when nothing academic matched.
  if (knowledge && (!frame.mode || ["explain", "doubt"].includes(frame.mode)) && (!frame.intent || frame.intent === "focus")) {
    const g = knowledge.generalMatch(raw);
    if (g && !strongAcademic && !frame.chapter) { frame.mode = null; frame.intent = "general"; frame.general = g; return frame; }
  }

  // Pronouns and bare follow-ups ("quiz me on it", "notes for this") use what we were just talking about.
  const topicModes = ["explain", "notes", "quiz", "revise", "doubt"];
  const pronoun = /\b(it|this|that|these|those|same|above)\b/.test(c);
  const bare = frame.mode && topicModes.includes(frame.mode) && !frame.chapter && !frame.exam && !content.length;
  if (recentFocus && !frame.chapter && (pronoun || bare) && (topicModes.includes(frame.mode) || pronoun)) {
    const f = recentFocus;
    if (f.examId) frame.exam = frame.exam || ctx.findExam(f.examId);
    if (f.chapterId && frame.exam && frame.exam.id === f.examId) frame.chapter = ctx.findChapter(f.examId, f.chapterId);
    frame.focusRef = f;
    frame.usedFocus = true;
  }

  if (frame.mode) { frame.intent = frame.mode; return frame; }
  if (frame.intent) return frame;

  // No explicit mode: decide from what they mentioned.
  if (frame.days != null && frame.exam) { frame.intent = "plan"; return frame; }
  if (/\?$/.test(raw.trim()) || /^(why|how|what|when|where|which|is|are|can|does|do)\b/.test(c)) {
    if (top && top.score >= 0.45) { frame.intent = "doubt"; return frame; }
    if (frame.chapter) { frame.intent = "explain"; return frame; }
  }
  if (frame.chapter || (top && top.score >= 0.6 && top.nameCover >= 0.5)) { frame.intent = "explain"; return frame; }
  if (frame.exam && words.length <= 4) { frame.intent = "subject"; return frame; }
  if (top && top.score >= 0.5) { frame.intent = "doubt"; return frame; }
  frame.intent = "unknown";
  return frame;
}

export const _test = { detectMode, parseDays, parseHoursPerDay, detectStyle };
