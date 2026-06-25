# Plan: Run LLM interpreter — `context="abstract"` slice

> First runnable LLM interpreter path for the obsidian-notepad-for-zotero Zotero
> plugin. A configured user clicks **Run LLM** in the note pane toolbar; the
> plugin processes every unresolved `{% llm context="abstract" %}...{% endllm %}`
> block: renders each prompt body with the current Zotero item data, sends a
> grounded OpenAI-compatible Chat Completions request per block, and replaces
> **all** blocks with static markdown **only if the whole run succeeds**
> (all-or-nothing). This slice ships `context="abstract"` only;
> `annotations` / `fulltext` / multi-context assembly are explicitly out of scope.

---

## 1. Context & goals

### What exists today (confirmed, do not re-explore)
- `src/llm.js` — stateless OpenAI-compatible provider helpers: `LLM_DEFAULTS`,
  `isLLMConfigured`, `canAutoRun`, `sanitizeLLMSettings`, `buildChatCompletionsURL`,
  `buildLLMHeaders`, `buildChatCompletionsPayload(settings, messages)` (messages =
  `[{role,content}]`), `buildTestConnectionPayload`, `parseChatCompletionsResponse`
  (returns `""` for empty/whitespace/non-string content, trims otherwise),
  `sanitizeError` (redacts Bearer/api keys, truncates to 500 chars), `sanitizeLogMetadata`.
- `src/llm-blocks.js` — parser: `SUPPORTED_CONTEXTS = ["abstract","annotations","fulltext"]`,
  `parseLLMContext`, `hasLLMBlocks`, `parseLLMBlocks(text) → { blocks, errors }`,
  `validateLLMBlocks`. Block shape: `{ openRaw, closeRaw, contextArg, contexts, body,
  lineFrom, lineTo }` where `lineFrom`/`lineTo` are **0-based inclusive line indices**
  of the open and close tag lines. There is **no** resolved/unresolved state —
  "unresolved" = any block the parser returns. Parse `errors` are
  `{ code, message, line }`.
- `src/render.js` — `makeEnv()` + `render(templateString, data)`. Nunjucks env with
  `format` + `filterby` filters and the `llm` extension (which re-wraps rendered
  bodies in `{% llm %}...{% endllm %}`). **`render()` works under Vitest** (nunjucks
  `^3.2.4` + dayjs `^1.11.13` are deps; `test/render.spec.js` passes in Node), so a
  pure runner module can import `render` directly and stay unit-testable.
- `src/item-data.js` — `buildItemData(item, opts)` → object including
  `abstractNote: item.getField("abstractNote")`.
- `core/core.js` — barrel that re-exports every `src/` module into the `ZONCore`
  global (IIFE bundle). New exports are added here.
- `addon/bootstrap.js` (~2830 lines):
  - LLM prefs constants (lines 43–50) + defaults (73–80).
  - Accessors (696–751): `llmBaseURL/Model/ApiKey/Temperature/MaxTokens/MaxContextChars/TimeoutSeconds/AutoRunPref`,
    `llmConfigured()` (729), `getLLMSettings()` (732–743), `llmAutoRun()` (744).
  - `testLLMConnection()` (752–786) — the HTTP pattern to mirror:
    `Zotero.HTTP.request("POST", url, { headers, body: JSON.stringify(payload),
    responseType: "text", timeout: s.timeoutSeconds*1000 })` then
    `parseChatCompletionsResponse(resp.responseText)` / `sanitizeError(e)`.
  - `STRINGS` map (354–444); `t(key, args)` (447–452) with `{name}` placeholders.
    `status.llmBlocksPreserved` (443) exists but is unused.
  - `buildEditorUI(wrap, win)` (1250): toolbar rows. Row2 (1380):
    `row2.append(refreshBtn, openBtn, reloadBtn)` (+ `moreWrap` if experimental).
    Button pattern: `h("button", cls)` → `btn.textContent = this.t("btn.x")` →
    `btn.addEventListener("click", () => this.handler(rec)...)`.
  - `rec` object literal (1452): `{ view, lib, iframe, frameWin, host, toolbar, banner,
    bannerText, setup, conflict, noteTplSel, templateSel, colourSel, syncSel,
    markersChk, readChk, frontChk, applyTemplateDefaults, statusEl: status, wrap,
    path, item, loading, timer, diskMtime }`.
  - `renderInto(wrap, item)` (1076) — sets `rec.item`, shows/hides toolbar; the
    re-fit branch (1114) fires on pane re-focus (good hook for re-evaluating button
    enabled state).
  - Safety primitives: `safeWrite(path, text)` (1659, atomic via `.zon.tmp`),
    `noteMtime(path)` (1663), `externallyChanged(rec)` (1669), `showConflict(rec)` /
    `hideConflict(rec)` (1675/1679), `save(rec, opts)` (1683), `flush(rec)` (1696,
    clears `rec.timer` + `save`), `setStatus(rec, text)` (1735).
  - `refreshNote(rec)` (2594) — the canonical safety pattern to follow:
    1. `if (rec.timer && await this.externallyChanged(rec)) { this.showConflict(rec); return; }`
    2. `await this.flush(rec)`
    3. `let existing = await IOUtils.readUTF8(rec.path)` (catch → status + return)
    4. build `data = ZONCore.buildItemData(item, { citekey, bibliography, importDate })`
    5. transform `existing` → `merged`
    6. `await this.safeWrite(rec.path, merged)` (catch → status + return)
    7. `rec.diskMtime = await this.noteMtime(rec.path)`
    8. `this.hideConflict(rec)`
    9. `this.mountEditor(rec, win, merged)`
    10. `this.setStatus(rec, ...)`
  - `renderDocument(win, item, templateText)` (1962) — shows how `citekey` +
    `bibliography` are obtained (`this.getCitekey(item)`, `await this.getBibliography(item)`)
    before `buildItemData`. Both helpers exist and are used widely.
  - `validateLLMTemplate(win, text)` (2027) — safe wrapper around
    `ZONCore.validateLLMBlocks` with a crash → `{valid:true}` fallback.
