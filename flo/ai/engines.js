// Flo · AI engines (optional)
// An "engine" is anything that can turn chat messages into text. Flo only talks to engines through
// this small interface, so the model or provider can be swapped without touching the rest of Flo:
//
//   engine.id / engine.label
//   await engine.check()                       → { ok, reason }   can this device/setup run it?
//   await engine.load(modelId, onProgress)     → loads (and the first time downloads) the model
//   await engine.complete(messages, { onToken, maxTokens, temperature }) → full text
//   engine.abort()                             → stop the current answer
//   engine.loaded                              → true when ready to answer
//
// Included:
//   createWebLLMEngine  — runs an open-source model INSIDE the learner's browser with WebGPU
//                         (free, private, no server, no outside AI service). Default.
//   createHttpEngine    — for later: any OpenAI-compatible endpoint you control (e.g. your own
//                         server running Ollama / llama.cpp / vLLM). Not enabled by default.

export function createWebLLMEngine({ libUrl, workerUrl, models }) {
  let lib = null, engine = null, loadedModel = null, loading = null;

  const engineApi = {
    id: "webllm",
    label: "On-device AI (runs in your browser)",
    models,
    get loaded() { return !!engine; },
    get modelId() { return loadedModel; },

    async check() {
      if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) return { ok: false, reason: "no-webgpu" };
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { ok: false, reason: "no-adapter" };
        const f16 = adapter.features && adapter.features.has && adapter.features.has("shader-f16");
        return { ok: true, f16: !!f16, memoryGB: navigator.deviceMemory || null };
      } catch (e) { return { ok: false, reason: "no-adapter" }; }
    },

    // Picks the variant this GPU can run (some GPUs don't support 16-bit maths).
    async resolveModel(choiceId) {
      const choice = models.find((m) => m.id === choiceId) || models.find((m) => m.recommended) || models[0];
      const c = await engineApi.check();
      return c.ok && !c.f16 && choice.fallback ? choice.fallback : choice.model;
    },

    async load(choiceId, onProgress = () => {}) {
      if (loading) return loading;
      loading = (async () => {
        const modelId = await engineApi.resolveModel(choiceId);
        if (engine && loadedModel === modelId) return true;
        lib = lib || (await import(/* @vite-ignore */ libUrl));
        if (engine) { try { await engine.unload(); } catch (e) {} engine = null; }
        const report = (r) => onProgress({ progress: typeof r.progress === "number" ? r.progress : null, text: r.text || "" });
        try {
          const worker = new Worker(workerUrl, { type: "module" });
          engine = await lib.CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: report });
        } catch (e) {
          // Some browsers can't run module workers; fall back to the page itself.
          engine = await lib.CreateMLCEngine(modelId, { initProgressCallback: report });
        }
        loadedModel = modelId;
        return true;
      })();
      try { return await loading; } finally { loading = null; }
    },

    async complete(messages, { onToken, maxTokens = 700, temperature = 0.4 } = {}) {
      if (!engine) throw new Error("model-not-loaded");
      const stream = await engine.chat.completions.create({ messages, stream: true, temperature, max_tokens: maxTokens });
      let text = "";
      for await (const chunk of stream) {
        const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (d) { text += d; if (onToken) onToken(text); }
      }
      return text;
    },

    abort() { try { engine && engine.interruptGenerate(); } catch (e) {} },

    async isDownloaded(choiceId) {
      try { lib = lib || (await import(/* @vite-ignore */ libUrl)); return await lib.hasModelInCache(await engineApi.resolveModel(choiceId)); } catch (e) { return false; }
    },

    async remove(choiceId) {
      lib = lib || (await import(/* @vite-ignore */ libUrl));
      const id = await engineApi.resolveModel(choiceId);
      if (engine && loadedModel === id) { try { await engine.unload(); } catch (e) {} engine = null; loadedModel = null; }
      await lib.deleteModelAllInfoInCache(id);
    },
  };
  return engineApi;
}

// For later: an OpenAI-compatible chat endpoint that YOU run (no third-party AI service needed).
export function createHttpEngine({ url, model, headers = {}, label = "Your AI server" }) {
  let ctrl = null, ok = false;
  return {
    id: "http", label, models: [{ id: model, label: model, model }],
    get loaded() { return ok; }, modelId: model,
    async check() { return url ? { ok: true } : { ok: false, reason: "no-url" }; },
    async resolveModel() { return model; },
    async load() { ok = true; return true; },
    async complete(messages, { onToken, maxTokens = 700, temperature = 0.4 } = {}) {
      ctrl = new AbortController();
      const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, temperature }) });
      if (!r.ok) throw new Error("http-" + r.status);
      const j = await r.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      if (onToken) onToken(text);
      return text;
    },
    abort() { try { ctrl && ctrl.abort(); } catch (e) {} },
    async isDownloaded() { return true; },
    async remove() {},
  };
}
