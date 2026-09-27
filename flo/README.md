# Flo — ExamFlow's study companion

Flo is a study assistant built into ExamFlow. It uses the student's real ExamFlow data (class, subjects, chapters, exam dates, tasks, schedule, progress, quiz scores) and a library of trusted study notes. **It does not use any outside AI service.** If it doesn't have trusted information, it says so instead of guessing.

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

## Adding a stronger AI model later

Flo's brain is behind one small interface in `core/provider.js`. Today it uses the `LocalProvider` (trusted notes only). To add a model later — for example, your own server or a model running in the browser — create it with `createModelProvider({ name, generate })` and set `provider` in `config.js`. The model is only asked about questions the notes don't cover, it's given the nearest trusted notes as grounding, and it must say "I don't know" rather than guess. Its answers are labelled as AI-generated. Nothing else in Flo needs to change.
