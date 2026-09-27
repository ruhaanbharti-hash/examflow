# Flo — ExamFlow's study companion

Flo is a study assistant built into ExamFlow for **any learner** — any class, board, course, competitive exam or self-study. It uses the learner's real ExamFlow data (subjects, chapters, exam dates, tasks, schedule, progress, quiz scores), a library of trusted study notes, and any material the learner adds (notes, PDFs, a syllabus).

**✨ Smart Study Mode (optional):** a learner can switch on a free, open-source AI model that runs *inside their own browser* (WebGPU). It helps with any subject at the learner's level. Nothing is sent to an AI company, answers are always labelled "AI-generated", and trusted notes / the learner's material are used first. If a device can't run it, or the learner doesn't want it, Flo works exactly as before.

## What's in this folder

```
flo/
├── flo.js              ← starts Flo and draws the chat panel
├── flo.css             ← Flo's styles (uses ExamFlow's own colours, so light and dark mode just work)
├── config.js           ← simple settings (button label, how many chats to keep, AI model slot)
├── core/
│   ├── pipeline.js     ← message → understand → student data → knowledge → reply → action
│   ├── nlu.js          ← understands casual student language, subjects, chapters, "in 3 days", "simpler"…
│   ├── context.js      ← turns ExamFlow data into facts: upcoming exams, pace, free time, weak areas
│   ├── knowledge.js    ← loads and searches the trusted notes library
│   ├── modes.js        ← Explain, Notes, Quiz, Revise, Doubt, Plan, Progress, What next…
│   ├── planner.js      ← builds realistic study plans in ExamFlow's session format
│   ├── actions.js      ← adds sessions, revision tasks, notes and quiz scores through ExamFlow
│   ├── provider.js     ← the swappable "AI layer" (default: no AI model)
│   └── text.js         ← text helpers
├── ai/
│   ├── engines.js      ← the swappable AI engine (on-device WebLLM; or your own server later)
│   └── worker.js       ← runs the AI model in a background thread
├── core/profile.js     ← learner level (class / course / board — all optional, free text)
├── core/smart.js       ← Smart mode: level-aware prompts, labels, AI quiz/flashcard parsing
├── core/material.js    ← learner's notes/PDFs: search, summaries, self-tests, syllabus parsing
├── core/tools.js       ← practice questions, answer checking, material tools (work without AI)
├── core/files.js       ← reads PDFs and text files in the browser
├── vendor/             ← web-llm.js and pdf.js (open-source, Apache 2.0) — see THIRD-PARTY-NOTICES.txt
├── knowledge/
│   ├── index.json      ← list of subjects and chapters
│   ├── general.json    ← study tips, exam stress, how to use ExamFlow
│   ├── class-9/science/…json      ← all 13 chapters of the new NCERT book "Exploration" (2026-27)
│   ├── class-9/mathematics/…json  ← all 8 chapters of "Ganita Manjari" Part 1 (2026-27)
│   ├── class-10/science/…json     ← Class 10 books are unchanged for 2026-27
│   └── general/english/tenses.json   (works for any class)
└── tools/
    ├── build-index.mjs   ← optional helper to rebuild index.json
    └── validate.mjs      ← checks chapter files (quiz answers, topic ids, no tables)
```

## How Flo connects to ExamFlow

`ExamFlow.html` contains a small addition inside the app that creates `window.ExamFlow`:

- `ExamFlow.get()` → the logged-in student's current data (the same data the app shows)
- `ExamFlow.act(name, …)` → runs one of ExamFlow's **own** functions: `addSessions`, `addRevision`, `addNote`, `markRevised`, `setChapterStatus`, `saveQuizResult`, `openFocus`, `goTo`, `updateFloPrefs`
- `ExamFlow.helpers` → ExamFlow's own calculations (chapter status, % complete, pace, "suggested next")

So everything Flo changes appears instantly on the Planner, Tasks, Notes and Practice pages and syncs like any other change. Flo never writes to the server directly and never duplicates data.

Flo only appears when a student is logged in. Chat history is kept in the student's own browser, and the explanation style they choose is saved in their ExamFlow settings.

