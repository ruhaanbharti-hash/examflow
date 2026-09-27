// Flo · learner profile
// Who is learning, so Flo can pitch explanations at the right level. Everything is optional:
// a learner can skip it completely and Flo still works (it then gives a clear general answer).
//
// Stored in the student's ExamFlow settings (settings.flo.profile) through ExamFlow's own
// save function, so it follows them across devices. Nothing is hardcoded to one class,
// board or country — the class/course and board are free text.

export const LEVELS = [
  { id: "primary", label: "Primary school", short: "Primary" },
  { id: "middle", label: "Middle school", short: "Middle school" },
  { id: "high", label: "High school", short: "High school" },
  { id: "college", label: "College / University", short: "University" },
  { id: "competitive", label: "Competitive exam", short: "Competitive exam" },
  { id: "course", label: "Online course", short: "Online course" },
  { id: "self", label: "Self-learning", short: "Self-learner" },
  { id: "other", label: "Other", short: "Learner" },
];

// Suggestions only (the inputs accept anything).
export const COURSE_SUGGESTIONS = ["Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12", "Grade 10", "University", "JEE", "NEET", "UPSC", "CUET", "SAT", "Coding course", "French course"];
export const BOARD_SUGGESTIONS = ["CBSE", "ICSE", "State Board", "IB", "Cambridge (IGCSE)", "College curriculum", "Not applicable"];

const COMPETITIVE = /\b(jee|neet|upsc|cuet|clat|cat|gate|gmat|gre|sat|act|ssc|nda|olympiad|ntse|kvpy|bitsat|ielts|toefl|ias|banking|ibps)\b/i;
const COLLEGE = /\b(university|college|degree|b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?com|b\.?\s?a\b|bba|bca|mba|m\.?\s?tech|m\.?\s?sc|ma\b|masters|phd|undergrad|postgrad|semester|sem \d|engineering|mbbs|medical school|law school)\b/i;
const COURSE = /\b(course|bootcamp|coursera|udemy|edx|khan|certification|coding|programming|python|javascript|java|language|french|spanish|german|japanese|guitar|design|excel)\b/i;

