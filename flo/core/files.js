// Flo · reading files the learner adds (runs in the browser; nothing is uploaded anywhere).
//   PDF (text)          → pdf.js
//   PDF (scanned pages) → pdf.js draws each page, then text recognition (OCR)
//   Photos / images     → text recognition (OCR, Tesseract — runs on the device)
//   Word .docx          → unzipped and read directly
//   PowerPoint .pptx    → unzipped and read slide by slide
//   .txt / .md / .csv / .html → read directly
// Everything heavy is loaded only when that kind of file is added.

const TEXT_TYPES = /\.(txt|md|markdown|csv|tsv|json|html?|rtf)$/i;
const IMAGE_TYPES = /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i;
const MAX_OCR_PAGES = 15;

export async function readFile(file, opts = {}) {
  const { pdfUrl, pdfWorkerUrl, maxPages = 80, onProgress = () => {} } = opts;
  const name = file.name || "file";
  const type = file.type || "";

  // ---------- PDF ----------
  if (/\.pdf$/i.test(name) || type === "application/pdf") {
    onProgress("Reading the PDF…");
    const pdfjs = await import(/* @vite-ignore */ pdfUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, maxPages);
    let text = "";
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "", lastY = null;
      content.items.forEach((it) => {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { text += line.trim() + "\n"; line = ""; }
        line += it.str + (it.hasEOL ? "\n" : " ");
        lastY = y;
      });
      text += line.trim() + "\n\n";
    }
    const scanned = text.replace(/\s/g, "").length < 40 * pages;
    if (!scanned) return { name, kind: "pdf", text, pages: doc.numPages, readPages: pages };
    // Scanned PDF: draw each page and recognise the text.
    if (!opts.ocrBase) return { name, kind: "pdf", text: "", pages: doc.numPages, readPages: pages, scanned: true };
    const n = Math.min(doc.numPages, MAX_OCR_PAGES);
    const canvases = [];
    for (let i = 1; i <= n; i++) {
      onProgress(`Preparing scanned page ${i} of ${n}…`);
      const page = await doc.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 1800 / Math.max(vp0.width, vp0.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      canvases.push(canvas);
    }
    const { ocrImages } = await import("./ocr.js");
    const r = await ocrImages(canvases, { base: opts.ocrBase, onProgress: (i, total, p) => onProgress(`Reading scanned page ${i} of ${total}… ${Math.round(p * 100)}%`) });
    return { name, kind: "pdf", text: r.text, pages: doc.numPages, readPages: n, ocr: true, confidence: r.confidence };
  }

  // ---------- Photos / images ----------
  if (/^image\//.test(type) || IMAGE_TYPES.test(name)) {
    if (/heic|heif/i.test(type + name)) return { name, kind: "unsupported", error: "heic" };
    if (!opts.ocrBase) return { name, kind: "unsupported", error: "image" };
    onProgress("Getting the photo ready…");
    const canvas = await imageToCanvas(file);
    const { ocrImages } = await import("./ocr.js");
    const r = await ocrImages([canvas], { base: opts.ocrBase, onProgress: (i, total, p) => onProgress(`Reading the text in your photo… ${Math.round(p * 100)}%`) });
    return { name, kind: "image", text: r.text, ocr: true, confidence: r.confidence };
  }

  // ---------- Word / PowerPoint ----------
  if (/\.docx$/i.test(name) || /\.pptx$/i.test(name)) {
    if (!opts.zipUrl) return { name, kind: "unsupported", error: "docx" };
    onProgress(/\.docx$/i.test(name) ? "Reading the Word file…" : "Reading the slides…");
    const { unzipSync, strFromU8 } = await import(/* @vite-ignore */ opts.zipUrl);
    let files;
    try { files = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch (e) { return { name, kind: "unsupported", error: "broken" }; }
    if (/\.docx$/i.test(name)) {
      const xml = files["word/document.xml"];
      if (!xml) return { name, kind: "unsupported", error: "broken" };
      return { name, kind: "docx", text: wordXmlToText(strFromU8(xml)) };
    }
    const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()));
    if (!slides.length) return { name, kind: "unsupported", error: "broken" };
    const text = slides.map((k, i) => { const t = slideXmlToText(strFromU8(files[k])); return t ? `Slide ${i + 1}\n${t}` : ""; }).filter(Boolean).join("\n\n");
    return { name, kind: "pptx", text, slides: slides.length };
  }
  if (/\.(doc|ppt)$/i.test(name)) return { name, kind: "unsupported", error: "old-office" };

  // ---------- plain text ----------
  if (TEXT_TYPES.test(name) || /^text\//.test(type)) {
    let text = await file.text();
    if (/\.html?$/i.test(name)) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    return { name, kind: "text", text };
  }
  return { name, kind: "unsupported", error: "type" };
}

// ---------- helpers ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) { return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m); }

export function wordXmlToText(xml) {
  return decode(String(xml)
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, "")
    .replace(/<\/w:p>/g, "\n").replace(/<\/w:tr>/g, "\n").replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function slideXmlToText(xml) {
  const paras = String(xml).split(/<\/a:p>/).map((p) => decode((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => t.replace(/<\/?a:t>/g, "")).join(""))).map((s) => s.trim()).filter(Boolean);
  return paras.join("\n");
}

async function imageToCanvas(file) {
  const MAX = 2200;
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) {
    bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height, s = Math.min(1, MAX / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
