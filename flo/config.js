// Flo · settings
// Change these without touching the rest of Flo.
export default {
  // Where the trusted knowledge library lives (relative to this file).
  knowledgeBase: new URL("./knowledge/", import.meta.url).href,

  // The AI layer. null = Flo's built-in LocalProvider: no AI model, only trusted notes + the student's data.
  // Later you can plug in a stronger model here (see core/provider.js → createModelProvider).
  provider: null,

  // How many past conversations each student keeps (stored in their own browser).
  maxConversations: 12,
  maxMessagesPerConversation: 80,

  // Text on the floating button (desktop).
  launcherLabel: "Ask Flo",
};
