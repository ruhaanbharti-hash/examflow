// Flo · study planner
// Builds a realistic plan from the student's real data: exam dates, which chapters are left,
// chapter difficulty/estimates, their daily study goal and the free time in their ExamFlow schedule.
// The result uses ExamFlow's own study-session format, so it can be added straight to the Planner.

import { addDays, daysBetween, toHHMM, toMin } from "./context.js";

const DIFF_MIN = { Easy: 45, Medium: 60, Hard: 90 };
const MAX_BLOCK = 60;       // longest single sitting
const BREAK = 10;           // minutes between sittings
const MIN_CHUNK = 25;

function workFor(exam, ctx) {
  const items = [];
  const weak = new Set(ctx.weakFromQuizzes.filter((w) => w.exam.id === exam.id).map((w) => w.chapter.id));
  exam.chapters.forEach((c, i) => {
    const full = Number(c.estMinutes) || DIFF_MIN[c.difficulty] || 60;
    // Order: finish what's started, then quick revisions (fast wins), then new chapters (harder ones first).
    if (c.status === "in_progress") items.push({ exam, chapter: c, kind: "finish", mins: Math.max(30, Math.round(full / 2 / 5) * 5), order: 0 + i * 0.001 });
    else if (c.status === "needs_revision" || (weak.has(c.id) && c.status !== "not_started")) items.push({ exam, chapter: c, kind: "revise", mins: 30, order: 1 + i * 0.001 });
    else if (c.status === "not_started") items.push({ exam, chapter: c, kind: "learn", mins: full, order: 2 + (c.difficulty === "Hard" ? 0 : c.difficulty === "Easy" ? 0.2 : 0.1) + i * 0.001 });
  });
  return items.sort((a, b) => a.order - b.order);
}

const LABEL = { learn: "Learn", finish: "Finish", revise: "Revise", final: "Full revision" };

/**
 * @param ctx      student context (from buildContext)
 * @param exams    exams to plan for (with dates in the future)
 * @param opts     { minutesPerDay, startDate, dayStartWeekday, dayStartWeekend, dayEnd, maxDays }
 */
