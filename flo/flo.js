// =====================================================================
//  Flo — ExamFlow's own study companion
//  Loaded by ExamFlow.html:  <script type="module" src="/flo/flo.js"></script>
//
//  Flo only appears once a student is logged in. It talks to ExamFlow through
//  window.ExamFlow (the bridge added inside the app), so it reads the student's
//  real data and saves changes through ExamFlow's own functions.
// =====================================================================

import CONFIG from "./config.js";
import { createKnowledge } from "./core/knowledge.js";
import { createFlo } from "./core/pipeline.js";
import { runAction } from "./core/actions.js";
import { LocalProvider } from "./core/provider.js";
import { richText } from "./core/text.js";
import { createSmart, tidy } from "./core/smart.js";
import { createWebLLMEngine } from "./ai/engines.js";
import { createMaterialStore, looksLikeSyllabus, countWords } from "./core/material.js";
import { readFile } from "./core/files.js";
import { LEVELS, COURSE_SUGGESTIONS, BOARD_SUGGESTIONS } from "./core/profile.js";


// ------------------------------------------------------------------ icons
const I = {
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7M8 21v-7h8v7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};
const icon = (name) => I[name] || "";

const MODES = [
  { id: "explain", label: "💡 Explain", prefix: "Explain", placeholder: "What should I explain? e.g. osmosis" },
  { id: "learn", label: "🌱 Learn", prefix: "Teach me", placeholder: "What do you want to learn? e.g. basics of Python" },
  { id: "notes", label: "📝 Make notes", prefix: "Make notes on", placeholder: "Notes on which chapter or topic?" },
  { id: "quiz", label: "🧠 Quiz me", prefix: "Quiz me on", placeholder: "Quiz you on which chapter? (or just send)" },
  { id: "practice", label: "🎯 Practice", prefix: "Practice questions on", placeholder: "Practice questions on which topic?" },
  { id: "revise", label: "🔄 Revise", prefix: "Help me revise", placeholder: "Revise which chapter? (or just send)" },
  { id: "doubt", label: "❓ Clear my doubt", prefix: "", placeholder: "Type your doubt, e.g. why does steam burn more?" },
  { id: "improve", label: "✍️ Check my answer", prefix: "Check my answer:", placeholder: "Paste the question and your answer…" },
  { id: "summarize", label: "📚 Summarize", summarize: true },
  { id: "plan", label: "📅 Study plan", send: "Make a study plan" },
  { id: "progress", label: "📊 My progress", send: "Analyze my progress" },
];

// ------------------------------------------------------------------ boot
function boot() {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL("./flo.css", import.meta.url).href;
  document.head.appendChild(css);

  let ui = null;
  const start = () => {
    if (!window.ExamFlow || ui) return;
    try { ui = createUI(); } catch (e) { console.error("[Flo] couldn't start", e); }
  };
  const stop = () => { if (ui) { ui.destroy(); ui = null; } };
  window.addEventListener("examflow:ready", start);
  window.addEventListener("examflow:gone", stop);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  // Safety net in case the ready event fired before this script loaded.
  let tries = 0;
  const poll = setInterval(() => { if (ui || ++tries > 40) return clearInterval(poll); start(); }, 500);
}