- Tests: Vitest covers `test/*.spec.js` (imports from `../src/...`, no Zotero
  globals); `vitest.config.js` includes `test/*.spec.js` and excludes
  `test/integration/**`. `test/fixtures/data.js` exports `item` with
  `abstractNote: "A study of how networks shape cognition."`. Mock item pattern
  (from `test/item-data.spec.js`): `{ itemType, key, libraryID, library,
  getField: (k) => fields[k] || "", getCreators: () => [...], getTags: () => [...] }`.

### Goals
1. New pure ES module `src/llm-runner.js` (no DOM, no Zotero globals) holding all
   run logic: context resolution, prompt rendering, message assembly, output
   normalization, all-or-nothing block replacement, run planning, and per-response
   success/failure classification. Vitest-testable.
2. HTTP IO + UI live in `bootstrap.js` via a new `runLLM(rec)` handler that follows
   the `refreshNote` safety pattern exactly.
3. A **Run LLM** toolbar button, enabled only when base URL + model are configured.
4. All-or-nothing semantics: collect every block's output first; replace + write
   only if every block succeeded. Empty provider responses are failures.
5. Errors never expose prompt body or context text.

### Non-goals (this slice)
- `context="annotations"` / `context="fulltext"` resolution (rejected with a clear
  "not yet supported" error).
- Multi-context assembly (`context="abstract,annotations"`).
- Auto-run on note create/insert (`canAutoRun` stays unused by this path).
- Streaming; retry/backoff; token-usage accounting.

---

## 2. Architecture & module boundaries

```
src/llm-runner.js   NEW  pure run logic (Vitest-testable)
   imports: parseLLMBlocks from ./llm-blocks.js, render from ./render.js
   exports: GROUNDING_SYSTEM_PROMPT, RUNNABLE_CONTEXTS, LLM_RUN_ERRORS,
            buildLLMMessages, normalizeLLMOutput, classifyLLMOutput,
            prepareLLMRun, applyLLMOutputs
core/core.js         ADD  re-export the new symbols → ZONCore global
addon/bootstrap.js   ADD  STRINGS keys, Run LLM button + rec field,
                          updateLLMButton(rec), runLLM(rec) handler,
                          renderInto() hook to refresh button state
test/llm-runner.spec.js  NEW  Vitest unit tests for every acceptance behavior
```

**Purity contract:** `llm-runner.js` touches no `Zotero.*`, no `IOUtils`, no DOM,
no `fetch`/`Zotero.HTTP`. It takes `(text, itemData)` and returns plain objects.
All network calls stay in `bootstrap.js` (mirroring `testLLMConnection`).

---

## 3. `src/llm-runner.js` — API design

### 3.1 Constants

```js
// Built-in, grounded system prompt. Sent as the {role:"system"} message for every
// block. Instructs the model to act as a research assistant, output ONLY markdown
// for the task, ground strictly in the provided context, and add no commentary
// outside the task. (Exact text — do not paraphrase without updating the test that
// asserts its contents.)
export const GROUNDING_SYSTEM_PROMPT =
  "You are a research assistant embedded in a Zotero literature note. " +
  "Complete the task given in the user message and output only Markdown that " +
  "fulfills it. Ground your answer strictly in the context provided in the user " +
  "message; do not introduce facts, interpretations, or citations that are not " +
  "present there. Output only the task result — no preface, no commentary, no " +
  "explanation outside the requested content. If the provided context is not " +
  "sufficient to complete the task, respond with a brief Markdown note stating " +
  "what is missing.";

// Contexts this slice can actually run. annotations/fulltext are syntactically
// valid (SUPPORTED_CONTEXTS) but not yet runnable — prepareLLMRun rejects them
// with LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED. Extend this set + add resolvers in
// later slices.
export const RUNNABLE_CONTEXTS = ["abstract"];

// Stable error codes. The bootstrap maps these to STRINGS; they never carry
// prompt body or context text.
export const LLM_RUN_ERRORS = {
  NO_BLOCKS: "llm.run.noBlocks",
  PARSE_ERRORS: "llm.run.parseErrors",
  CONTEXT_UNSUPPORTED: "llm.run.contextUnsupported",
  CONTEXT_MISSING: "llm.run.contextMissing",
  RENDER_FAILED: "llm.run.renderFailed",
  EMPTY_RESPONSE: "llm.run.emptyResponse",
  HTTP_FAILED: "llm.run.httpFailed",
};
```

