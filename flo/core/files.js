// Flo · reading files the learner adds (runs in the browser; nothing is uploaded anywhere).
// Text files are read directly; PDFs are read with pdf.js (loaded only when needed).

const TEXT_TYPES = /\.(txt|md|markdown|csv|tsv|json|html?|rtf)$/i;

export async function readFile(file, { pdfUrl, pdfWorkerUrl, maxPages = 80 } = {}) {
  const name = file.name || "file";
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
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
    return { name, kind: "pdf", text, pages: doc.numPages, readPages: pages, scanned: text.replace(/\s/g, "").length < 40 * pages };
  }
  if (TEXT_TYPES.test(name) || /^text\//.test(file.type || "")) {
    let text = await file.text();
    if (/\.html?$/i.test(name)) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    return { name, kind: "text", text };
  }
  if (/\.docx$/i.test(name)) return { name, kind: "unsupported", error: "docx" };
  if (/^image\//.test(file.type || "")) return { name, kind: "unsupported", error: "image" };
  return { name, kind: "unsupported", error: "type" };
}