export function parseClass(text) {
  const s = String(text || "");
  const m = s.match(/\b(?:class|grade|std|standard|year)\s*[-:]?\s*(\d{1,2})\b/i) || s.match(/^\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:class|grade|std)?\s*$/i);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 12) return n; }
  const r = s.toLowerCase().match(/\b(?:class|grade|std)\s+(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/) || s.toLowerCase().match(/^\s*(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\s*$/);
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  return r ? roman[r[1]] : null;
}

// ExamFlow's own "grade" setting is used only when the learner hasn't filled in Flo's profile.
export function resolveProfile(settings = {}) {
  const raw = (settings.flo && settings.flo.profile) || {};
  const course = String(raw.course || "").trim();
  const board = String(raw.board || "").trim();
  const grade = String(settings.grade || "").trim();
  const classNum = parseClass(course) ?? (course ? null : parseClass(grade));
  let level = LEVELS.some((l) => l.id === raw.level) ? raw.level : null;
  const inferred = inferLevel(course || grade, classNum);
  const isSet = !!(level || course || board);
  if (!level) level = inferred;
  const label = describe({ level, course: course || (classNum ? `Class ${classNum}` : ""), board, classNum });
  return { level, course, board, classNum, isSet, label, depth: depthFor(level, classNum) };
}

export function inferLevel(text, classNum) {
  const t = String(text || "");
  if (COMPETITIVE.test(t)) return "competitive";
  if (COLLEGE.test(t)) return "college";
  if (classNum) return classNum <= 5 ? "primary" : classNum <= 8 ? "middle" : "high";
  if (COURSE.test(t)) return "course";
  return null;
}

// How deep explanations should go by default. "standard" = normal school explanation.
export function depthFor(level, classNum) {
  if (level === "primary") return "simple";
  if (level === "middle") return classNum && classNum >= 8 ? "standard" : "simple";
  if (level === "college" || level === "competitive") return "detailed";
  return "standard";
}

export function describe({ level, course, board, classNum }) {
  const b = board && !/not applicable|^n\/?a$/i.test(board) ? ` (${board})` : "";
  if (level === "competitive") return `a learner preparing for ${course || "a competitive exam"}${b}`;
  if (level === "college") return `a ${course && !/^(university|college)$/i.test(course) ? course + " " : ""}university student${b}`.replace(/  +/g, " ");
  if (level === "course") return `a learner taking ${course ? "a " + course : "an online course"}`;
  if (level === "self") return course ? `a self-learner studying ${course}` : "a self-learner";
  if (classNum) return `a Class ${classNum} student${b}`;
  if (course) return `a learner (${course})${b}`;
  if (level === "primary") return "a primary school student";
  if (level === "middle") return "a middle school student";
  if (level === "high") return "a high school student";
  return "";
}

// Instructions for the AI model on how to pitch an answer for this learner.
export function audienceGuide(p) {
  switch (p.level) {
    case "primary": return "Use very simple words and short sentences, friendly tone, everyday examples (home, school, playground). Avoid jargon; if a term is needed, explain it in brackets.";
    case "middle": return "Use clear, simple language with one or two relatable examples. Introduce key terms and explain them.";
    case "high": return "Use a normal school-textbook level: correct terminology, clear definitions, a worked example where useful, and what examiners look for.";
    case "college": return "Explain at undergraduate level: precise terminology, underlying mechanisms, equations or formal definitions where relevant, and links to related concepts.";
    case "competitive": return "Be exam-focused and precise: core concepts, formulas, shortcuts, common traps, and the kind of questions asked in this exam.";
    case "course": return "Be practical and hands-on: explain concepts, then show how to apply them with a small example or exercise.";
    case "self": return "Be clear and practical, assume curiosity but no prior background unless the learner shows it.";
    default: return "Give a clear, general explanation suitable for a curious student, and avoid unnecessary jargon.";
  }
}

// Understand "I'm in class 7", "I'm preparing for JEE", "I'm a university student", "my board is ICSE".
export function parseProfileStatement(text) {
  const c = String(text || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  if (!/\b(i am|im|i m|i study|i studying|studying in|my class|my grade|my board|i go to|i\s?m in|preparing for|prepping for|im doing|i am doing|im taking|i am taking|i am a|im a)\b/.test(c)) return null;
  const out = {};
  const cls = c.match(/\b(?:class|grade|std|standard)\s*(\d{1,2}|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/) || c.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:class|grade|std|standard)\b/);
  if (cls) { const n = parseClass(`class ${cls[1]}`); if (n) { out.course = `Class ${n}`; out.level = n <= 5 ? "primary" : n <= 8 ? "middle" : "high"; } }
  const comp = c.match(/\b(?:preparing|prepping|studying|appearing|sitting)\s+for\s+(?:the\s+)?([a-z0-9 .-]{2,24}?)(?:\s+exam)?(?:$|[,.!]| and | next| this)/);
  if (comp && COMPETITIVE.test(comp[1])) { out.course = comp[1].trim().toUpperCase(); out.level = "competitive"; }
  if (/\b(university|college|undergrad|postgrad|masters|phd|b ?tech|engineering|mbbs) student\b|\bin (university|college)\b|\bdoing (my )?(b ?tech|b ?sc|b ?com|b ?a|bba|bca|mba|masters|phd|engineering)\b/.test(c)) {
    out.level = "college";
    const deg = c.match(/\b(b ?tech|b ?sc|b ?com|bba|bca|mba|m ?tech|m ?sc|masters|phd|engineering|mbbs)\b/);
    const DEG = { btech: "B.Tech", bsc: "B.Sc", bcom: "B.Com", bba: "BBA", bca: "BCA", mba: "MBA", mtech: "M.Tech", msc: "M.Sc", masters: "Master's", phd: "PhD", engineering: "Engineering", mbbs: "MBBS" };
    out.course = deg ? DEG[deg[1].replace(/ /g, "")] || deg[1] : "University";
  }
  const course = c.match(/\b(?:taking|doing|enrolled in)\s+(?:an?\s+)?([a-z0-9 +#.-]{2,30}?)\s+course\b/);
  if (course && !out.level) { out.course = course[1].replace(/\b\w/g, (x) => x.toUpperCase()) + " course"; out.level = "course"; }
  const board = c.match(/\b(cbse|icse|isc|ib|igcse|cambridge|state board|ssc board|hsc board)\b/);
  if (board && /\b(board|school|cbse|icse|ib|igcse|cambridge)\b/.test(c)) out.board = board[1] === "igcse" || board[1] === "cambridge" ? "Cambridge (IGCSE)" : board[1] === "state board" ? "State Board" : board[1].toUpperCase();
  return Object.keys(out).length ? out : null;
}
