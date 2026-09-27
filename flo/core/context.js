// Flo · student context
// Reads the student's real ExamFlow data (through the app's bridge) and turns it into
// ready-to-use facts: upcoming exams, pace, what's pending, free time, weak areas.
// Nothing here is stored separately — it is recomputed from ExamFlow's own data every time.

import { resolveProfile } from "./profile.js";

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (dateStr, n) => { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
export const toMin = (hhmm) => { const [h, m] = String(hhmm || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const niceDate = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

const STATUS_WEIGHT = { mastered: 1, completed: 1, needs_revision: 0.75, in_progress: 0.5, not_started: 0 };
export const STATUS_LABEL = { not_started: "Not started", in_progress: "Learning", completed: "Completed", needs_revision: "Needs revision", mastered: "Mastered" };
const DIFF_MIN = { Easy: 45, Medium: 60, Hard: 90 };

// Fallbacks mirror ExamFlow's own helpers, used only if the bridge doesn't provide them.
const localHelpers = {
  chapterStatus: (c) => c.status || (c.completed ? "completed" : "not_started"),
  percent(chapters) {
    if (!chapters || !chapters.length) return 0;
    const s = chapters.reduce((a, c) => a + (STATUS_WEIGHT[localHelpers.chapterStatus(c)] ?? (c.completed ? 1 : 0)), 0);
    return Math.round((s / chapters.length) * 100);
  },
  pace(daysLeft, pct) {
    if (pct >= 90) return { label: "On Track" };
    if (daysLeft <= 3 && pct < 80) return { label: "Behind Schedule" };
    if (daysLeft <= 7 && pct < 50) return { label: "Behind Schedule" };
    if (pct < 50) return { label: "Needs Attention" };
    return { label: "On Track" };
  },
  sessionMinutes: (s) => Math.max(0, toMin(s.end) - toMin(s.start)),
};

function blockOccursOn(block, date) {
  if (!block || !block.date || date < block.date || (block.until && date > block.until)) return false;
  const dow = new Date(date + "T00:00:00").getDay();
  switch (block.repeat) {
    case "daily": return true;
    case "weekdays": return dow >= 1 && dow <= 5;
    case "weekly": return dow === new Date(block.date + "T00:00:00").getDay();
    default: return date === block.date;
  }
}

export function buildContext(snapshot, helpers = {}, now = new Date()) {
  const H = { ...localHelpers, ...helpers };
  const s = snapshot || {};
  const settings = s.settings || {};
  const today = ymd(now);
  const profile = resolveProfile(settings);
  const status = (c) => (H.chapterStatus ? H.chapterStatus(c) : localHelpers.chapterStatus(c));

  const exams = (s.exams || []).filter(Boolean).map((e) => {
    const chapters = (Array.isArray(e.chapters) ? e.chapters : []).map((c) => ({
      ...c,
      status: status(c),
      mins: Number(c.estMinutes) || DIFF_MIN[c.difficulty] || 60,
    }));
    const valid = e.examDate && !Number.isNaN(new Date(e.examDate).getTime());
    const date = valid ? ymd(new Date(e.examDate)) : null;
    const daysLeft = date ? daysBetween(today, date) : null;
    const pct = H.percent(e.chapters || []);
    const pace = date && daysLeft >= 0 ? H.pace(daysLeft, pct) : null;
    const remaining = chapters.filter((c) => !["completed", "mastered"].includes(c.status));
    return {
      id: e.id, subject: String(e.subject || "Subject"), examName: e.examName || null, priority: e.priority || "Medium",
      color: e.color, examDate: e.examDate || null, date, daysLeft, time: valid ? new Date(e.examDate).toTimeString().slice(0, 5) : null,
      chapters, remaining, percent: pct, pace: pace ? pace.label : null,
      done: chapters.filter((c) => ["completed", "mastered"].includes(c.status)).length,
      raw: e,
    };
  });

  const upcoming = exams.filter((e) => e.date && e.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft);
  const sessions = s.sessions || [];
  const tasks = s.tasks || [];
  const schedule = s.schedule || [];
  const quizzes = s.quizzes || [];

  // Study minutes over the last 7 days (completed sessions only, like ExamFlow's Progress page).
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    week.push({ date: d, minutes: sessions.filter((x) => x.completed && x.date === d).reduce((a, x) => a + H.sessionMinutes(x), 0) });
  }
  let streak = 0;
  {
    const doneDays = new Set(sessions.filter((x) => x.completed).map((x) => x.date));
    let d = doneDays.has(today) ? today : addDays(today, -1);
    while (doneDays.has(d)) { streak++; d = addDays(d, -1); }
  }

  // Latest quiz score per chapter, and weak chapters from quizzes.
  const lastQuiz = {};
  [...quizzes].sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).forEach((q) => { if (q.chapterId) lastQuiz[q.chapterId] = q; });

  const findExam = (id) => exams.find((e) => e.id === id) || null;
  const findChapter = (examId, chapterId) => { const e = findExam(examId); return e ? e.chapters.find((c) => c.id === chapterId) || null : null; };

  // Busy time on a date = schedule blocks + already-planned study sessions.
  const busyOn = (date) => {
    const list = [];
    schedule.forEach((b) => { if (blockOccursOn(b, date) && b.start && b.end) list.push({ start: toMin(b.start), end: toMin(b.end), title: b.title, kind: b.kind }); });
    sessions.forEach((x) => { if (x.date === date && x.start && x.end) list.push({ start: toMin(x.start), end: toMin(x.end), title: x.chapterName || x.subject, kind: "session" }); });
    return list.sort((a, b) => a.start - b.start);
  };

  // Free study slots on a date between dayStart and dayEnd (defaults: 7am–9:30pm).
  const freeSlotsOn = (date, { dayStart = 7 * 60, dayEnd = 21 * 60 + 30, notBefore = null } = {}) => {
    let start = dayStart;
    if (notBefore != null) start = Math.max(start, notBefore);
    const slots = [];
    busyOn(date).forEach((b) => {
      if (b.end <= start) return;
      if (b.start > start) slots.push({ start, end: Math.min(b.start, dayEnd) });
      start = Math.max(start, b.end);
    });
    if (start < dayEnd) slots.push({ start, end: dayEnd });
    return slots.filter((x) => x.end - x.start >= 20);
  };

  const nextUp = () => {
    if (typeof H.nextUp === "function") {
      try {
        return (H.nextUp(s.exams || [], now) || []).map((p) => ({ exam: findExam(p.examId), chapter: findChapter(p.examId, p.chapter && p.chapter.id), daysLeft: p.daysLeft })).filter((p) => p.exam && p.chapter);
      } catch (e) { /* fall through */ }
    }
    const picks = [];
    upcoming.forEach((e) => e.remaining.forEach((c) => {
      const score = (100 / Math.max(1, e.daysLeft)) * 2 + ({ High: 3, Medium: 2, Low: 1 }[e.priority] || 1) * 5 + ({ Hard: 3, Medium: 2, Easy: 1 }[c.difficulty] || 1) * 3;
      picks.push({ exam: e, chapter: c, daysLeft: e.daysLeft, score });
    }));
    return picks.sort((a, b) => b.score - a.score).slice(0, 4);
  };

  return {
    now, today,
    student: {
      name: settings.studentName && settings.studentName !== "Student" ? settings.studentName : (s.user && s.user.name) || "",
      grade: settings.grade || "", classNum: profile.classNum, school: settings.school || "",
      dailyGoalMinutes: Number(settings.dailyGoalMinutes) || 120,
      prefs: settings.flo || {},
      profile,
    },
    exams, upcoming,
    sessions, tasks, schedule, quizzes, lastQuiz,
    todaySessions: sessions.filter((x) => x.date === today),
    missedSessions: sessions.filter((x) => !x.completed && x.date < today),
    overdueTasks: tasks.filter((t) => !t.completed && t.dueDate && t.dueDate < today),
    todayTasks: tasks.filter((t) => !t.completed && t.dueDate === today),
    openTasks: tasks.filter((t) => !t.completed),
    week, weekMinutes: week.reduce((a, d) => a + d.minutes, 0), streak,
    needsRevision: exams.flatMap((e) => e.chapters.filter((c) => c.status === "needs_revision").map((c) => ({ exam: e, chapter: c }))),
    weakFromQuizzes: Object.values(lastQuiz).filter((q) => q.percent < 60).map((q) => ({ q, exam: findExam(q.examId), chapter: findChapter(q.examId, q.chapterId) })).filter((x) => x.exam && x.chapter),
    findExam, findChapter, busyOn, freeSlotsOn, nextUp,
    helpers: H,
    page: s.page || null,
  };
}