export function buildPlan(ctx, exams, opts = {}) {
  const now = ctx.now;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const prefs = ctx.student.prefs || {};
  const minutesPerDay = Math.max(30, Math.min(600, opts.minutesPerDay || prefs.minutesPerDay || ctx.student.dailyGoalMinutes || 120));
  const dayEnd = toMin(opts.dayEnd || prefs.dayEnd || "21:30");
  const wkStart = toMin(opts.dayStartWeekday || prefs.dayStartWeekday || "15:00");
  const weStart = toMin(opts.dayStartWeekend || prefs.dayStartWeekend || "10:00");

  const targets = exams.filter((e) => e.date && e.daysLeft >= 1).sort((a, b) => a.daysLeft - b.daysLeft);
  if (!targets.length) return { days: [], fits: true, empty: true };

  // Start today if there's still a useful amount of evening left, otherwise tomorrow.
  let start = opts.startDate || ctx.today;
  const startsToday = start === ctx.today && nowMin < dayEnd - 60;
  if (start === ctx.today && !startsToday) start = addDays(ctx.today, 1);

  const lastExam = targets[targets.length - 1];
  const maxDays = opts.maxDays || 14;
  const horizonEnd = addDays(lastExam.date, -1) < addDays(start, maxDays - 1) ? addDays(lastExam.date, -1) : addDays(start, maxDays - 1);
  const dayCount = daysBetween(start, horizonEnd) + 1;
  if (dayCount <= 0) return { days: [], fits: false, tooLate: true, targets };

  // Work queues per exam.
  const queues = new Map(targets.map((e) => [e.id, workFor(e, ctx)]));
  const completedByExam = new Map(targets.map((e) => [e.id, e.chapters.filter((c) => ["completed", "mastered"].includes(c.status))]));

  const days = [];
  const spill = [];
  // Chapters that can be revised: already done, or learned earlier in this plan (oldest first).
  const revisable = new Map(targets.map((e) => [e.id, e.chapters.filter((c) => ["completed", "mastered"].includes(c.status))]));
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const dow = new Date(date + "T00:00:00").getDay();
    const weekend = dow === 0 || dow === 6;
    const notBefore = date === ctx.today ? Math.ceil((nowMin + 15) / 15) * 15 : (weekend ? weStart : wkStart);
    const slots = ctx.freeSlotsOn(date, { dayStart: weekend ? weStart : Math.min(wkStart, notBefore), dayEnd, notBefore });
    const free = slots.reduce((a, s) => a + (s.end - s.start), 0);
    let cap = Math.min(date === ctx.today ? Math.min(minutesPerDay, free) : minutesPerDay, free);
    const items = [];

    // Day before an exam: full revision of that subject comes first.
    targets.filter((e) => addDays(e.date, -1) === date).forEach((e) => {
      const need = Math.min(90, Math.max(45, completedByExam.get(e.id).length * 10 + 30));
      const take = Math.min(need, Math.max(0, cap));
      if (take >= MIN_CHUNK) { items.push({ exam: e, chapter: null, kind: "final", mins: take }); cap -= take; }
    });

    // Then fill the day, favouring the subject whose exam is closest relative to the work left.
    // Work is spread across the days (aiming to finish new chapters a day early), not crammed at the start.
    const quota = new Map();
    targets.forEach((e) => {
      const q = queues.get(e.id);
      if (!q.length || date >= e.date) return;
      const load = q.reduce((a, x) => a + x.mins, 0);
      const daysToGo = Math.max(1, daysBetween(date, e.date) - 2);
      quota.set(e.id, Math.max(Math.min(load, 45), Math.ceil(load / daysToGo / 15) * 15));
    });
    const doneToday = new Map();
    let guard = 0;
    while (cap >= MIN_CHUNK && guard++ < 50) {
      let bestExam = null, bestUrgency = -1;
      targets.forEach((e) => {
        const q = queues.get(e.id);
        if (!q.length || date >= e.date || !quota.has(e.id)) return;
        if ((doneToday.get(e.id) || 0) >= quota.get(e.id)) return;
        const load = q.reduce((a, x) => a + x.mins, 0);
        const daysToGo = Math.max(1, daysBetween(date, e.date) - 1);
        const u = load / daysToGo;
        if (u > bestUrgency) { bestUrgency = u; bestExam = e; }
      });
      if (!bestExam) break;
      const q = queues.get(bestExam.id);
      const item = q[0];
      const room = Math.min(cap, quota.get(bestExam.id) - (doneToday.get(bestExam.id) || 0) + 15);
      // Don't split a normal-size chapter across days if it nearly fits today.
      const take = item.mins <= cap && item.mins <= room + 30 ? item.mins : Math.min(item.mins, room);
      if (take < item.mins && take < MIN_CHUNK) break;
      items.push({ ...item, mins: take, part: take < item.mins || item.part ? (item.part || 1) : null });
      if (take < item.mins) { item.mins -= take; item.part = (item.part || 1) + 1; } else { q.shift(); if (item.chapter) revisable.get(bestExam.id).push(item.chapter); }
      cap -= take;
      doneToday.set(bestExam.id, (doneToday.get(bestExam.id) || 0) + take);
    }

    // Subjects with nothing new left but days to spare get a short spaced revision instead of an empty day.
    targets.forEach((e) => {
      if (queues.get(e.id).length || cap < 30 || daysBetween(date, e.date) < 2 || items.some((x) => x.exam.id === e.id)) return;
      const pool = revisable.get(e.id);
      if (!pool.length) return;
      const ch = pool.shift();
      pool.push(ch);
      items.push({ exam: e, chapter: ch, kind: "revise", mins: 30 });
      cap -= 30;
    });

    // Place items into real clock times, in free slots, with short breaks.
    const placed = [];
    const overflow = [];
    let si = 0, cursor = slots[0] ? slots[0].start : null;
    items.forEach((it) => {
      let left = it.mins, piece = 0;
      while (left > 0 && si < slots.length) {
        if (cursor == null || cursor >= slots[si].end) { si++; cursor = slots[si] ? slots[si].start : null; continue; }
        const room = slots[si].end - cursor;
        if (room < MIN_CHUNK && room < left) { si++; cursor = slots[si] ? slots[si].start : null; continue; }
        const len = Math.min(left, MAX_BLOCK, room);
        placed.push({ ...it, mins: len, start: toHHMM(cursor), end: toHHMM(cursor + len), piece: ++piece });
        cursor += len + BREAK;
        left -= len;
      }
      if (left > 0) overflow.push({ ...it, mins: left });
    });
    overflow.forEach((o) => { if (o.kind !== "final") spill.push(o); });
    days.push({ date, items: placed, minutes: placed.reduce((a, x) => a + x.mins, 0), free });
  }

  const unfit = [];
  queues.forEach((q) => q.forEach((x) => unfit.push(x)));
  spill.forEach((x) => unfit.push(x));
  const needed = targets.reduce((a, e) => a + workFor(e, ctx).reduce((s, x) => s + x.mins, 0), 0);
  const planned = days.reduce((a, d) => a + d.minutes, 0);
  const studyDays = Math.max(1, days.length);
  const suggestMinutes = unfit.length ? Math.ceil((needed + targets.length * 60) / studyDays / 15) * 15 : null;
  const beyondHorizon = lastExam.date > addDays(horizonEnd, 1);

  return { days, targets, unfit, fits: !unfit.length || beyondHorizon, needed, planned, minutesPerDay, suggestMinutes, beyondHorizon, start, startsToday };
}

// Convert a plan into ExamFlow study sessions (the same shape the Planner uses).
export function planToSessions(plan, makeId) {
  const out = [];
  plan.days.forEach((d) => d.items.forEach((it) => {
    const title = it.chapter ? it.chapter.name + (it.part ? ` (part ${it.part})` : "") : `${it.exam.subject}: full revision`;
    out.push({
      id: makeId(),
      examId: it.exam.id,
      subject: it.exam.subject,
      chapterId: it.chapter ? it.chapter.id : null,
      chapterName: it.kind === "learn" || !it.chapter ? title : `${LABEL[it.kind]}: ${title}`,
      date: d.date,
      start: it.start,
      end: it.end,
      completed: false,
    });
  }));
  return out;
}

export function itemLabel(it) {
  if (!it.chapter) return `Full revision: all ${it.exam.subject} chapters`;
  const part = it.part ? ` (part ${it.part})` : "";
  return `${it.kind === "learn" ? "" : LABEL[it.kind] + ": "}${it.chapter.name}${part}`;
}
