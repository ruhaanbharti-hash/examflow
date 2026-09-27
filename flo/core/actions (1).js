// Flo · actions
// Everything Flo changes goes through ExamFlow's own functions (exposed by the app bridge),
// so it appears instantly on the Planner / Tasks / Notes / Practice pages and syncs like
// any other change. Flo never writes to the server directly.

const STATUS_WORDS = { mastered: "Mastered", needs_revision: "Needs revision", completed: "Completed", in_progress: "Learning", not_started: "Not started" };
const nice = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export async function runAction(bridge, action) {
  if (!action || !bridge) return { ok: false, text: "That action isn't available right now." };
  try {
    switch (action.type) {
      case "addSessions": {
        const n = await bridge.act("addSessions", action.sessions);
        return { ok: true, text: `Added ${n} study session${n === 1 ? "" : "s"} to your Planner. You can move or delete any of them there.`, follow: { label: "Open Planner", action: { type: "openPage", page: "planner" } } };
      }
      case "addRevision":
        await bridge.act("addRevision", action.examId, action.chapterId, action.date);
        return { ok: true, text: `Revision task added for ${nice(action.date)}.`, follow: { label: "Open Tasks", action: { type: "openPage", page: "tasks" } } };
      case "addNote":
        await bridge.act("addNote", action.text, action.examId || null);
        return { ok: true, text: "Saved to your Notes. 📝", follow: { label: "Open Notes", action: { type: "openPage", page: "notes" } } };
      case "markRevised":
        await bridge.act("markRevised", action.examId, action.chapterId);
        return { ok: true, text: "Revision logged ✓ Nice work." };
      case "setStatus":
        await bridge.act("setChapterStatus", action.examId, action.chapterId, action.status);
        return { ok: true, text: `Chapter marked as **${STATUS_WORDS[action.status] || action.status}**.` };
      case "openFocus":
        await bridge.act("openFocus", action.examId, action.chapterId);
        return { ok: true, text: "Focus timer opened. Good luck! 🎯", close: true };
      case "reviewSyllabus": {
        // Opens ExamFlow's own "Review & confirm" screen — the learner edits and confirms there.
        const n = await bridge.act("reviewSyllabus", action.subjects);
        if (!n) return { ok: false, text: "ExamFlow couldn't open the review screen. Please refresh the page and try again." };
        return { ok: true, silent: true, closeAlways: true };
      }
      case "openPage":
        await bridge.act("goTo", action.page);
        return { ok: true, silent: true, close: true };
      default:
        return { ok: false, text: "I don't know how to do that yet." };
    }
  } catch (e) {
    console.error("[Flo] action failed", action.type, e);
    return { ok: false, text: "Sorry, that didn't work. Please try again." };
  }
}
