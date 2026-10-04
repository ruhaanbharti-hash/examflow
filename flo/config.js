// Flo · settings
// Change these without touching the rest of Flo.
export default {
  // Where the trusted knowledge library lives (relative to this file).
  knowledgeBase: new URL("./knowledge/", import.meta.url).href,

  // Wording layer for trusted notes. null = Flo's built-in LocalProvider (no AI model).
  provider: null,

  // How many past conversations each learner keeps (stored in their own browser).
  maxConversations: 12,
  maxMessagesPerConversation: 80,

  // Text on the floating button (desktop).
  launcherLabel: "Ask Flo",

  // Reading PDFs the learner attaches (runs in the browser; files are never uploaded).
  pdfUrl: new URL("./vendor/pdf.min.js", import.meta.url).href,
  pdfWorkerUrl: new URL("./vendor/pdf.worker.min.js", import.meta.url).href,
  // Reading photos and scanned pages (text recognition on the device).
  ocrBase: new URL("./vendor/ocr/", import.meta.url).href,
  // Word/PowerPoint reading is switched off for now. To switch it on later, add vendor/fflate.js and:
  // zipUrl: new URL("./vendor/fflate.js", import.meta.url).href,
  zipUrl: null,

  // ✨ Smart Study Mode — OPTIONAL on-device AI. Learners switch it on themselves in Flo's settings.
  // The model runs inside their browser (WebGPU); nothing is sent to an AI company.
  // Set available: false to hide Smart mode completely.
  smart: {
    available: true,
    libUrl: new URL("./vendor/web-llm.js", import.meta.url).href,
    workerUrl: new URL("./ai/worker.js", import.meta.url).href,
    // Open-source models (downloaded once per device from Hugging Face, then cached by the browser).
    // "fallback" is used on GPUs without 16-bit support. Sizes are approximate.
    models: [
      { id: "light", label: "Light", size: "about 0.7 GB", note: "Works on more phones and older laptops. Shorter, simpler answers.", model: "Llama-3.2-1B-Instruct-q4f16_1-MLC", fallback: "Llama-3.2-1B-Instruct-q4f32_1-MLC" },
      { id: "standard", label: "Standard", size: "about 1 GB", note: "Recommended for laptops and recent phones.", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", fallback: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", recommended: true },
      { id: "best", label: "Best", size: "about 2 GB", note: "Best answers. Needs a powerful laptop with plenty of memory.", model: "Llama-3.2-3B-Instruct-q4f16_1-MLC", fallback: "Llama-3.2-3B-Instruct-q4f32_1-MLC" },
    ],
  },
};