### 3.2 `buildLLMMessages(systemPrompt, taskText, contextText)` → `Array<{role,content}>`

Assembles the provider message array: one system message (the grounded prompt) +
one user message with clearly separated, labeled **Task:** and **Context:**
sections.

```js
export function buildLLMMessages(systemPrompt, taskText, contextText) {
  const task = String(taskText ?? "");
  const ctx = String(contextText ?? "");
  const user = `Task:\n${task}\n\nContext:\n${ctx}`;
  return [
    { role: "system", content: String(systemPrompt ?? "") },
    { role: "user", content: user },
  ];
}
```

**Exact user-message format produced:**

```
Task:
<rendered prompt body>

Context:
<abstract text>
```

(A single blank line separates the rendered task body from the `Context:` label.
`systemPrompt` is sent verbatim as the system message — `GROUNDING_SYSTEM_PROMPT`.)

### 3.3 `normalizeLLMOutput(raw)` → `string`

Trim leading/trailing whitespace and normalize line endings to `\n`.

```js
export function normalizeLLMOutput(raw) {
  return String(raw ?? "").replace(/\r\n?/g, "\n").trim();
}
```

### 3.4 `classifyLLMOutput(content)` → `{ ok, code?, output? }`

Pure per-block success/failure decision (so the "empty response = failure" rule is
unit-testable without HTTP). `content` is what `parseChatCompletionsResponse`
already returned (it yields `""` for empty/whitespace/non-string).

```js
export function classifyLLMOutput(content) {
  const c = String(content ?? "").trim();
  if (c.length === 0) return { ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE };
  return { ok: true, output: normalizeLLMOutput(c) };
}
```

### 3.5 `prepareLLMRun(text, itemData)` → `{ ok, code, errors, blocks, tasks }`

The pure run planner. Parses blocks, validates, resolves context, renders each
prompt body with the existing Nunjucks env, and assembles messages — **all before
any HTTP**. Any pre-flight failure aborts the whole run (all-or-nothing starts
here: a single bad block yields `ok:false` and `tasks:[]`).

**Return shape:**
- `ok: boolean`
- `code: string` — one of `LLM_RUN_ERRORS.*` (or `"ok"`)
- `errors: Array<{ code, message, line, detail? }>` — `message` is always a
  **safe, static** string (never prompt body / context text); `detail` is an
  optional debug-only string the bootstrap logs but never shows.
- `blocks: Array` — the parsed blocks (empty on parse failure / no-blocks).
- `tasks: Array<{ block, messages, contextLabel }>` — aligned with `blocks`;
  empty unless `ok === true`.

**Algorithm:**
1. `const { blocks, errors } = parseLLMBlocks(text)`.
2. If `errors.length > 0` → `{ ok:false, code: PARSE_ERRORS, errors, blocks:[], tasks:[] }`.
3. If `blocks.length === 0` → `{ ok:false, code: NO_BLOCKS, errors:[], blocks:[], tasks:[] }`.
4. For each `block` in `blocks` (document order), build a task via
   `prepareTask(block, itemData)`:
   - **Context resolution** (abstract only this slice):
     - If `block.contexts.length !== 1` → fail `CONTEXT_UNSUPPORTED`
       ("context '…' is not yet supported by Run LLM (only 'abstract')").
     - If `block.contexts[0] !== "abstract"` → fail `CONTEXT_UNSUPPORTED`.
     - `const abstract = String(itemData?.abstractNote ?? "").trim();`
     - If `abstract === ""` → fail `CONTEXT_MISSING`
       ("abstract is empty for this item — cannot run with context='abstract'").
   - **Prompt rendering:** `const rendered = render(block.body, itemData);`
     wrapped in try/catch → on throw, fail `RENDER_FAILED` with a **static**
       message ("prompt render failed (check template variables)") and attach the
       raw nunjucks message as `detail` (debug-only, never shown).
   - **Message assembly:**
     `const messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, abstract);`
   - Return `{ ok:true, block, messages, contextLabel: "abstract" }`.
   - On any pre-flight failure, immediately return
     `{ ok:false, code: <that code>, errors:[{code, message, line: block.lineFrom, detail?}], blocks, tasks:[] }`
     — i.e. the whole run is aborted; no partial task list.
5. If every block prepared successfully →
   `{ ok:true, code:"ok", errors:[], blocks, tasks }`.

### 3.6 `applyLLMOutputs(text, blocks, outputs)` → `string`

Replaces each block's line range with the corresponding normalized output.
**All-or-nothing is enforced by the caller** (the bootstrap only calls this after
every block succeeded). `outputs[i]` aligns with `blocks[i]`.

**Line-offset safety:** blocks are applied **last-to-first** (descending
`lineFrom`) so replacing a later block never shifts the line indices of an
earlier one. Implementation splices the `lines` array:

```js
export function applyLLMOutputs(text, blocks, outputs) {
  const lines = String(text ?? "").split("\n");
  const order = blocks
    .map((b, i) => i)
    .sort((a, b) => blocks[b].lineFrom - blocks[a].lineFrom);
  for (const i of order) {
    const blk = blocks[i];
    const out = String(outputs[i] ?? "");
    const outLines = out.length ? out.split("\n") : [];
    lines.splice(blk.lineFrom, blk.lineTo - blk.lineFrom + 1, ...outLines);
  }
  return lines.join("\n");
}
```

