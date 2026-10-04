// Flo · text recognition (OCR) for photos and scanned pages.
// Uses Tesseract.js, which runs entirely on the learner's device. The engine and English
// language data are served from ExamFlow's own site (flo/vendor/ocr), loaded only when needed.

let workerPromise = null;
let idleTimer = null;
let progressHook = null;

async function getWorker(base) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import(/* @vite-ignore */ base + "tesseract.esm.min.js");
      const Tesseract = mod.default || mod;
      return Tesseract.createWorker("eng", 1, {
        workerPath: base + "worker.min.js",
        corePath: base,
        langPath: base,
        gzip: false,
        logger: (m) => { if (progressHook && m && m.status === "recognizing text") progressHook(m.progress || 0); },
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// images: canvases / blobs. Returns { text, confidence } (confidence 0–100).
export async function ocrImages(images, { base, onProgress = () => {} } = {}) {
  clearTimeout(idleTimer);
  onProgress(1, images.length, 0);
  const worker = await getWorker(base);
  let text = "", conf = 0, n = 0;
  for (let i = 0; i < images.length; i++) {
    progressHook = (p) => onProgress(i + 1, images.length, p);
    const { data } = await worker.recognize(images[i]);
    const t = (data.text || "").trim();
    if (t) { text += (images.length > 1 ? `Page ${i + 1}\n` : "") + t + "\n\n"; conf += data.confidence || 0; n++; }
  }
  progressHook = null;
  // Free the memory if nothing else is read for a minute.
  idleTimer = setTimeout(async () => { const w = workerPromise; workerPromise = null; try { (await w).terminate(); } catch (e) {} }, 60000);
  return { text: text.trim(), confidence: n ? Math.round(conf / n) : 0 };
}