## Adding knowledge (no code changes)

1. Create a chapter file, for example `knowledge/class-9/science/tissues.json`, following the format below.
2. Add one entry to `knowledge/index.json` under `"chapters"`:
   ```json
   { "id": "c9-sci-tissues", "class": 9, "subject": "science", "name": "Tissues", "aliases": ["tissue"], "file": "class-9/science/tissues.json" }
   ```
   That's all Flo needs. The `topics` and `faqs` lists in the index are optional — Flo fills them in from the file.
3. A **new subject**: add it under `"subjects"` in `index.json` with the names students might use:
   `"social": { "name": "Social Science", "aliases": ["sst", "social science", "history", "geography", "civics"] }`
4. A **new class**: just use `"class": 10` (or 11, 12…) and put files in `knowledge/class-10/…`.

Students' own subjects never need to be listed anywhere — Flo reads them from ExamFlow. The library only decides which topics Flo can *teach*.

### Chapter file format

```json
{
  "id": "c9-sci-tissues",
  "class": 9,
  "subject": "science",
  "name": "Tissues",
  "summary": "One or two sentences about the whole chapter.",
  "topics": [
    {
      "id": "plant-tissues",
      "title": "Plant tissues",
      "summary": "One line.",
      "simple": "Explanation in very simple words.",
      "explain": "The normal explanation. Use **bold**, and '- ' for bullet points.",
      "deep": "Optional extra detail for 'explain in detail'.",
      "example": "A real-life example.",
      "keyPoints": ["Short point", "Another point"],
      "keywords": ["words", "students", "might", "type"]
    }
  ],
  "keyConcepts": [{ "term": "Meristem", "meaning": "…" }],
  "formulas": [],
  "commonMistakes": ["…"],
  "revision": ["Must-know point 1", "Must-know point 2"],
  "faqs": [{ "q": "A question students ask", "a": "The answer", "keywords": ["…"] }],
  "quiz": [
    { "q": "Question?", "options": ["A", "B", "C", "D"], "answer": 1, "explain": "Why B is right", "topic": "plant-tissues", "level": "easy" }
  ]
}
```

`answer` counts from 0: 0 = A, 1 = B, 2 = C, 3 = D. Check every file before uploading: `node flo/tools/validate.mjs flo/knowledge/class-9/science/tissues-in-action.json` (or paste it into jsonlint.com).

**Old chapter names still work.** Each chapter in `index.json` lists `aliases`, including the old-syllabus names ("Motion", "Is Matter Around Us Pure", "Heron's Formula"…), so students whose ExamFlow syllabus still uses old names get the new notes.

## Smart Study Mode — how it works

- Learners open **Flo → ⚙️ Settings → Smart mode**, pick a model size (Light ≈0.7 GB, Standard ≈1 GB, Best ≈2 GB) and press **Download & turn on**. The model downloads once from Hugging Face and is cached by the browser.
- It needs WebGPU: a recent Chrome/Edge on a laptop, or a recent Android phone. Other devices see a short explanation and keep using Flo normally.
- Order of trust for every answer: 1) the learner's own material, 2) ExamFlow's trusted notes (if they match the learner's level), 3) the AI — labelled, with the trusted content given to it as reference.
- Planning, progress, tasks, schedule and focus always use ExamFlow's real data (never the AI).
- To hide Smart mode completely, set `smart.available: false` in `config.js`.
- To use a different AI later (e.g. your own server running Ollama), use `createHttpEngine` in `ai/engines.js` — nothing else changes.

## Adding a stronger AI model later (older note)

Flo's brain is behind one small interface in `core/provider.js`. Today it uses the `LocalProvider` (trusted notes only). To add a model later — for example, your own server or a model running in the browser — create it with `createModelProvider({ name, generate })` and set `provider` in `config.js`. The model is only asked about questions the notes don't cover, it's given the nearest trusted notes as grounding, and it must say "I don't know" rather than guess. Its answers are labelled as AI-generated. Nothing else in Flo needs to change.