(`splice(start, deleteCount, ...items)` with `deleteCount = lineTo - lineFrom + 1`
replaces the inclusive `[lineFrom, lineTo]` range — correct for both multi-line
and single-line (`lineFrom === lineTo`) blocks.)

### 3.7 Error object shape (recap)

```ts
type RunError = { code: string, message: string, line: number | null, detail?: string };
// message: safe to show (static). detail: debug-only (e.g. raw nunjucks error).
```

No function in this module throws for expected failures; all failures are
returned as `{ ok:false, ... }`. (`render` is the one throwing call and is
wrapped.) This matches the `validateLLMBlocks` result-object style already in
the codebase.

---

## 4. `core/core.js` — exports to add

Append one line (mirrors the existing `llm.js` / `llm-blocks.js` re-exports):

```js
export { GROUNDING_SYSTEM_PROMPT, RUNNABLE_CONTEXTS, LLM_RUN_ERRORS, buildLLMMessages, normalizeLLMOutput, classifyLLMOutput, prepareLLMRun, applyLLMOutputs } from "../src/llm-runner.js";
```

The scaffold scans `core` (per `zotero-plugin.config.ts` `source: ["addon","editor","core","src"]`),
so this re-export lands in the `ZONCore` IIFE global automatically.

---

## 5. `addon/bootstrap.js` — changes

### 5.1 New `STRINGS` keys (add into the `STRINGS` map, ~line 443, before the
closing `}`; keep the existing `status.llmBlocksPreserved` line)

| Key | Text |
| --- | --- |
| `"btn.runLLM"` | `"Run LLM"` |
| `"tip.runLLM"` | `"Run the LLM interpreter on unresolved {% llm %} blocks in this note (requires base URL and model)"` |
| `"status.llmRunning"` | `"Running LLM {i}/{n}…"` |
| `"status.llmRunDone"` | `"Ran LLM — {count} block(s) updated"` |
| `"status.llmRunNoBlocks"` | `"No {% llm %} blocks to run"` |
| `"err.llmRunRead"` | `"LLM run read failed — "` |
| `"err.llmRunWrite"` | `"LLM run write failed — "` |
| `"err.llmRunFailed"` | `"LLM run failed — {error}"` |
| `"err.llmRunBlock"` | `"LLM block (line {line}): {message}"` |
| `"err.llmRunHttp"` | `"block {i}/{n} failed: {error}"` |
| `"err.llmRunEmpty"` | `"block {i}/{n} returned an empty response"` |

(Reuse existing `err.llmBlocksInvalid` + `err.llmBlockInvalid` for parse-error
status, and existing `err.llmNotConfigured` / `err.llmCoreMissing` for config
guards — no duplicates.)

### 5.2 Toolbar button wiring (in `buildEditorUI`, ~line 1328 near `reloadBtn`)

```js
let runLLMBtn = h("button"); runLLMBtn.textContent = this.t("btn.runLLM");
runLLMBtn.title = this.t("tip.runLLM");
runLLMBtn.disabled = !this.llmConfigured();
```

Append to **row2** (the note-actions row, line 1380) immediately after
`refreshBtn` (Run LLM is conceptually closest to Update — both transform the
whole note from current Zotero data):

```js
let row2 = h("div", "zon-row zon-row-actions"); row2.append(refreshBtn, runLLMBtn, openBtn, reloadBtn);
if (this.experimentalEnabled()) row2.append(moreWrap);
```

Add `runLLMBtn` to the `rec` object literal (line 1452):

```js
let rec = { ..., runLLMBtn, loading: false, timer: null, diskMtime: null };
```