// ------------------------------------------------------------------ the UI
function createUI() {
  const EF = () => window.ExamFlow;
  const bridge = {
    get: () => EF().get(),
    get helpers() { return (EF() && EF().helpers) || {}; },
    act: (name, ...args) => EF().act(name, ...args),
  };
  const knowledge = createKnowledge({ baseUrl: CONFIG.knowledgeBase, fetchJson: (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }) });

  const user = (bridge.get().user || {});
  const userKey = String(user.id || user.email || "me");
  const storeKey = "flo:v1:" + userKey;

  // ---------- the learner's own material (kept in this browser only) ----------
  const materials = createMaterialStore("flo:mat:v1:" + userKey);

  // ---------- ✨ Smart Study Mode (optional on-device AI) ----------
  const SM = CONFIG.smart || {};
  const engine = window.__FLO_TEST_ENGINE__ || (SM.available ? createWebLLMEngine({ libUrl: SM.libUrl, workerUrl: SM.workerUrl, models: SM.models || [] }) : null);
  const smart = engine ? createSmart({ engine }) : null;
  let aiCheck = null;          // { ok, reason } once checked
  let aiFailed = false;        // model failed to start this session → quietly use trusted mode
  let aiBusy = null;           // { job } while an AI answer is being written
  let smartOverlay = null;      // what we just saved, until ExamFlow's state catches up
  const smartPrefs = () => { let saved = {}; try { saved = ((bridge.get().settings || {}).flo || {}).smart || {}; } catch (e) {} return smartOverlay ? { ...saved, ...smartOverlay } : saved; };
  const saveSmartPrefs = async (next) => { smartOverlay = { ...next }; await bridge.act("updateFloPrefs", { smart: next }); };
  const modelChoice = () => smartPrefs().model || defaultModel();
  const defaultModel = () => (window.matchMedia("(max-width: 860px)").matches || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? "light" : "standard");
  const dlKey = (m) => "flo:ai:dl:" + m;
  const isDownloaded = (m) => { try { return localStorage.getItem(dlKey(m)) === "1"; } catch (e) { return false; } };
  const ai = smart ? {
    usable: () => !!(smartPrefs().on && aiCheck && aiCheck.ok && !aiFailed && (engine.loaded || isDownloaded(modelChoice()))),
    supported: () => (aiCheck ? aiCheck.ok : null),
    enabled: () => !!smartPrefs().on,
    job: (o) => smart.job(o),
  } : null;
  if (engine) engine.check().then((r) => { aiCheck = r; refreshFoot(); if (root.classList.contains("is-open") && !conv.messages.length) renderAll(); }).catch(() => { aiCheck = { ok: false, reason: "error" }; });

  const flo = createFlo({ bridge, knowledge, provider: CONFIG.provider || LocalProvider, ai, materials });
  flo.ensureKnowledge();
  let saveTimer = null;
  let store = loadStore();
  let conv = null;
  let busy = false;
  let mode = null;
  conv = currentConv();

  // ---------- DOM ----------
  const root = document.createElement("div");
  root.className = "flo-root";
  root.innerHTML = `
    <button type="button" class="flo-launcher" aria-haspopup="dialog" aria-expanded="false" aria-label="Open Flo, your study companion">
      ${icon("spark")}<span class="flo-label">${esc(CONFIG.launcherLabel)}</span><span class="flo-dot"></span>
    </button>
    <section class="flo-panel" role="dialog" aria-modal="false" aria-label="Flo study companion">
      <header class="flo-head">
        <div class="flo-avatar" aria-hidden="true">${icon("spark")}</div>
        <div class="flo-title"><b>Flo <span class="flo-badge">Study companion</span></b><span class="flo-status"></span></div>
        <button type="button" class="flo-iconbtn flo-set-btn" title="Settings" aria-label="Flo settings">${icon("gear")}</button>
        <button type="button" class="flo-iconbtn flo-hist-btn" title="Past chats" aria-label="Past chats">${icon("clock")}</button>
        <button type="button" class="flo-iconbtn flo-new-btn" title="New chat" aria-label="New chat">${icon("plus")}</button>
        <button type="button" class="flo-iconbtn flo-close-btn" title="Close" aria-label="Close Flo">${icon("x")}</button>
      </header>
      <nav class="flo-modes" aria-label="Study modes">
        ${MODES.map((m) => `<button type="button" class="flo-mode" data-mode="${m.id}" aria-pressed="false">${esc(m.label)}</button>`).join("")}
      </nav>
      <div class="flo-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="flo-history" aria-label="Past chats">
        <div class="flo-history-head"><span>Past chats</span><button type="button" class="flo-iconbtn flo-hist-close" aria-label="Back to chat">${icon("back")}</button></div>
        <ul></ul>
      </div>
      <div class="flo-sheet" aria-label="Flo settings" role="region"></div>
      <form class="flo-compose">
        <div class="flo-mode-pill"><span></span><button type="button" aria-label="Clear mode">Clear</button></div>
        <div class="flo-attached"></div>
        <div class="flo-inputwrap">
          <button type="button" class="flo-attach" title="Add notes, a PDF, a photo, or your syllabus" aria-label="Add study material">${icon("clip")}</button>
          <textarea class="flo-input" rows="1" maxlength="8000" placeholder="Ask Flo anything about your studies…" aria-label="Message Flo"></textarea>
          <button type="submit" class="flo-send" aria-label="Send" disabled>${icon("send")}</button>
        </div>
        <input type="file" class="flo-file" accept=".pdf,.txt,.md,.markdown,.csv,.html,.htm,application/pdf,text/plain,image/*" hidden>
        <div class="flo-foot"></div>
      </form>
    </section>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const launcher = $(".flo-launcher"), panel = $(".flo-panel"), log = $(".flo-log"), input = $(".flo-input"), sendBtn = $(".flo-send");
  const statusEl = $(".flo-status"), pill = $(".flo-mode-pill"), histEl = $(".flo-history");
  const sheet = $(".flo-sheet"), footEl = $(".flo-foot"), fileInput = $(".flo-file"), attachedEl = $(".flo-attached");
  const DEFAULT_PLACEHOLDER = "Ask Flo anything…";
  input.placeholder = DEFAULT_PLACEHOLDER;
  function refreshFoot() {
    const on = ai && ai.usable();
    footEl.innerHTML = on ? `✨ Smart mode on — AI runs privately on this device. Check important facts.` : `Flo uses your ExamFlow data, trusted notes and your own material.`;
  }
  refreshFoot();

  // ---------- open / close ----------
  function open() {
    root.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    launcher.classList.remove("has-dot");
    refreshStatus();
    renderAll();
    setTimeout(() => { if (window.matchMedia("(min-width: 861px)").matches) input.focus(); }, 60);
    try { sessionStorage.setItem("flo-seen", "1"); } catch (e) {}
  }
  function close() {
    root.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    histEl.classList.remove("open");
    sheet.classList.remove("open");
    launcher.focus({ preventScroll: true });
  }
  launcher.addEventListener("click", open);
  $(".flo-close-btn").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("is-open")) close(); });

  function refreshStatus() {
    statusEl.textContent = flo.statusLine();
    try {
      const soon = flo.context().upcoming[0];
      if (soon && soon.daysLeft <= 3 && !sessionStorage.getItem("flo-seen")) launcher.classList.add("has-dot");
    } catch (e) {}
  }
  const onChange = () => { refreshStatus(); if (root.classList.contains("is-open") && !conv.messages.length) renderAll(); };
  window.addEventListener("examflow:change", onChange);
  refreshStatus();

  // ---------- modes ----------
  root.querySelectorAll(".flo-mode").forEach((b) => b.addEventListener("click", () => {
    const m = MODES.find((x) => x.id === b.dataset.mode);
    if (m.send) { setMode(null); send(m.send); return; }
    if (m.summarize) { setMode(null); if ((conv.state.materialIds || []).some((id) => materials.get(id))) send("Summarize this"); else pickFile(); return; }
    setMode(mode === m.id ? null : m.id);
    input.focus();
  }));
  pill.querySelector("button").addEventListener("click", () => setMode(null));
  function setMode(id) {
    mode = id;
    const m = MODES.find((x) => x.id === id);
    root.querySelectorAll(".flo-mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === id)));
    pill.classList.toggle("on", !!m);
    pill.querySelector("span").textContent = m ? m.label : "";
    input.placeholder = m ? m.placeholder : DEFAULT_PLACEHOLDER;
    updateSend();
  }

  // ---------- composer ----------
  const updateSend = () => {
    const stopping = !!aiBusy;
    sendBtn.classList.toggle("stop", stopping);
    sendBtn.innerHTML = stopping ? icon("stop") : icon("send");
    sendBtn.setAttribute("aria-label", stopping ? "Stop" : "Send");
    sendBtn.disabled = stopping ? false : busy || (!input.value.trim() && !(mode && ["quiz", "revise"].includes(mode)));
  };
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; updateSend(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(".flo-compose").requestSubmit(); } });
  $(".flo-compose").addEventListener("submit", (e) => {
    e.preventDefault();
    if (aiBusy) { aiBusy.stopped = true; engine.abort(); return; }
    if (busy) return;
    let text = input.value.trim();
    const m = MODES.find((x) => x.id === mode);
    if (m) {
      if (!text && ["quiz", "revise"].includes(m.id)) text = m.id === "quiz" ? "Quiz me" : "Help me revise";
      else if (text && m.prefix && !new RegExp("^" + m.prefix.split(" ")[0], "i").test(text)) text = `${m.prefix} ${text}`;
    }
    if (!text) return;
    input.value = ""; input.style.height = "auto";
    setMode(null);
    send(text);
  });

  // ---------- new chat / history ----------
  $(".flo-new-btn").addEventListener("click", () => { if (aiBusy) return; newConv(); setMode(null); renderAll(); histEl.classList.remove("open"); sheet.classList.remove("open"); input.focus(); });
  $(".flo-set-btn").addEventListener("click", () => { if (sheet.classList.contains("open")) sheet.classList.remove("open"); else openSettings(); });
  $(".flo-attach").addEventListener("click", () => pickFile());
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ""; if (f) addFile(f); });
  $(".flo-hist-btn").addEventListener("click", () => { renderHistory(); histEl.classList.toggle("open"); });
  $(".flo-hist-close").addEventListener("click", () => histEl.classList.remove("open"));

  function renderHistory() {
    const ul = histEl.querySelector("ul");
    const list = store.convs.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) { ul.innerHTML = `<li class="flo-empty-h">No past chats yet. Your conversations with Flo are saved on this device.</li>`; return; }
    ul.innerHTML = "";
    list.forEach((c) => {
      const li = document.createElement("li");
      if (c.id === conv.id) li.className = "current";
      li.innerHTML = `<button type="button"><span>${esc(c.title || "Chat")}</span><small>${esc(new Date(c.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))} · ${c.messages.length} messages</small></button><button type="button" class="flo-iconbtn" aria-label="Delete chat">${icon("trash")}</button>`;
      li.firstChild.addEventListener("click", () => { if (aiBusy) return; store.currentId = c.id; conv = c; saveStore(); histEl.classList.remove("open"); renderAll(); });
      li.lastChild.addEventListener("click", () => { store.convs = store.convs.filter((x) => x.id !== c.id); if (conv.id === c.id) newConv(); saveStore(); renderHistory(); renderAll(); });
      ul.appendChild(li);
    });
  }

  // ---------- sending ----------
  async function send(text, { retry = false } = {}) {
    if (busy) return;
    if (!retry) push({ role: "user", text });
    if (!conv.title) conv.title = text.slice(0, 48);
    busy = true; updateSend();
    renderAll();
    const typing = showTyping();
    const t0 = Date.now();
    try {
      const r = await flo.handle(text, conv.state);
      await wait(Math.max(0, 380 - (Date.now() - t0)));
      typing.remove();
      if (r.smartOff) await setSmart(false);
      if (r.run) { await doAction(r.run, null); }
      else if (r.ai) { busy = false; await runAI(r.ai, text); return; }
      else push({ role: "flo", blocks: r.blocks, chips: r.chips || [], safety: !!r.safety });
      if (r.openSettings) setTimeout(openSettings, 250);
      if (r.openAttach) setTimeout(pickFile, 250);
    } catch (err) {
      console.error("[Flo] reply failed", err);
      typing.remove();
      push({ role: "flo", error: true, retryText: text, blocks: [] });
    } finally {
      busy = false; updateSend();
      renderAll();
    }
  }

  // ---------- ✨ running an AI answer ----------
  async function runAI(job, text) {
    const msg = { role: "flo", blocks: [{ type: "ai", grounded: job.grounded || null }, { type: "aistream", text: "", status: "" }], chips: [] };
    push(msg);
    aiBusy = { job };
    busy = true; updateSend();
    renderAll();
    const live = () => log.querySelector(`[data-mid="${msg.id}"] .flo-aistream`);
    const setStatus = (t) => { msg.blocks[1].status = t; const n = live(); if (n) n.innerHTML = `<div class="flo-aistatus">${icon("spark")}<span>${esc(t)}</span></div>`; };
    let pending = false, latest = "";
    const paint = () => { pending = false; const n = live(); if (n) { n.innerHTML = md(tidy(latest)) + '<span class="flo-caret"></span>'; log.scrollTop = log.scrollHeight; } };
    try {
      if (!engine.loaded) {
        setStatus(isDownloaded(modelChoice()) ? "Starting Smart mode…" : "Downloading the AI model… this happens only once.");
        await engine.load(modelChoice(), (p) => setStatus(p.progress != null && p.progress < 1 ? `Starting Smart mode… ${Math.round(p.progress * 100)}%` : "Starting Smart mode…"));
        try { localStorage.setItem(dlKey(modelChoice()), "1"); } catch (e) {}
      }
      setStatus(job.kind === "json" ? (job.tool === "quiz" ? "Writing your quiz…" : "Preparing your revision cards…") : "Thinking…");
      const out = await smart.run(job, { onToken: (t) => { latest = t; if (!pending) { pending = true; requestAnimationFrame(paint); } } });
      const stopped = aiBusy && aiBusy.stopped;
      const r = stopped && job.kind === "json" ? { blocks: [{ type: "notice", tone: "info", text: "Stopped — ask again whenever you're ready." }], chips: [] } : job.finalize(out);
      msg.blocks = r.blocks;
      msg.chips = r.chips || [];
      if (stopped && job.kind !== "json") msg.blocks.push({ type: "notice", tone: "info", text: "Stopped." });
      flo.afterAI(conv.state, out);
    } catch (err) {
      console.error("[Flo] Smart mode failed", err);
      const notLoaded = !engine.loaded;
      if (notLoaded) {
        // The model couldn't start on this device: say so, then answer without AI.
        aiFailed = true; refreshFoot();
        conv.messages = conv.messages.filter((m) => m !== msg);
        push({ role: "flo", blocks: [{ type: "notice", tone: "warn", text: "Smart mode couldn't start on this device, so I'll answer with ExamFlow's trusted notes instead. You can try again later from settings." }] });
        aiBusy = null; busy = false; updateSend();
        await send(text, { retry: true });
        return;
      }
      const partial = latest && latest.length > 40;
      msg.blocks = partial ? [{ type: "ai", grounded: job.grounded || null }, { type: "text", text: tidy(latest) }, { type: "notice", tone: "info", text: "Stopped." }] : [{ type: "notice", tone: "warn", text: "Stopped — ask again whenever you're ready." }];
    } finally {
      aiBusy = null; busy = false; updateSend();
      saveStore();
      renderAll();
    }
  }

  async function setSmart(on, model) {
    const cur = smartPrefs();
    await saveSmartPrefs({ ...cur, on: !!on, model: model || cur.model || defaultModel() });
    if (on) aiFailed = false;
    refreshFoot();
  }

  // ---------- 📎 learner's material ----------
  function pickFile() { fileInput.click(); }
  async function addFile(file) {
    if (busy) return;
    busy = true; updateSend();
    push({ role: "user", text: `📎 ${file.name}` });
    renderAll();
    const typing = showTyping();
    try {
      if (file.size > 25 * 1024 * 1024) throw Object.assign(new Error("big"), { friendly: "That file is over 25 MB. Try a smaller file, or paste the part you need." });
      const res = await readFile(file, { pdfUrl: CONFIG.pdfUrl, pdfWorkerUrl: CONFIG.pdfWorkerUrl, ocrBase: CONFIG.ocrBase, zipUrl: CONFIG.zipUrl, onProgress: (t) => typing.setText(t) });
      typing.remove();
      if (res.kind === "unsupported") {
        const why = {
          docx: "I can't read Word or PowerPoint files yet. Save it as a **PDF** (File → Save as → PDF) and attach that, or copy and paste the text here.",
          heic: "iPhone photos in HEIC format can't be read here. On your iPhone go to **Settings → Camera → Formats → Most Compatible**, or take a screenshot of the photo and attach that.",
          "old-office": "I can't read Word or PowerPoint files yet. Save it as a **PDF** and attach that, or copy and paste the text here.",
          broken: "I couldn't open that file — it may be damaged or password-protected. Try saving it again, or as a PDF.",
        }[res.error] || "I can read PDFs, photos and text files. Please attach one of those, or paste the text here.";
        push({ role: "flo", blocks: [{ type: "text", text: why }] });
        return;
      }
      if (!res.text || res.text.replace(/\s/g, "").length < 15) {
        push({ role: "flo", blocks: [{ type: "text", text: res.ocr ? "I couldn't find readable text in that. For photos: use good light, hold the camera straight over the page, and make sure the words are sharp. Printed text works best; handwriting is harder." : "I couldn't find any text in that file." }] });
        return;
      }
      const added = materials.add({ name: file.name, text: res.text, kind: res.kind });
      if (!added.ok) { push({ role: "flo", blocks: [{ type: "text", text: "That file seems to be empty." }] }); return; }
      flo.attach(conv.state, added.doc.id);
      const syl = looksLikeSyllabus(added.doc.text);
      const notes = [];
      if (res.kind === "pdf" && res.readPages < res.pages) notes.push(`I read the first ${res.readPages} of ${res.pages} pages.`);
      if (res.ocr) notes.push(res.confidence && res.confidence < 70 ? "I read this from an image, and some words may be misread — check anything important against the original." : "I read this from an image using text recognition, so a few words may be off.");
      if (res.kind === "pptx") notes.push(`Read ${res.slides} slide${res.slides === 1 ? "" : "s"}.`);
      if (added.truncated) notes.push("It's very long, so I kept the first part.");
      if (!added.stored) notes.push("Your browser's storage is full, so I'll only keep it for this session.");
      push({ role: "flo", blocks: [
        { type: "text", text: `Got it — **${added.doc.name}** (${added.doc.words.toLocaleString("en-IN")} words) is ready. ${syl ? "It looks like a syllabus." : ""} What should I do with it?${notes.length ? "\n\n" + notes.join(" ") : ""}` },
        { type: "notice", tone: "info", text: "Your material stays in this browser only — it isn't uploaded anywhere." },
      ], chips: syl ? ["Add this syllabus to ExamFlow", "Summarize this", "Quiz me on this"] : ["Summarize this", "Make notes from this", "Quiz me on this", "Practice questions on this"] });
    } catch (err) {
      typing.remove();
      console.error("[Flo] couldn't read file", err);
      push({ role: "flo", blocks: [{ type: "text", text: err.friendly || "Sorry, I couldn't read that file. If it's a PDF, it may be protected — try another file or paste the text." }] });
    } finally {
      busy = false; updateSend();
      renderAll();
    }
  }

  async function doAction(action, btnRef) {
    if (action.type === "ask") { send(action.text); return; }
    const res = await runAction(bridge, action);
    // mark the button (or the plan's main button when confirmed with "yes") as done
    const target = btnRef || findPendingButton(action);
    if (target && res.ok) { target.done = true; target.doneLabel = doneLabel(action); }
    if (!res.silent && res.text) push({ role: "flo", blocks: [{ type: "text", text: res.text }, res.follow ? { type: "actions", buttons: [{ label: res.follow.label, action: res.follow.action, icon: "arrow" }] } : null].filter(Boolean), chips: res.ok && action.type === "addSessions" ? ["What should I study next?", "Quiz me"] : [] });
    saveStore();
    renderAll();
    if (res.closeAlways || (res.close && window.matchMedia("(max-width: 860px)").matches)) close();
  }
  const doneLabel = (a) => ({ addSessions: "Added to Planner", addRevision: "Revision scheduled", addNote: "Saved to Notes", markRevised: "Revision logged", setStatus: "Updated", openFocus: "Opened", openPage: "Opened", reviewSyllabus: "Opened in ExamFlow" }[a.type] || "Done");
  function findPendingButton(action) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      for (const b of m.blocks || []) if (b.type === "actions") for (const x of b.buttons) if (!x.done && x.action && x.action.type === action.type) return x;
    }
    return null;
  }

  // ---------- rendering ----------
  function renderAttached() {
    const docs = (conv.state.materialIds || []).map((id) => materials.get(id)).filter(Boolean);
    attachedEl.innerHTML = "";
    attachedEl.classList.toggle("on", docs.length > 0);
    docs.forEach((d) => {
      const chip = el("span", "flo-att");
      chip.innerHTML = `${icon("file")}<span>${esc(d.name)}</span><button type="button" aria-label="Stop using ${esc(d.name)} in this chat">${icon("x")}</button>`;
      chip.querySelector("button").addEventListener("click", () => { conv.state.materialIds = (conv.state.materialIds || []).filter((x) => x !== d.id); saveStore(); renderAttached(); });
      attachedEl.appendChild(chip);
    });
  }

  function renderAll() {
    renderAttached();
    refreshFoot();
    log.innerHTML = "";
    if (!conv.messages.length) { log.appendChild(emptyState()); return; }
    const lastFlo = [...conv.messages].reverse().find((m) => m.role === "flo");
    conv.messages.forEach((m) => log.appendChild(renderMessage(m, m === lastFlo && !busy)));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function emptyState() {
    const wrap = el("div", "flo-empty");
    let name = "";
    try { name = flo.context().student.name; } catch (e) {}
    wrap.innerHTML = `<div class="flo-hello"><div class="flo-avatar" aria-hidden="true">${icon("spark")}</div><div><h3>Hey${name ? " " + esc(name) : ""} 👋</h3><p>I'm Flo, your study companion. What are we working on?</p></div></div>`;
    try {
      const ctx = flo.context();
      const soon = ctx.upcoming[0];
      if (soon) {
        const c = el("div", "flo-context");
        c.innerHTML = `<span style="font-size:20px">${soon.daysLeft <= 3 ? "⏰" : "📅"}</span><div><b>${esc(soon.subject)}</b> exam ${soon.daysLeft === 0 ? "is <b>today</b>" : soon.daysLeft === 1 ? "is <b>tomorrow</b>" : `in <b>${soon.daysLeft} days</b>`} · ${soon.percent}% ready${soon.pace ? ` · ${esc(soon.pace)}` : ""}</div>`;
        wrap.appendChild(c);
      } else if (!ctx.exams.length) {
        const c = el("div", "flo-context");
        c.innerHTML = `<span style="font-size:20px">🌱</span><div><b>Learn mode</b> — ask me about anything you're learning. Add subjects and exams in ExamFlow anytime, and I'll plan and track them too.</div>`;
        wrap.appendChild(c);
      }
      if (!ctx.student.profile.label && !sessionStorage.getItem("flo-profile-hint")) {
        const c = el("button", "flo-context flo-setup");
        c.type = "button";
        c.innerHTML = `<span style="font-size:20px">🎓</span><div><b>Tell me your level</b> (optional) — class, course or exam — so I explain things the right way for you.</div>`;
        c.addEventListener("click", () => { try { sessionStorage.setItem("flo-profile-hint", "1"); } catch (e) {} openSettings("profile"); });
        wrap.appendChild(c);
      }
    } catch (e) {}
    const emojis = ["📅", "🎯", "🔄", "💡", "📊"];
    const sug = el("div", "flo-suggest");
    flo.suggestions().forEach((s, i) => {
      const b = el("button", "");
      b.type = "button";
      b.innerHTML = `<span>${/plan|exam/i.test(s) ? "📅" : /next/i.test(s) ? "🎯" : /revise/i.test(s) ? "🔄" : /explain/i.test(s) ? "💡" : /progress/i.test(s) ? "📊" : emojis[i % 5]}</span>${esc(s)}`;
      b.addEventListener("click", () => send(s));
      sug.appendChild(b);
    });
    wrap.appendChild(sug);
    const trust = el("p", "flo-trust");
    trust.textContent = ai && ai.usable()
      ? "✨ Smart mode is on: when my trusted notes or your material don't cover something, an AI model on your device answers — clearly labelled. Check important facts."
      : "Flo uses your ExamFlow data, ExamFlow's trusted study notes and material you add. If it isn't sure, it will tell you.";
    wrap.appendChild(trust);
    return wrap;
  }

  function renderMessage(m, isLast) {
    if (m.role === "user") {
      const row = el("div", "flo-row user");
      const b = el("div", "flo-bubble");
      b.textContent = m.text;
      row.appendChild(b);
      return row;
    }
    const frag = document.createDocumentFragment();
    const row = el("div", "flo-row flo-first");
    if (m.id) row.dataset.mid = m.id;
    row.innerHTML = `<div class="flo-avatar sm" aria-hidden="true">${icon("spark")}</div>`;
    const body = el("div", "flo-msg");
    if (m.error) {
      const e = el("div", "flo-error");
      e.innerHTML = `<span>Sorry, something went wrong on my side.</span>`;
      const b = el("button", "flo-btn");
      b.type = "button"; b.textContent = "Try again";
      b.addEventListener("click", () => { conv.messages = conv.messages.filter((x) => x !== m); send(m.retryText, { retry: true }); });
      e.appendChild(b);
      body.appendChild(e);
    }
    (m.blocks || []).forEach((blk) => { const node = renderBlock(blk, m); if (node) body.appendChild(node); });
    row.appendChild(body);
    frag.appendChild(row);
    if (isLast && m.chips && m.chips.length) {
      const chips = el("div", "flo-chips");
      m.chips.forEach((c) => { const b = el("button", "flo-chip"); b.type = "button"; b.textContent = c; b.addEventListener("click", () => send(c)); chips.appendChild(b); });
      frag.appendChild(chips);
    }
    return frag;
  }

  function renderBlock(b, msg) {
    switch (b.type) {
      case "text": { if (!b.text) return null; const d = el("div", "flo-text"); d.innerHTML = md(b.text); return d; }
      case "source": { const d = el("div", "flo-source"); d.innerHTML = `${icon("book")}<span>${esc(b.text)}</span>`; return d; }
      case "notice": { const d = el("div", "flo-notice" + (b.tone === "warn" ? " warn" : "")); d.innerHTML = `${icon("info")}<div>${richText(b.text)}</div>`; return d; }
      case "keypoints": {
        const d = el("div", "flo-card");
        d.innerHTML = `<h4>${esc(b.title || "Key points")}</h4><ul class="flo-kp">${b.items.map((x) => `<li><span>${richText(x)}</span></li>`).join("")}</ul>`;
        return d;
      }
      case "notes": {
        const d = el("div", "flo-card");
        d.innerHTML = `<h4>📝 ${esc(b.title)}</h4>` + b.sections.map((s) => `<h5>${esc(s.h)}</h5><ul>${s.items.map((x) => `<li>${richText(x)}</li>`).join("")}</ul>`).join("");
        return d;
      }
      case "list": {
        const d = el("div", "flo-list");
        b.items.forEach((it) => { const r = el("div", "flo-li" + (it.tone ? " " + it.tone : "")); r.innerHTML = `<i style="${it.color ? `background:${cssColor(it.color)}` : ""}"></i><div><b>${richText(it.title)}</b>${it.meta ? `<small>${richText(it.meta)}</small>` : ""}</div>`; d.appendChild(r); });
        return d;
      }
      case "progress": {
        const d = el("div", "flo-card flo-prog");
        b.rows.forEach((r) => {
          const tone = r.pace === "On Track" ? "good" : r.pace === "Needs Attention" ? "warn" : r.pace === "Behind Schedule" ? "bad" : "";
          const when = r.daysLeft == null ? "no date" : r.daysLeft < 0 ? "done" : r.daysLeft === 0 ? "today" : r.daysLeft === 1 ? "tomorrow" : `in ${r.daysLeft}d`;
          const row = el("div", "");
          row.innerHTML = `<div class="flo-prow-top"><span>${esc(r.subject)}${r.pace ? `<span class="flo-pace ${tone}">${esc(r.pace)}</span>` : ""}</span><small>${r.percent}% · ${r.date ? esc(r.date) + " · " : ""}${when}</small></div><div class="flo-bar"><i style="width:0;background:${cssColor(r.color)}"></i></div>`;
          d.appendChild(row);
          requestAnimationFrame(() => requestAnimationFrame(() => { row.querySelector(".flo-bar i").style.width = Math.max(2, r.percent) + "%"; }));
        });
        return d;
      }
      case "plan": {
        const d = el("div", "flo-plan");
        b.days.forEach((day) => {
          const c = el("div", "flo-day" + (day.items.length ? "" : " empty"));
          c.innerHTML = `<div class="flo-day-head"><span>${esc(day.label)}</span><small>${day.items.length ? mins(day.minutes) : "Rest / buffer day"}</small></div>` +
            day.items.map((it) => `<div class="flo-slot"><time>${esc(it.time)}</time><div><b><i style="background:${cssColor(it.color)}"></i>${esc(it.title)}</b><small>${esc(it.subject)}</small></div></div>`).join("");
          d.appendChild(c);
        });
        return d;
      }
      case "flashcards": {
        const wrap = el("div", "");
        wrap.innerHTML = `<div class="flo-text" style="font-size:12.5px;font-weight:750;color:var(--flo-muted);margin-bottom:6px">${esc(b.title || "Flashcards")}</div>`;
        const grid = el("div", "flo-flash");
        b.cards.forEach((card) => {
          const fc = el("button", "flo-fc");
          fc.type = "button";
          fc.setAttribute("aria-label", "Flashcard. Tap to flip.");
          fc.innerHTML = `<div class="flo-fc-in"><div class="flo-fc-face"><small>Question</small>${richText(card.front)}</div><div class="flo-fc-face back"><small>Answer</small>${richText(card.back)}</div></div>`;
          fc.addEventListener("click", () => fc.classList.toggle("flipped"));
          grid.appendChild(fc);
        });
        wrap.appendChild(grid);
        return wrap;
      }
      case "actions": {
        const d = el("div", "flo-actions");
        b.buttons.forEach((x) => {
          const btn = el("button", "flo-btn" + (x.primary ? " primary" : "") + (x.done ? " done" : ""));
          btn.type = "button";
          btn.innerHTML = x.done ? `${icon("check")}${esc(x.doneLabel || "Done")}` : `${x.icon ? icon(x.icon) : ""}${esc(x.label)}`;
          btn.disabled = !!x.done;
          btn.addEventListener("click", async () => {
            if (x.done || btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = `${icon("clock")}Working…`;
            await doAction(x.action, x);
          });
          d.appendChild(btn);
        });
        return d;
      }
      case "quiz": return renderQuiz(b.quiz, msg);
      case "ai": {
        const d = el("div", "flo-ailabel");
        const what = b.grounded === "material" ? "AI answer based on your material" : b.grounded === "notes" ? "AI answer using ExamFlow notes" : "AI-generated";
        d.innerHTML = `${icon("spark")}<span><b>${what}</b> · check important facts</span>`;
        return d;
      }
      case "aistream": {
        const d = el("div", "flo-text flo-aistream");
        d.innerHTML = b.text ? md(tidy(b.text)) : `<div class="flo-aistatus">${icon("spark")}<span>${esc(b.status || "Thinking…")}</span></div>`;
        return d;
      }
      case "reveal": {
        const d = el("div", "flo-reveal");
        const btn = el("button", "flo-btn");
        btn.type = "button";
        btn.innerHTML = `${icon("check")}${esc(b.label || "Show answers")}`;
        const body = el("div", "flo-text flo-reveal-body");
        body.innerHTML = md(b.text);
        body.hidden = !b.open;
        if (b.open) btn.innerHTML = `${icon("x")}Hide answers`;
        btn.addEventListener("click", () => { b.open = !b.open; body.hidden = !b.open; btn.innerHTML = b.open ? `${icon("x")}Hide answers` : `${icon("check")}${esc(b.label || "Show answers")}`; saveStore(); });
        d.appendChild(btn); d.appendChild(body);
        return d;
      }
      default: return null;
    }
  }

  function renderQuiz(qz, msg) {
    const box = el("div", "flo-quiz");
    const draw = () => {
      box.innerHTML = "";
      if (qz.done) {
        const correct = qz.answers.filter((a) => a.correct).length;
        box.innerHTML = `<div class="flo-quiz-done"><b>${correct}/${qz.questions.length}</b>${esc(qz.title)} quiz complete</div>`;
        return;
      }
      const q = qz.questions[qz.idx];
      const ans = qz.answers[qz.idx];
      box.innerHTML = `<div class="flo-quiz-top"><span>Question ${qz.idx + 1} of ${qz.questions.length}</span><span>${esc(qz.title)}</span></div><div class="flo-quiz-bar"><i style="width:${(qz.idx / qz.questions.length) * 100}%"></i></div><div class="flo-quiz-q">${richText(q.q)}</div>`;
      const opts = el("div", "flo-opts");
      q.options.forEach((o, i) => {
        const b = el("button", "flo-opt");
        b.type = "button";
        b.innerHTML = `<span>${"ABCDE"[i]}</span><div>${richText(o)}</div>`;
        if (ans) { b.disabled = true; if (i === q.answer) b.classList.add("right"); else if (i === ans.given) b.classList.add("wrong"); }
        b.addEventListener("click", () => {
          if (qz.answers[qz.idx]) return;
          qz.answers[qz.idx] = { given: i, correct: i === q.answer };
          saveStore();
          draw();
        });
        opts.appendChild(b);
      });
      box.appendChild(opts);
      if (ans) {
        const exp = el("div", "flo-quiz-exp");
        exp.innerHTML = `${ans.correct ? "✅ <b>Correct!</b> " : `❌ <b>Not quite.</b> The answer is <b>${"ABCDE"[q.answer]}</b>. `}${richText(q.explain || "")}`;
        box.appendChild(exp);
        const foot = el("div", "flo-quiz-foot");
        const last = qz.idx === qz.questions.length - 1;
        const nb = el("button", "flo-btn primary");
        nb.type = "button";
        nb.innerHTML = `${last ? "See my score" : "Next question"}${icon("arrow")}`;
        nb.addEventListener("click", () => {
          if (!last) { qz.idx++; saveStore(); draw(); return; }
          qz.done = true;
          const r = flo.finishQuiz(qz);
          push({ role: "flo", blocks: r.blocks, chips: r.chips || [] });
          renderAll();
        });
        foot.appendChild(nb);
        box.appendChild(foot);
      }
    };
    draw();
    return box;
  }

  // ---------- ⚙️ settings: your level · Smart mode · your material ----------
  let dlState = null;   // { pct, text } while downloading the model
  function openSettings(focus) {
    histEl.classList.remove("open");
    renderSettings();
    sheet.classList.add("open");
    const target = focus === "profile" ? sheet.querySelector(".flo-set-level") : focus === "smart" ? sheet.querySelector(".flo-set-smart") : null;
    if (target) setTimeout(() => target.scrollIntoView({ block: "start" }), 50);
  }

  function renderSettings() {
    let ctx = null;
    try { ctx = flo.context(); } catch (e) {}
    const prof = (ctx && ctx.student.prefs && ctx.student.prefs.profile) || {};
    const sp = smartPrefs();
    const choice = modelChoice();
    const supported = aiCheck ? aiCheck.ok : null;
    const on = !!sp.on && !aiFailed;
    const downloaded = isDownloaded(choice) || (engine && engine.loaded);
    const smartStatus = !smart ? "" :
      supported === false ? `<div class="flo-set-note warn">This device or browser can't run Smart mode (it needs WebGPU — a recent Chrome or Edge on a laptop, or a recent Android phone). Everything else in Flo works normally.</div>` :
      supported === null ? `<div class="flo-set-note">Checking whether this device can run Smart mode…</div>` :
      dlState ? `<div class="flo-set-note">${esc(dlState.text || "Downloading…")}</div><div class="flo-bar"><i style="width:${Math.max(3, Math.round((dlState.pct || 0) * 100))}%"></i></div>` :
      on && downloaded ? `<div class="flo-set-note good">✓ Smart mode is on. The AI runs on this device — your questions aren't sent to any AI company.</div>` :
      `<div class="flo-set-note">Smart mode lets Flo help with <b>any subject, class or course</b>. It downloads a free, open-source AI model to this device once (${esc((SM.models.find((m) => m.id === choice) || {}).size || "about 1 GB")}) — best on Wi-Fi. Answers are labelled as AI-generated.</div>`;
    sheet.innerHTML = `
      <div class="flo-history-head"><span>Settings</span><button type="button" class="flo-iconbtn flo-sheet-close" aria-label="Back to chat">${icon("back")}</button></div>
      <div class="flo-sheet-body">
        <section class="flo-set flo-set-level">
          <h4>🎓 About you <small>optional</small></h4>
          <p class="flo-set-help">Flo adapts explanations to your level. Skip it and Flo gives clear general answers.</p>
          <div class="flo-set-levels" role="radiogroup" aria-label="Education level">
            ${LEVELS.map((l) => `<button type="button" role="radio" aria-checked="${prof.level === l.id}" data-level="${l.id}" class="flo-chip${prof.level === l.id ? " on" : ""}">${esc(l.label)}</button>`).join("")}
          </div>
          <label class="flo-field"><span>Class, grade or course</span><input type="text" class="flo-in-course" maxlength="60" list="flo-course-list" placeholder="e.g. Class 7, Grade 10, University, JEE, Python course" value="${esc(prof.course || "")}"></label>
          <label class="flo-field"><span>Board or curriculum</span><input type="text" class="flo-in-board" maxlength="40" list="flo-board-list" placeholder="e.g. CBSE, ICSE, IB, Cambridge — or leave empty" value="${esc(prof.board || "")}"></label>
          <datalist id="flo-course-list">${COURSE_SUGGESTIONS.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
          <datalist id="flo-board-list">${BOARD_SUGGESTIONS.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
          <div class="flo-set-row"><button type="button" class="flo-btn primary flo-save-prof">${icon("check")}Save</button>${prof.level || prof.course || prof.board ? `<button type="button" class="flo-btn flo-clear-prof">Clear</button>` : ""}<span class="flo-set-saved" hidden>Saved ✓</span></div>
        </section>
        ${smart ? `<section class="flo-set flo-set-smart">
          <h4>✨ Smart mode <small>optional AI</small></h4>
          ${smartStatus}
          ${supported ? `<div class="flo-set-models" role="radiogroup" aria-label="AI model size">
            ${SM.models.map((m) => `<button type="button" role="radio" aria-checked="${m.id === choice}" data-model="${m.id}" class="flo-model${m.id === choice ? " on" : ""}"${dlState ? " disabled" : ""}><b>${esc(m.label)}${m.recommended ? " · recommended" : ""}</b><small>${esc(m.size)} · ${esc(m.note)}</small></button>`).join("")}
          </div>
          <div class="flo-set-row">
            ${on && downloaded ? `<button type="button" class="flo-btn flo-smart-off">Turn off</button>` : `<button type="button" class="flo-btn primary flo-smart-on"${dlState ? " disabled" : ""}>${icon("spark")}${downloaded ? "Turn on" : "Download & turn on"}</button>`}
            ${downloaded && !dlState ? `<button type="button" class="flo-btn flo-smart-del">${icon("trash")}Remove model</button>` : ""}
          </div>` : ""}
        </section>` : ""}
        <section class="flo-set flo-set-mat">
          <h4>📚 Your study material</h4>
          <p class="flo-set-help">Notes, PDFs or a syllabus you add. Kept in this browser only.</p>
          <ul class="flo-mat-list">${materials.list().map((d) => `<li data-id="${d.id}"><span>${icon("file")}<b>${esc(d.name)}</b><small>${d.words.toLocaleString("en-IN")} words</small></span><button type="button" class="flo-link flo-mat-use">Use in chat</button><button type="button" class="flo-iconbtn flo-mat-del" aria-label="Delete ${esc(d.name)}">${icon("trash")}</button></li>`).join("") || `<li class="flo-empty-h">Nothing added yet.</li>`}</ul>
          <div class="flo-set-row"><button type="button" class="flo-btn flo-mat-add">${icon("clip")}Add a file</button></div>
        </section>
      </div>`;
    const q = (sel) => sheet.querySelector(sel);
    q(".flo-sheet-close").addEventListener("click", () => sheet.classList.remove("open"));
    sheet.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => {
      const was = b.classList.contains("on");
      sheet.querySelectorAll("[data-level]").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
      if (!was) { b.classList.add("on"); b.setAttribute("aria-checked", "true"); }
    }));
    q(".flo-save-prof").addEventListener("click", async () => {
      const lv = sheet.querySelector("[data-level].on");
      await bridge.act("updateFloPrefs", { profile: { level: lv ? lv.dataset.level : null, course: q(".flo-in-course").value.trim(), board: q(".flo-in-board").value.trim() } });
      const saved = q(".flo-set-saved"); saved.hidden = false;
      refreshStatus();
      setTimeout(() => { if (saved) saved.hidden = true; }, 1800);
    });
    const clr = q(".flo-clear-prof");
    if (clr) clr.addEventListener("click", async () => { await bridge.act("updateFloPrefs", { profile: {} }); renderSettings(); });
    sheet.querySelectorAll("[data-model]").forEach((b) => b.addEventListener("click", async () => {
      const cur = smartPrefs();
      await saveSmartPrefs({ ...cur, model: b.dataset.model, on: cur.on && isDownloaded(b.dataset.model) });
      renderSettings(); refreshFoot();
    }));
    const onBtn = q(".flo-smart-on");
    if (onBtn) onBtn.addEventListener("click", () => turnOnSmart());
    const offBtn = q(".flo-smart-off");
    if (offBtn) offBtn.addEventListener("click", async () => { await setSmart(false); renderSettings(); renderAll(); });
    const delBtn = q(".flo-smart-del");
    if (delBtn) delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      try { await engine.remove(choice); } catch (e) { console.warn("[Flo] couldn't remove model", e); }
      try { localStorage.removeItem(dlKey(choice)); } catch (e) {}
      await setSmart(false);
      renderSettings(); renderAll();
    });
    sheet.querySelectorAll(".flo-mat-del").forEach((b) => b.addEventListener("click", () => {
      const id = b.closest("li").dataset.id;
      materials.remove(id);
      store.convs.forEach((c) => { if (c.state && c.state.materialIds) c.state.materialIds = c.state.materialIds.filter((x) => x !== id); });
      saveStore(); renderSettings(); renderAttached();
    }));
    sheet.querySelectorAll(".flo-mat-use").forEach((b) => b.addEventListener("click", () => {
      flo.attach(conv.state, b.closest("li").dataset.id); saveStore();
      sheet.classList.remove("open"); renderAll(); input.focus();
    }));
    q(".flo-mat-add").addEventListener("click", () => { sheet.classList.remove("open"); pickFile(); });
  }

  async function turnOnSmart() {
    const choice = modelChoice();
    if (!aiCheck || !aiCheck.ok) return;
    dlState = { pct: 0, text: isDownloaded(choice) ? "Starting Smart mode…" : "Downloading the AI model — keep this tab open. This happens only once." };
    renderSettings();
    try {
      await engine.load(choice, (p) => {
        dlState = { pct: p.progress || 0, text: p.progress != null && p.progress < 1 ? `${isDownloaded(choice) ? "Starting" : "Downloading"}… ${Math.round((p.progress || 0) * 100)}%` : "Almost ready…" };
        const note = sheet.querySelector(".flo-set-smart .flo-set-note"), bar = sheet.querySelector(".flo-set-smart .flo-bar i");
        if (note) note.textContent = dlState.text;
        if (bar) bar.style.width = Math.max(3, Math.round(dlState.pct * 100)) + "%";
      });
      try { localStorage.setItem(dlKey(choice), "1"); } catch (e) {}
      dlState = null;
      await setSmart(true, choice);
      renderSettings(); renderAll();
    } catch (err) {
      console.error("[Flo] couldn't start Smart mode", err);
      dlState = null;
      renderSettings();
      const note = sheet.querySelector(".flo-set-smart .flo-set-note");
      if (note) { note.className = "flo-set-note warn"; note.textContent = /memory|out of memory|allocation|device lost/i.test(String(err && err.message)) ? "This device doesn't have enough memory for that model. Try the Light model." : "Smart mode couldn't start — check your internet connection and try again, or try the Light model."; }
    }
  }

  function showTyping() {
    const row = el("div", "flo-row");
    row.innerHTML = `<div class="flo-avatar sm" aria-hidden="true">${icon("spark")}</div><div class="flo-typing" aria-label="Flo is typing"><i></i><i></i><i></i></div><span class="flo-typing-text"></span>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    row.setText = (t) => { const s = row.querySelector(".flo-typing-text"); if (s) s.textContent = t || ""; };
    return row;
  }

  // ---------- storage (per student, in this browser) ----------
  function loadStore() {
    try { const s = JSON.parse(localStorage.getItem(storeKey) || "null"); if (s && Array.isArray(s.convs)) return s; } catch (e) {}
    return { convs: [], currentId: null };
  }
  function saveStore() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        store.convs = store.convs.filter((c) => c.messages.length || c.id === conv.id).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CONFIG.maxConversations);
        store.convs.forEach((c) => { if (c.messages.length > CONFIG.maxMessagesPerConversation) c.messages = c.messages.slice(-CONFIG.maxMessagesPerConversation); });
        localStorage.setItem(storeKey, JSON.stringify(store));
      } catch (e) { /* storage full or blocked: Flo still works for this session */ }
    }, 150);
  }
  function currentConv() {
    const c = store.convs.find((x) => x.id === store.currentId);
    if (c) { c.state = c.state || {}; return c; }
    return newConv();
  }
  function newConv() {
    const empty = store.convs.find((c) => !c.messages.length);
    const c = empty || { id: "c" + Date.now().toString(36), title: "", messages: [], state: {}, updatedAt: Date.now() };
    if (!empty) store.convs.push(c);
    store.currentId = c.id;
    conv = c;
    saveStore();
    return c;
  }
  function push(m) {
    m.id = m.id || "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    conv.messages.push(m);
    conv.updatedAt = Date.now();
    saveStore();
  }

  renderAll();

  return {
    destroy() {
      window.removeEventListener("examflow:change", onChange);
      root.remove();
    },
    open, close, send,
  };
}

// ------------------------------------------------------------------ helpers
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function mins(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`; }
function cssColor(c) { return /^(#[0-9a-f]{3,8}|var\(--[a-z-]+\)|rgb[a]?\([\d\s.,%]+\))$/i.test(String(c || "")) ? c : "var(--indigo, #5B4FE8)"; }

// Tiny, safe markdown: paragraphs, "- " bullets, "1. " lists, **bold**, *italic*, `code`.
function md(text) {
  const lines = String(text).split("\n");
  let html = "", list = null;
  const inline = (s) => richText(s).replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  let para = [];
  const flush = () => { if (para.length) { html += `<p>${para.map(inline).join("<br>")}</p>`; para = []; } };
  lines.forEach((ln) => {
    const b = ln.match(/^\s*[-•]\s+(.*)$/), n = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || n) {
      flush();
      const kind = b ? "ul" : "ol";
      if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
      html += `<li>${inline((b || n)[1])}</li>`;
    } else if (!ln.trim()) { flush(); closeList(); }
    else { closeList(); para.push(ln); }
  });
  flush(); closeList();
  return html;
}

// Start Flo (at the end, so everything above is defined first).
if (!window.__floBooted) {
  window.__floBooted = true;
  boot();
}
