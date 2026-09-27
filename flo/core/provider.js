// Flo · the AI layer
// Flo talks to its "brain" only through this small interface, so the brain can be swapped later
// without touching the rest of Flo.
//
//   provider.name                       → shown in settings/debug
//   provider.canAnswerOpenQuestions     → true only for a real language model
//   provider.present(task)              → turns trusted content into wording for the student
//   provider.answer({ question, grounding, student })  → optional, for questions the knowledge
//                                          library doesn't cover. Must return { text, confident }.
//
// Default: the LocalProvider — no AI model at all. It only ever uses ExamFlow's own trusted
// knowledge library and the student's data, and it never invents facts.

function firstSentences(text, n) {
  const parts = String(text || "").match(/[^.!?]+[.!?]+(\s|$)/g) || [String(text || "")];
  return parts.slice(0, n).join("").trim();
}

export const LocalProvider = {
  name: "ExamFlow knowledge library (no AI model)",
  canAnswerOpenQuestions: false,

  // Choose the right piece of trusted content for the requested style.
  present({ topic, style }) {
    const t = topic || {};
    switch (style) {
      case "short": return t.summary || firstSentences(t.explain || t.simple, 2);
      case "simple": return t.simple || firstSentences(t.explain, 3);
      case "example": return t.example ? t.example : null;
      case "detailed": return [t.explain || t.simple, t.deep].filter(Boolean).join("\n\n");
      default: return t.explain || t.simple || t.summary || "";
    }
  },

  async answer() {
    return { text: null, confident: false };
  },
};

// Example of how a stronger model could be plugged in later (not enabled).
// It must only answer from the grounding it is given, and say when it isn't sure.
export function createModelProvider({ name, generate }) {
  return {
    name,
    canAnswerOpenQuestions: true,
    present: LocalProvider.present,
    async answer({ question, grounding, student }) {
      const system =
        "You are Flo, ExamFlow's study companion for school students. Answer ONLY using the notes provided. " +
        "If the notes do not contain the answer, reply exactly: I_DONT_KNOW. Keep it simple for a " +
        (student.grade || "school") + " student.";
      const notes = grounding.map((g) => `# ${g.title}\n${g.text}`).join("\n\n");
      const text = await generate({ system, prompt: `NOTES:\n${notes}\n\nQUESTION: ${question}` });
      if (!text || /I_DONT_KNOW/.test(text)) return { text: null, confident: false };
      return { text, confident: true, generated: true };
    },
  };
}