Click handler (near line 1462, next to `refreshBtn`'s handler):

```js
runLLMBtn.addEventListener("click", () => this.runLLM(rec).catch((e) => this.log("LLM run failed: " + e)));
```

### 5.3 `updateLLMButton(rec)` — keep enabled state in sync with config

Config can change in the preferences pane while a note is open; the pane re-fires
`renderInto` on re-focus (the re-fit branch at line 1114), so refreshing the
button there keeps it accurate.

```js
updateLLMButton(rec) {
  try { if (rec && rec.runLLMBtn) rec.runLLMBtn.disabled = !this.llmConfigured(); } catch (e) {}
},
```

Call sites in `renderInto(wrap, item)` (1076):
- In the re-fit branch (after `rec.item = item;` at line 1115): add
  `this.updateLLMButton(rec);`
- In the fresh-load branch (after `rec.item = item;` at line 1128, before showing
  the toolbar): add `this.updateLLMButton(rec);`
- (The not-configured / `!this.notesDir()` branch at 1092 hides the whole
  toolbar, so no call needed there.)

### 5.4 `runLLM(rec)` handler — step-by-step pseudocode (follows `refreshNote`)

```js
async runLLM(rec) {
  let item = rec.item;
  if (!item || !rec.path) return;
  let win = rec.host.ownerDocument.defaultView;
  if (!win.ZONCore) await this.injectCore(win);
  let C = win.ZONCore;

  // Guard: runner exports present (graceful if an old bundle is cached).
  if (!C.prepareLLMRun || !C.applyLLMOutputs) {
    this.setStatus(rec, this.t("err.llmCoreMissing"));
    return;
  }

  // Guard: configured (base URL + model). Acceptance #1.
  let settings = C.sanitizeLLMSettings(this.getLLMSettings());
  if (!C.isLLMConfigured(settings)) {
    this.setStatus(rec, this.t("err.llmNotConfigured"));
    return;
  }

  // Safety #1: abort on external disk conflict (same as Refresh). Acceptance #9.
  if (rec.timer && await this.externallyChanged(rec)) { this.showConflict(rec); return; }

  // Safety #2: flush pending edits before reading. Acceptance #9.
  await this.flush(rec);

  // Read the on-disk note (authoritative source — matches Refresh).
  let existing = "";
  try { existing = await IOUtils.readUTF8(rec.path); }
  catch (e) {
    this.setStatus(rec, this.t("err.llmRunRead") + C.sanitizeError(e));
    this.log("llm run read failed: " + e);
    return;
  }

  // Build item data with parity to renderDocument so prompts can use any field
  // ({{title}}, {{creators}}, {{bibliography}}, filters/loops/conditionals).
  let citekey = this.getCitekey(item);
  let bibliography = await this.getBibliography(item);
  let data = {};
  try { data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString() }); }
  catch (e) { this.log("buildItemData failed: " + e); }

  // Plan the run (pure): parse + validate + resolve context + render prompts +
  // assemble messages. Any pre-flight failure aborts here — no HTTP yet.
  let prepared = C.prepareLLMRun(existing, data);
  if (!prepared.ok) {
    if (prepared.code === C.LLM_RUN_ERRORS.NO_BLOCKS) {
      this.setStatus(rec, this.t("status.llmRunNoBlocks"));      // Acceptance #10
      return;
    }
    if (prepared.code === C.LLM_RUN_ERRORS.PARSE_ERRORS) {
      let first = prepared.errors[0];
      this.setStatus(rec, this.t("err.llmBlocksInvalid", { count: prepared.errors.length })
        + " " + (first ? this.t("err.llmBlockInvalid",
          { line: first.line != null ? first.line : "?", message: first.message }) : ""));
      return;
    }
    // Per-block pre-flight: CONTEXT_UNSUPPORTED / CONTEXT_MISSING / RENDER_FAILED.
    let first = prepared.errors[0];
    this.setStatus(rec, this.t("err.llmRunBlock",
      { line: first.line != null ? first.line : "?", message: first.message }));
    if (first.detail) this.log("llm run pre-flight: " + first.detail); // debug only
    return;
  }

  // Execute HTTP per block, in document order, collecting outputs.
  // All-or-nothing: break on the first failure and DO NOT write. Acceptance #7/#8.
  let url = C.buildChatCompletionsURL(settings.baseURL);
  let headers = C.buildLLMHeaders(settings);
  let outputs = [];
  let n = prepared.tasks.length;
  for (let i = 0; i < n; i++) {
    let task = prepared.tasks[i];
    this.setStatus(rec, this.t("status.llmRunning", { i: i + 1, n }));   // "Running LLM 1/3…"
    let payload = C.buildChatCompletionsPayload(settings, task.messages);
    let content = "";
    try {
      let resp = await Zotero.HTTP.request("POST", url, {
        headers, body: JSON.stringify(payload), responseType: "text",
        timeout: settings.timeoutSeconds * 1000,
      });
      content = C.parseChatCompletionsResponse(resp.responseText);
    } catch (e) {
      let status = (e && typeof e.status === "number") ? e.status : null;
      let errStr = status ? ("HTTP " + status) : C.sanitizeError(e);
      this.log("llm run http failed (block " + (i + 1) + "/" + n + ")"
        + (status ? " (HTTP " + status + ")" : ""));
      this.setStatus(rec, this.t("err.llmRunFailed",
        { error: this.t("err.llmRunHttp", { i: i + 1, n, error: errStr }) }));
      return; // note unchanged
    }
    let res = C.classifyLLMOutput(content);          // empty → failure
    if (!res.ok) {
      this.log("llm run empty response (block " + (i + 1) + "/" + n + ")");
      this.setStatus(rec, this.t("err.llmRunFailed",
        { error: this.t("err.llmRunEmpty", { i: i + 1, n }) }));
      return; // note unchanged
    }
    outputs.push(res.output);
  }

  // Every block succeeded → apply all replacements + write once. Acceptance #6/#7.
  let updated = C.applyLLMOutputs(existing, prepared.blocks, outputs);
  try { await this.safeWrite(rec.path, updated); }
  catch (e) {
    this.setStatus(rec, this.t("err.llmRunWrite") + C.sanitizeError(e));
    this.log("llm run write failed: " + e);
    return;
  }
  rec.diskMtime = await this.noteMtime(rec.path);
  this.hideConflict(rec);
  this.mountEditor(rec, win, updated);               // remount with new content
  this.setStatus(rec, this.t("status.llmRunDone", { count: prepared.blocks.length }));
}
```

**Error-UI notes (Acceptance #11):** the pane status is a single concise line
built entirely from `STRINGS` (no prompt/context text). `message` fields from the
runner are static strings; the only dynamic parts are line numbers, block
indices, and `sanitizeError(e)` (which redacts tokens + truncates to 500 chars
and never contains request bodies). Longer diagnostics (raw nunjucks errors,
HTTP statuses) go to `Zotero.debug` via `this.log(...)` — never to the pane.

---

## 6. Test plan — `test/llm-runner.spec.js`

Vitest, imports from `../src/llm-runner.js` (and `../src/llm-blocks.js`,
`../src/render.js`, `../test/fixtures/data.js` where useful). No Zotero globals.
Mirrors the style of `test/llm.spec.js` / `test/llm-blocks.spec.js`.

```js
import { describe, it, expect } from "vitest";
import {
  GROUNDING_SYSTEM_PROMPT, RUNNABLE_CONTEXTS, LLM_RUN_ERRORS,
  buildLLMMessages, normalizeLLMOutput, classifyLLMOutput,
  prepareLLMRun, applyLLMOutputs,
} from "../src/llm-runner.js";
import { item } from "./fixtures/data.js";
```

### describe("GROUNDING_SYSTEM_PROMPT")
- it("is a non-empty string")
- it("instructs: research assistant, markdown only, grounded in context, no commentary")
  — assert it contains "research assistant", "Markdown", "context", and "no commentary" (or "no preface").

### describe("RUNNABLE_CONTEXTS")
- it("equals ['abstract'] for this slice")

### describe("buildLLMMessages")
- it("returns a system message + a user message")
- it("system content === GROUNDING_SYSTEM_PROMPT")
- it("user content has a 'Task:' section containing the rendered prompt body")
- it("user content has a 'Context:' section containing the context text")
- it("separates Task and Context with a blank line") — assert `\n\nContext:\n` present.
- it("handles empty task/context without throwing (still two messages)")

### describe("normalizeLLMOutput")
- it("trims leading and trailing whitespace")
- it("normalizes CRLF → LF")
- it("normalizes lone CR → LF")
- it("preserves internal whitespace and blank lines")
- it("returns '' for null/undefined/whitespace-only input")

### describe("classifyLLMOutput")
- it("returns {ok:false, code: EMPTY_RESPONSE} for '' / whitespace")
- it("returns {ok:true, output} for non-empty content, output normalized")
- it("output is trimmed + CRLF-normalized")

### describe("applyLLMOutputs")
- it("replaces a single multi-line block with the output lines")
- it("replaces a single-line block (lineFrom === lineTo)")
- it("replaces multiple blocks in one pass and preserves surrounding prose")
- it("applies blocks last-to-first so earlier line offsets stay valid")
  — construct two blocks where the first block's replacement is multi-line and
    assert the second block's text is still replaced correctly (proves ordering).
- it("an empty output removes the block's lines entirely")
- it("is a pure function (does not mutate input text)")

### describe("prepareLLMRun — abstract success")  // Acceptance #3/#4/#5
- it("returns {ok:true} with one task for a single abstract block")
- it("task.messages is [system, user] from buildLLMMessages")
- it("user message Context section contains item.abstractNote")
- it("blocks array matches parseLLMBlocks output")

### describe("prepareLLMRun — prompt rendering")  // Acceptance #4
- it("renders {{title}} inside the prompt body against itemData")
- it("renders {% for %} loops over creators")
- it("renders {% if %} conditionals")
- it("rendered prompt appears in the user message Task section, not the raw template")
- it("a block body with no variables passes through unchanged")

### describe("prepareLLMRun — missing abstract failure")  // Acceptance #3
- it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is ''")
- it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is whitespace")
- it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is undefined")
- it("error.message is static and does not include the prompt body")

### describe("prepareLLMRun — context unsupported")  // out-of-scope contexts
- it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for context='annotations'")
- it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for context='fulltext'")
- it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for multi-context 'abstract,annotations'")
- it("error.message names the unsupported context but not the prompt body")

### describe("prepareLLMRun — no blocks")  // Acceptance #10
- it("returns {ok:false, code: NO_BLOCKS} for plain text with no LLM tags")
- it("returns {ok:false, code: NO_BLOCKS} for an empty string")

### describe("prepareLLMRun — parse errors")  // Acceptance #2 (validation)
- it("returns {ok:false, code: PARSE_ERRORS} for an unclosed block")
- it("returns {ok:false, code: PARSE_ERRORS} for an unknown context")
- it("carries the first error's line number")

### describe("prepareLLMRun — render failure")  // Acceptance #11
- it("returns {ok:false, code: RENDER_FAILED} for a malformed nunjucks body")
- it("error.message is a static string (does not leak the body / nunjucks snippet)")
- it("error.detail carries the raw nunjucks message for debug logging")

### describe("prepareLLMRun — all-or-nothing pre-flight")  // Acceptance #7
- it("aborts the whole run when the 2nd of 2 blocks is unsupported (tasks: [])")
- it("aborts the whole run when the 1st of 2 blocks has a missing abstract")
- it("never returns a partial task list")

### describe("provider message assembly")  // Acceptance #5
- it("a prepared abstract task yields messages with the grounded system prompt")
- it("the user message is exactly 'Task:\\n<prompt>\\n\\nContext:\\n<abstract>'")

### Run command
```bash
npx vitest run test/llm-runner.spec.js   # focused
npm test                                  # full suite (must stay green)
```

> **Note on empty-response & HTTP tests:** the *decision* that an empty response
> is a failure is unit-tested via `classifyLLMOutput`. The actual `Zotero.HTTP`
> call + `parseChatCompletionsResponse` wiring lives in `bootstrap.js` and is
> verified by build + manual/integration runs (see §7), since Vitest cannot load
> `bootstrap.js` (Zotero globals). `parseChatCompletionsResponse` itself is
> already covered by `test/llm.spec.js`.

---

## 7. Implementation slices (ordered, for `code-executor` delegation)

### Slice 1 — Pure runner + unit tests (no Zotero needed)
1. Create `src/llm-runner.js` with the constants and functions in §3 (import
   `parseLLMBlocks` from `./llm-blocks.js` and `render` from `./render.js`).
2. Add the `core/core.js` re-export line (§4).
3. Create `test/llm-runner.spec.js` (§6).
4. **Verify:** `npx vitest run test/llm-runner.spec.js` (all green) then
   `npm test` (no regressions). `npm run build` should also succeed (the new
   module is picked up by the scaffold `source` list).

**Delegation note:** Slice 1 is fully self-contained and verifiable without
Zotero. Hand it to `code-executor` as one unit; require the vitest commands above
as the exit gate.

### Slice 2 — UI + IO wiring in `bootstrap.js` (build-verifiable; runtime needs Zotero)
1. Add the `STRINGS` keys (§5.1).
2. Add the Run LLM button + `rec.runLLMBtn` + click handler in `buildEditorUI`
   (§5.2).
3. Add `updateLLMButton(rec)` and its two `renderInto` call sites (§5.3).
4. Add the `runLLM(rec)` method (§5.4), placed near `refreshNote` (~line 2653).
5. **Verify:** `npm run build` (compiles the `.xpi`; catches syntax/reference
   errors). `npm test` (still green — no vitest changes). Then `npm start` for
   manual smoke (configure base URL + model in prefs; open a note with an
   abstract-context block; click Run LLM; confirm replacement + status). Optional
   integration: add `test/integration/llm-run.spec.js` under Mocha if desired
   (out of the required path).

**Delegation note:** Slice 2 depends on Slice 1's `ZONCore` exports existing.
Hand to `code-executor` only after Slice 1 is merged/verified. Exit gate:
`npm run build` succeeds and `npm test` stays green.

---

## 8. Risks & edge cases

- **Block line offsets shifting during replacement.** Blocks carry 0-based
  inclusive `lineFrom`/`lineTo`. Replacing block A (earlier) before block B
  (later) would shift B's indices and corrupt the result. **Mitigation:**
  `applyLLMOutputs` applies blocks **last-to-first** (descending `lineFrom`) via
  `Array.splice`, so earlier ranges are untouched by later edits. Covered by a
  dedicated test.
- **Nunjucks render errors.** A malformed prompt body (`{% for x in %}`, bad
  filter, undefined tag) makes `render()` throw. **Mitigation:** `prepareLLMRun`
  catches, returns `RENDER_FAILED` with a **static** `message` and the raw
  nunjucks text only in `detail` (debug-logged, never shown). Acceptance #11.
- **Nunjucks interpreting a literal `{% llm %}` inside a prompt body.** The
  parser keeps a literal `{% llm %}` tag inside a body as body text (per
  `llm-blocks.spec.js`), but `render()` would invoke the `llm` extension on it
  and re-wrap. **Mitigation:** This is a pre-existing `render()` behavior, not
  introduced here; document it as a known edge case. Authors should not embed
  `{% llm %}` tags inside prompt bodies. Not blocking for this slice.
- **HTTP timeout.** `Zotero.HTTP.request` throws on timeout; the per-block
  try/catch maps it to `err.llmRunHttp` via `sanitizeError(e)` (or `HTTP <status>`
  when `e.status` is present) and aborts the run (note unchanged). The
  `timeoutSeconds` pref (clamped 1–600) is honored. No retry/backoff (out of scope).
- **Empty provider responses.** `parseChatCompletionsResponse` returns `""` for
  empty/whitespace/non-string content; `classifyLLMOutput` then yields
  `{ok:false, code: EMPTY_RESPONSE}` and the run aborts. Acceptance #8.
- **Prompt/context leakage in errors.** All runner `message` fields are static
  strings; HTTP errors use `sanitizeError` (redacts Bearer/api keys, truncates)
  and never include the request body; the pane status is built only from
  `STRINGS` + safe fields (line numbers, block indices). Acceptance #11.
- **Stale `ZONCore` bundle.** If an old bundle without `prepareLLMRun` is cached,
  `runLLM` falls back to `err.llmCoreMissing` instead of crashing. (Matches the
  defensive `testLLMConnection` / `validateLLMTemplate` style.)
- **External disk edit mid-run.** The conflict check runs **before** the run
  (same as Refresh). If Obsidian changes the file *during* the (possibly
  multi-block) HTTP loop, the final `safeWrite` would clobber it. **Mitigation:**
  this matches the existing Refresh semantics (which also doesn't re-check after
  its async work); the `rec.diskMtime` baseline is refreshed after the write. A
  second pre-write conflict check could be added later if needed (out of scope;
  noted as a follow-up).
- **`getBibliography` cost.** Run LLM calls `getBibliography` (QuickCopy) for
  prompt-rendering parity with `renderDocument`, even though the abstract context
  only needs `abstractNote`. This is a one-time async cost per user-initiated
  click — acceptable. If it proves slow, a later slice can skip it when no prompt
  references `{{bibliography}}` (out of scope).
- **Button enabled-state staleness.** Config can change in prefs while a note is
  open. `updateLLMButton` is called from `renderInto`'s re-fit branch (fires on
  pane re-focus) and fresh-load branch. If the user changes config without
  refocusing the pane, the button may stay stale until the next render. Acceptable
  for this slice; the click handler also re-checks `isLLMConfigured` and shows
  `err.llmNotConfigured` if not.

---

## 9. Rollback considerations

- **Revert is a pure deletion:** remove `src/llm-runner.js`, the one
  `core/core.js` export line, the `test/llm-runner.spec.js` file, and the
  `bootstrap.js` additions (STRINGS keys, button + rec field, `updateLLMButton`,
  `runLLM`, `renderInto` hook lines). No data migrations, no pref changes, no
  on-disk format changes — the feature only *reads* notes and *writes* the same
  markdown format with LLM blocks replaced by static markdown.
- **No destructive writes:** `safeWrite` is atomic (temp + rename); a failed run
  never writes (all-or-nothing). A crash mid-run leaves the original note intact.
- **Feature is opt-in:** the button is disabled unless base URL + model are
  configured; nothing runs automatically (auto-run is out of scope). Users
  without LLM blocks are unaffected (the button just shows `status.llmRunNoBlocks`).
- **Build/CI:** `npm test` → `npm run build` → `npm run test:zotero` order
  (per `.github/workflows/ci.yml`). Slice 1 touches `src/` + `test/` (vitest);
  Slice 2 touches `addon/` (build + integration). If the build config or shared
  contracts were touched, escalate to the broader verification — this plan does
  **not** touch `zotero-plugin.config.ts` or shared contracts.

---

## 10. Acceptance criteria (all must be met)

1. **Run LLM toolbar button, active only when base URL + model configured.**
   — `runLLMBtn.disabled = !this.llmConfigured()` in `buildEditorUI`;
   `updateLLMButton(rec)` refreshes on `renderInto`; `runLLM` re-checks
   `isLLMConfigured` and shows `err.llmNotConfigured` otherwise.
2. **Finds all unresolved LLM blocks, processes sequentially in document order.**
   — `prepareLLMRun` uses `parseLLMBlocks`; `runLLM` iterates `prepared.tasks`
   in order with `status.llmRunning {i}/{n}`.
3. **`context="abstract"` uses Zotero abstract, fails clearly when blank.**
   — `prepareTask` reads `itemData.abstractNote`; blank → `CONTEXT_MISSING` →
   `err.llmRunBlock` status.
4. **Prompt bodies render with existing Nunjucks env + current item data.**
   — `prepareTask` calls `render(block.body, itemData)` (same env as
   `renderDocument`); filters/loops/conditionals work.
5. **Provider request: built-in grounded system prompt + one user message with
   labeled Task + Context sections.** — `buildLLMMessages(GROUNDING_SYSTEM_PROMPT,
   rendered, abstract)`; exact format in §3.2.
6. **Generated output replaces each block as static markdown after trimming +
   line-ending normalization.** — `classifyLLMOutput` → `normalizeLLMOutput`
   (trim + `\r\n?`→`\n`); `applyLLMOutputs` splices block line ranges.
7. **Multi-block all-or-nothing: any block fails → note unchanged.** —
   `prepareLLMRun` aborts on pre-flight failure (`tasks:[]`); `runLLM` breaks the
   HTTP loop on first failure and never calls `safeWrite`/`applyLLMOutputs`.
8. **Empty provider responses = failures.** — `classifyLLMOutput` returns
   `EMPTY_RESPONSE`; `runLLM` aborts (note unchanged).
9. **Run LLM flushes pending edits, detects external disk changes, aborts on
   conflict (same as Refresh).** — `runLLM` mirrors `refreshNote`: conflict check
   → `flush` → read → … → `safeWrite` → `noteMtime` → `hideConflict` →
   `mountEditor` → `setStatus`.
10. **Status text: "Running LLM 1/3…", completion, no-blocks states.** —
    `status.llmRunning {i}/{n}`, `status.llmRunDone {count}`,
    `status.llmRunNoBlocks`.
11. **Error UI: concise pane status + details for longer failures, without
    exposing prompt/context text.** — one-line `STRINGS`-built status; static
    runner messages; `sanitizeError` for HTTP; raw diagnostics via `this.log`
    only.
12. **Focused tests: abstract success, missing abstract failure, prompt
    rendering, all-or-nothing replacement, empty response failure, no-block
    status, provider message assembly.** — `test/llm-runner.spec.js` (§6) covers
    each; `npx vitest run test/llm-runner.spec.js` is the gate.
