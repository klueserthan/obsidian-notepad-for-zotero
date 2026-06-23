# Plan: Wire `autoRun` into Create note & Insert template flows (issue #7)

> Connect the existing default-off "run-on-create/insert" (`autoRun`) preference
> to the existing Create-note and Insert-template paths so that, when enabled and
> the provider is configured, LLM blocks are executed at creation/insert time
> using the **same interpreter behavior** as the manual **Run LLM** toolbar
> button — with **all-or-nothing** semantics (no partial output on failure).
> When disabled (the default), blocks are preserved as placeholders and a
> "blocks preserved" status is surfaced (the `status.llmBlocksPreserved` string
> already exists but is currently unused).

---

## 1. Context & goals

### Issue #7 acceptance criteria (verbatim)
- [ ] When run-on-create/insert is disabled, Create and Insert preserve unresolved LLM blocks after validating syntax and placement.
- [ ] When run-on-create/insert is enabled and the provider is configured, Create and Insert execute LLM blocks using the same interpreter behavior as Run LLM.
- [ ] Create and Insert with auto-run enabled abort without writing or inserting partial output if any LLM block fails.
- [ ] Create and Insert with auto-run enabled render prompt bodies from current Zotero item data at execution time.
- [ ] Create and Insert with auto-run enabled use the same missing-context, empty-response, output-trimming, and metadata-only logging rules as Run LLM.
- [ ] Auto-run remains unavailable or auto-disabled when base URL or model is missing.
- [ ] Focused tests cover disabled preservation, enabled execution, abort-on-failure, and configuration gating.

### Out of scope (from triage)
- Changing the default `autoRun` value (stays `false`).
- Running LLM during normal Refresh or annotation auto-sync.
- Adding streaming or cancellation UI.

### What exists today (verified — do not re-explore)

**Pure logic in `src/` (vitest-testable, no DOM/Zotero globals):**
- `src/llm.js` — `LLM_DEFAULTS.autoRun: false`, `isLLMConfigured(settings)` (baseURL + model non-empty), `canAutoRun(settings)` (= isLLMConfigured && autoRun), `sanitizeLLMSettings` (forces `autoRun=false` when not configured), HTTP builders (`buildChatCompletionsURL`, `buildLLMHeaders`, `buildChatCompletionsPayload`), `parseChatCompletionsResponse` (returns `""` for empty/whitespace, trims otherwise), `sanitizeError` (redacts Bearer/api keys, truncates 500 chars), `sanitizeLogMetadata`.
- `src/llm-blocks.js` — `SUPPORTED_CONTEXTS = ["abstract","annotations","fulltext"]`, `hasLLMBlocks(text)` (cheap regex boolean), `parseLLMBlocks(text) → { blocks, errors }`, `validateLLMBlocks(text) → { valid, errors, blocks }`. Block shape: `{ openRaw, closeRaw, contextArg, contexts, body, lineFrom, lineTo }` (0-based inclusive line indices).
- `src/llm-runner.js` — `RUNNABLE_CONTEXTS = ["abstract"]`, `LLM_RUN_ERRORS` (incl. `HTTP_FAILED`, `EMPTY_RESPONSE`, `NO_BLOCKS`, `PARSE_ERRORS`, `CONTEXT_UNSUPPORTED`, `CONTEXT_MISSING`, `RENDER_FAILED`), `buildLLMMessages`, `normalizeLLMOutput` (trims + CRLF→LF), `classifyLLMOutput` (empty → `{ok:false, code:EMPTY_RESPONSE}`), `prepareLLMRun(text, itemData)` (parse → validate → resolve context → render prompt body via `render()` → assemble messages; returns `{ok, tasks}` or `{ok:false, code, errors}`; **all-or-nothing pre-flight**: any block failure → `tasks:[]`), `applyLLMOutputs(text, blocks, outputs)` (last-to-first line splice replacement).
- `src/render.js` (lines 43–65) — `LLMExtension` Nunjucks tag: renders the prompt body (resolving `{{vars}}`), then **reconstructs** `{% llm context="..." %}\n<rendered body>\n{% endllm %}` so blocks survive `renderDocument` as placeholders. Re-rendering an already-rendered body is idempotent (no leftover template vars).
- `core/core.js` — barrel that re-exports every `src/` module into the `ZONCore` IIFE global. `canAutoRun` is already re-exported (line 19) but **not yet called** in bootstrap.

**Glue in `addon/bootstrap.js` (~2976 lines):**
- LLM pref constants (lines 43–50) + `DEFAULT_LLM_AUTORUN: false` (line 80).
- Accessors: `llmBaseURL/Model/ApiKey/Temperature/MaxTokens/MaxContextChars/TimeoutSeconds/AutoRunPref` (708–738), `llmConfigured()` (740), `getLLMSettings()` (743–753), `llmAutoRun()` (755–762 — the runtime gate: returns pref but resets to false + clears pref if not configured).
- `STRINGS` (425–455): **all LLM keys exist**, including `status.llmBlocksPreserved` (line 443 — "LLM blocks preserved (run-on-create disabled) — {count} placeholder(s)") which is **DEFINED BUT NEVER USED**. Also `status.llmRunDone` (447), `err.llmRunFailed` (451), `err.llmRunHttp` (453), `err.llmRunEmpty` (454), `err.llmRunBlock` (452), `err.llmBlocksInvalid` (442). `t(key, args)` (458) interpolates `{name}`.
- `runLLM(rec)` (2680–2799) — **manual Run LLM button handler; the execution pattern to reuse.** Reads on-disk note → builds itemData → `prepareLLMRun` → **inline HTTP loop** (2748–2782: per-block `Zotero.HTTP.request("POST", url, {headers, body: JSON.stringify(payload), responseType:"text", timeout})` → `parseChatCompletionsResponse` → `classifyLLMOutput`; **breaks on first failure, does NOT write**) → `applyLLMOutputs` → `safeWrite` → remount editor. Status/logging via `setStatus(rec, t(...))` + `this.log(sanitizeError(e))` + metadata-only `sanitizeLogMetadata`.
- `renderDocument(win, item, templateText)` (1983–1993) — builds itemData (`ZONCore.buildItemData(item, {citekey, bibliography, importDate})`) → `ZONCore.render` (Nunjucks, LLMExtension preserves blocks) → `gatherAnnotations` + `syncBlocks` → returns markdown **with LLM blocks preserved as placeholders**.
- `renderTemplateAsNote(win, item, name)` (1998–2028) — resolves template → validates LLM syntax (throws on errors) → `renderDocument` → returns markdown with placeholders. **No auto-run step.**
- `writeNoteForItem(win, item, templateName)` (2065–2101) — **rec-free** single creation path shared by `createNote` (single item) and `bulkCreateNotes` (bulk). Builds filename → if file doesn't exist → `renderTemplateAsNote` → `ensureZoteroLink` → `safeWrite` → index. Returns `{ status, path?, error? }` where status ∈ `created|exists|no-citekey|outside|no-item|error`. **No auto-run step.**
- `createNote(rec, templateName)` (2105–2115) — calls `writeNoteForItem`, surfaces status via `rec.bannerText.textContent` (`setMsg`).
- `bulkCreateNotes(win)` (2210–2227) — loops `writeNoteForItem` per selected item, counts statuses, shows summary.
- `insertTemplate(rec, opts)` (2839–2875) — validates template LLM syntax (aborts on errors via `setStatus`) → document template: `renderDocument` → `insertAtCursor`; format template: `makeBlock` → `insertAtCursor`. **No auto-run step.**
- `validateLLMTemplate(win, text)` (2048–2057) — wraps `ZONCore.validateLLMBlocks`, safe fallback.
- `setStatus(rec, text)` (1752) — `rec.statusEl.textContent = text`.
- `safeWrite(path, text)` — atomic (temp → rename); must remain the only write path.

**Preferences — all exist:**
- `addon/content/preferences.xhtml` (lines 100–174) — LLM groupbox with auto-run checkbox `zon-llm-autorun` + hint "Requires base URL and model to be set".
- `addon/content/preferences.js` `wireLLMAutoRunGate()` (191–219) — disables + unchecks the checkbox when baseURL/model empty, clears the pref. **Already enforces acceptance #6 in the UI.**

**Tests — existing (vitest, `test/*.spec.js`):**
- `test/llm.spec.js` (455 lines) — `canAutoRun` (false when not configured / autoRun false; true when configured + autoRun), `sanitizeLLMSettings` (forces autoRun false when not configured), `isLLMConfigured`.
- `test/llm-blocks.spec.js` (562 lines) — parsing/validation.
- `test/llm-runner.spec.js` (540 lines) — `prepareLLMRun` (incl. all-or-nothing pre-flight, context unsupported/missing, render failure, no blocks), `applyLLMOutputs`, `classifyLLMOutput`, `normalizeLLMOutput`, message assembly.
- `test/render.spec.js` (lines 33–72) — LLM blocks preserved through Nunjucks render.
- **No tests exist for auto-run on create/insert.** The create/insert flows live in bootstrap.js (not vitest-testable), so the testable decision/orchestration logic must be extracted to `src/`.
- `vitest.config.js` — includes `test/*.spec.js`, excludes `test/integration/**`. Integration tests (`test/integration/*.spec.js`) run under Mocha in Zotero and are out of scope here.

### What's missing
1. A shared, pure, fetch-injected orchestration function for the HTTP execution loop (currently inline in `runLLM` only).
2. Auto-run wired into `writeNoteForItem` (Create) and `insertTemplate` (Insert).
3. `status.llmBlocksPreserved` actually used in the disabled path.
4. Focused vitest tests for the new pure logic (disabled preservation, enabled execution, abort-on-failure, config gating).

---

## 2. Architecture / approach decision

### Recommendation: extract TWO pure functions into `src/llm-runner.js`

**(A) `decideLLMAction(md, settings) → { action, count }`** — pure decision:
- `"none"` — no LLM blocks in the rendered markdown.
- `"preserve"` — blocks present but `canAutoRun(settings)` is false (auto-run off OR not configured).
- `"run"` — blocks present and `canAutoRun(settings)` is true.

**(B) `executeLLMBlocks(text, itemData, settings, fetchFn, onProgress?) → { ok, md, blocks } | { ok:false, code, ... }`** — pure orchestration of the HTTP execution loop:
- Calls `prepareLLMRun(text, itemData)` → on pre-flight failure returns `{ok:false, code, errors?, blocks?}` (NO_BLOCKS / PARSE_ERRORS / CONTEXT_UNSUPPORTED / CONTEXT_MISSING / RENDER_FAILED).
- For each task: calls injected `fetchFn(url, headers, payload, timeoutSeconds) → Promise<responseText>` → `parseChatCompletionsResponse` → `classifyLLMOutput`. On HTTP throw → `{ok:false, code:HTTP_FAILED, error, blockIndex, n}`. On empty → `{ok:false, code:EMPTY_RESPONSE, blockIndex, n}`. **Breaks on first failure — no partial `md` returned.**
- On full success → `applyLLMOutputs(text, blocks, outputs)` → `{ok:true, md, blocks}`.
- Optional `onProgress(i, n)` callback (numbers only — metadata).

Both are re-exported via `core/core.js` → `ZONCore.decideLLMAction` / `ZONCore.executeLLMBlocks`.

### Rationale (vs. alternatives)

| Approach | Verdict |
|---|---|
| **Extract `executeLLMBlocks` + `decideLLMAction` to `src/` (recommended)** | Eliminates duplication (3 callers share one loop → guaranteed parity with manual Run LLM, satisfying criteria #2 & #5). Pure + fetch-injected → vitest-testable (satisfies #7). Keeps `src/` pure per repo conventions. |
| Duplicate the HTTP loop inline in create/insert | Rejected — DRY violation, drift risk, untestable glue, breaks parity guarantee. |
| Extract to a bootstrap method, not `src/` | Rejected — bootstrap methods can't run under vitest; the loop is pure logic (no DOM/Zotero) so it belongs in `src/`. |
| Keep HTTP loop in bootstrap, extract only prepare/apply | Rejected — abort-on-failure (#3) is the core behavior to test; if the loop stays in bootstrap it's untestable. |

### Why no logging callback (metadata-only rule)

`executeLLMBlocks` does **no logging** and returns only structured results (`code`, raw `error` object, `blockIndex`, `n`). It **never** returns prompt bodies or response content. The caller (bootstrap) performs all logging via existing `this.log()` + `sanitizeLogMetadata(settings)` + `sanitizeError(e)`. This keeps `src/` truly pure (no side effects) while the metadata-only rule is enforced by (a) the function never exposing bodies/content in its return value, and (b) the caller using the existing sanitizers. `onProgress` carries only `(i, n)` integers — metadata, never content. This satisfies criterion #5.

### Abort-on-failure semantics (design decision — see §6 Risks)

**Recommended: graceful fallback to preserved output + error status.**
- On auto-run failure (any block), the auto-run **aborts** — no resolved output is written/inserted. The note/template is written/inserted with **placeholders intact** (the disabled-path output) and an **error is surfaced**.
- This satisfies "abort without writing or inserting **partial** output" (criterion #3): the fallback has **zero** blocks resolved (all placeholders), which is not partial. All-or-nothing is preserved.
- Better UX than hard-abort: the user always gets their note/template; a failed auto-run degrades to the disabled behavior, and the placeholders can be resolved later via the manual **Run LLM** button.
- Consistent: both Create and Insert behave the same (resolved on success → placeholders + error on failure).

**Alternative (stricter literal reading): hard-abort — write/insert nothing on failure.** This matches the manual `runLLM` (note unchanged on failure) most literally but is harsh for Create (user clicks "Create note", gets nothing). Flagged in §6 for orchestrator confirmation; the graceful fallback is the default recommendation.

### `fetchFn` abstraction

Defined once as a bootstrap helper `llmFetchFn()` returning a bound async function:
```js
llmFetchFn() {
  return async (url, headers, payload, timeoutSeconds) => {
    const resp = await Zotero.HTTP.request("POST", url, {
      headers, body: JSON.stringify(payload), responseType: "text",
      timeout: timeoutSeconds * 1000,
    });
    return resp.responseText;
  };
}
```
All three callers (`runLLM`, `writeNoteForItem`, `insertTemplate`) pass `this.llmFetchFn()`. Vitest passes a mock `fetchFn`.

### itemData for the auto-run step

`executeLLMBlocks` needs `itemData` (for `prepareLLMRun` to resolve context + re-render prompt bodies). `renderDocument` builds itemData internally but doesn't return it. **Build itemData lazily in the auto-run step** (only when `decideLLMAction === "run"`), mirroring `runLLM` lines 2719–2723:
```js
let citekey = this.getCitekey(item);
let bibliography = await this.getBibliography(item);
let data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString() });
```
Re-rendering the already-rendered prompt body is idempotent (matches the manual `runLLM` pattern, which reads rendered blocks off disk and re-renders). **Optional polish:** extract a `buildItemDataForItem(win, item)` helper to DRY the 3 call sites (`renderDocument`, `runLLM`, auto-run) — low-risk, not required for correctness.

---

## 3. Implementation slices (ordered)

### Slice 1 — Pure logic: `decideLLMAction` + `executeLLMBlocks` in `src/llm-runner.js`

**Files:**
- `src/llm-runner.js` — add `import { sanitizeLLMSettings, buildChatCompletionsURL, buildLLMHeaders, buildChatCompletionsPayload, parseChatCompletionsResponse, canAutoRun } from "./llm.js";` (no circular dep: `llm.js` does not import `llm-runner.js`). Add the two functions.
- `core/core.js` — add `decideLLMAction, executeLLMBlocks` to the `llm-runner.js` re-export line (line 21).

**Scope:**
- `decideLLMAction(md, settings)`:
  ```js
  export function decideLLMAction(md, settings) {
    const { blocks } = parseLLMBlocks(String(md || ""));
    if (blocks.length === 0) return { action: "none", count: 0 };
    if (canAutoRun(settings)) return { action: "run", count: blocks.length };
    return { action: "preserve", count: blocks.length };
  }
  ```
- `executeLLMBlocks(text, itemData, settings, fetchFn, onProgress)`:
  - `prepared = prepareLLMRun(text, itemData)`; if `!prepared.ok` return `{ok:false, code: prepared.code, errors: prepared.errors, blocks: prepared.blocks}`.
  - `s = sanitizeLLMSettings(settings)`; `url = buildChatCompletionsURL(s.baseURL)`; `headers = buildLLMHeaders(s)`.
  - Loop `prepared.tasks`: `onProgress(i+1, n)` (try/catch guarded); `payload = buildChatCompletionsPayload(s, task.messages)`; `try { content = parseChatCompletionsResponse(await fetchFn(url, headers, payload, s.timeoutSeconds)) } catch(e) { return {ok:false, code:HTTP_FAILED, error:e, blockIndex:i, n} }`; `res = classifyLLMOutput(content)`; if `!res.ok` return `{ok:false, code:EMPTY_RESPONSE, blockIndex:i, n}`; else `outputs.push(res.output)`.
  - After loop: `md = applyLLMOutputs(text, prepared.blocks, outputs)`; return `{ok:true, md, blocks: prepared.blocks}`.

**Acceptance checks:**
- `npm test` — new `test/llm-runner.spec.js` cases pass (see §4).
- `executeLLMBlocks` is pure: no `Zotero.*`, no `IOUtils`, no DOM, no `fetch`/`XMLHttpRequest` (only the injected `fetchFn`).
- No regressions in existing `test/llm*.spec.js`, `test/render.spec.js`.

### Slice 2 — Refactor manual `runLLM()` to use `executeLLMBlocks` (parity + dedup)

**Files:** `addon/bootstrap.js`

**Scope:**
- Add `llmFetchFn()` helper method (snippet in §2).
- In `runLLM(rec)` (2680–2799), replace the inline HTTP loop (2748–2785) with:
  ```js
  let result = await C.executeLLMBlocks(existing, data, settings, this.llmFetchFn(),
    (i, n) => this.setStatus(rec, this.t("status.llmRunning", { i, n })));
  if (!result.ok) {
    // Map result.code → existing status strings + logging (preserve exact behavior):
    if (result.code === C.LLM_RUN_ERRORS.NO_BLOCKS) { this.setStatus(rec, this.t("status.llmRunNoBlocks")); return; }
    if (result.code === C.LLM_RUN_ERRORS.PARSE_ERRORS) { /* err.llmBlocksInvalid + first error, as today */ return; }
    if (result.code === C.LLM_RUN_ERRORS.HTTP_FAILED) {
      let status = (result.error && typeof result.error.status === "number") ? result.error.status : null;
      let errStr = status ? ("HTTP " + status) : "network error";
      this.log("llm run http failed (block " + (result.blockIndex + 1) + "/" + result.n + ")"
        + (status ? " (HTTP " + status + ")" : "") + ": " + (result.error && result.error.message ? result.error.message : result.error));
      this.setStatus(rec, this.t("err.llmRunFailed", { error: this.t("err.llmRunHttp", { i: result.blockIndex + 1, n: result.n, error: errStr }) }));
      return;
    }
    if (result.code === C.LLM_RUN_ERRORS.EMPTY_RESPONSE) {
      this.log("llm run empty response (block " + (result.blockIndex + 1) + "/" + result.n + ")");
      this.setStatus(rec, this.t("err.llmRunFailed", { error: this.t("err.llmRunEmpty", { i: result.blockIndex + 1, n: result.n }) }));
      return;
    }
    // CONTEXT_UNSUPPORTED / CONTEXT_MISSING / RENDER_FAILED (pre-flight, from prepareLLMRun)
    let first = result.errors[0];
    this.setStatus(rec, this.t("err.llmRunBlock", { line: first.line != null ? (first.line + 1) : "?", message: first.message }));
    if (first.detail) this.log("llm run pre-flight: " + first.detail);
    return;
  }
  let updated = result.md;
  // safeWrite + remount + status.llmRunDone (unchanged, 2786–2795)
  ```
- Keep the pre-loop guards (configured check, external-conflict, flush, read, buildItemData) unchanged — they stay in `runLLM` because they're note-pane-specific (the manual button operates on an existing on-disk note).

**Acceptance checks:**
- Manual Run LLM behaves identically: same status messages at each phase, same all-or-nothing (no write on failure), same metadata-only logging.
- `npm test` — no regressions.
- `npm run build` succeeds.

### Slice 3 — Wire auto-run into Create (`writeNoteForItem`)

**Files:** `addon/bootstrap.js`

**Scope:**
- In `writeNoteForItem` (2065–2101), after `renderTemplateAsNote` + `ensureZoteroLink` (line 2087), before `safeWrite` (2089), insert the auto-run decision + execution:
  ```js
  let llm = { state: "none", count: 0 };
  let decision = C.decideLLMAction(md, this.getLLMSettings());
  if (decision.action === "run") {
    let citekey2 = this.getCitekey(item);
    let bibliography2 = await this.getBibliography(item);
    let data2 = C.buildItemData(item, { citekey: citekey2, bibliography: bibliography2, importDate: new Date().toISOString() });
    let result = await C.executeLLMBlocks(md, data2, this.getLLMSettings(), this.llmFetchFn());
    if (result.ok) { md = result.md; llm = { state: "ran", count: decision.count }; }
    else if (result.code === C.LLM_RUN_ERRORS.NO_BLOCKS) { llm = { state: "none", count: 0 }; }
    else {
      // Graceful fallback: keep md (placeholders preserved), surface error.
      llm = { state: "failed", count: decision.count, code: result.code, error: this.describeLLMFailure(result) };
      this.log("auto-run (create) failed: " + llm.error + " — note written with placeholders");
    }
  } else if (decision.action === "preserve") {
    llm = { state: "preserved", count: decision.count };
  }
  await this.safeWrite(path, md);
  // ... index ...
  return { status: "created", path, llm };
  ```
- Add a small helper `describeLLMFailure(result)` → string (maps `result.code` to a human message using existing `err.llmRun*` strings; never includes prompt/response bodies). Reused by Create + Insert.
- In `createNote` (2105–2115), surface `r.llm` via `setMsg`:
  - `state === "preserved"` && count > 0 → `setMsg(this.t("status.llmBlocksPreserved", { count: r.llm.count }))`.
  - `state === "ran"` → `setMsg(this.t("status.llmRunDone", { count: r.llm.count }))`.
  - `state === "failed"` → `setMsg(this.t("err.llmRunFailed", { error: r.llm.error }) + " — " + this.t("status.llmBlocksPreserved", { count: r.llm.count }))`.
  - `state === "none"` → no extra message (just the existing "created" handling).
- In `bulkCreateNotes` (2210–2227): log per-item `r.llm.state` via `this.log(...)`; do **not** change the summary string (avoid new STRINGS for bulk). The bulk path uses `templateName = null` (default scaffold) — auto-run applies identically.

**Acceptance checks:**
- Disabled (autoRun false) + blocks present → note created with placeholders, banner shows `status.llmBlocksPreserved`. (criterion #1)
- Enabled + configured + success → note created with resolved blocks, banner shows `status.llmRunDone`. (#2)
- Enabled + failure (e.g. empty response) → note created with placeholders, banner shows error + preserved. (#3 — no partial output)
- Not configured + autoRun true (edge) → `canAutoRun` false → preserved path. (#6)
- `safeWrite` still atomic; only one write; failed auto-run never writes resolved output. (#3)
- `npm test`, `npm run build` pass.

### Slice 4 — Wire auto-run into Insert (`insertTemplate`)

**Files:** `addon/bootstrap.js`

**Scope:**
- In `insertTemplate` (2839–2875), the **document-template branch** (line 2860–2861: `text = item ? await this.renderDocument(win, item, t.text) : (t.text || "")`) is where LLM blocks survive. After that assignment, before `insertAtCursor` (2873), insert:
  ```js
  if (item) {
    let decision = C.decideLLMAction(text, this.getLLMSettings());
    if (decision.action === "run") {
      let citekey = this.getCitekey(item);
      let bibliography = await this.getBibliography(item);
      let data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString() });
      let result = await C.executeLLMBlocks(text, data, this.getLLMSettings(), this.llmFetchFn());
      if (result.ok) { text = result.md; this.setStatus(rec, this.t("status.llmRunDone", { count: decision.count })); }
      else if (result.code === C.LLM_RUN_ERRORS.NO_BLOCKS) { /* no-op */ }
      else { this.setStatus(rec, this.t("err.llmRunFailed", { error: this.describeLLMFailure(result) })); }
    } else if (decision.action === "preserve") {
      this.setStatus(rec, this.t("status.llmBlocksPreserved", { count: decision.count }));
    }
  }
  ```
- The **format-template branch** (2862–2871, `makeBlock`) produces annotation blocks; LLM blocks do not survive into that output, so auto-run does not apply there. No change needed (the existing validation still guards syntax).
- `insertAtCursor(rec.view, "\n" + String(text).trim() + "\n")` runs after, with either resolved or preserved `text`.

**Acceptance checks:**
- Disabled + blocks → template inserted with placeholders, status `llmBlocksPreserved`. (#1)
- Enabled + success → inserted with resolved blocks, status `llmRunDone`. (#2)
- Enabled + failure → inserted with placeholders, status error. (#3 — no partial)
- Not configured → preserved. (#6)
- Existing note untouched on failure (only the preserved template is inserted, same as disabled behavior).

### Slice 5 — Finalize: string usage, full verification

**Files:** none (verification only), unless `describeLLMFailure` needs a new STRINGS key (it should reuse existing `err.llmRun*` keys — no new strings).

**Scope:**
- Confirm `status.llmBlocksPreserved` is now used in both Create (banner) and Insert (status) disabled paths.
- Confirm no inline user-visible strings were added (all via `STRINGS` + `t()`).
- Confirm `DEFAULT_LLM_AUTORUN` remains `false`; `LLM_DEFAULTS.autoRun` remains `false`; `sanitizeLLMSettings` still forces `autoRun=false` when not configured.
- Run full verification (see §5).

**Acceptance checks:** all 7 criteria checkboxes satisfiable; `npm test` + `npm run build` green; no regressions.

---

## 4. Test plan

All new tests are **vitest** (`test/*.spec.js`, import from `../src`), covering the pure logic. Bootstrap wiring is verified by build + manual/integration (out of vitest scope).

### `test/llm-runner.spec.js` — add `decideLLMAction` + `executeLLMBlocks` blocks

**`decideLLMAction` (covers criteria #1 disabled-preservation, #6 config-gating):**
| Test case | Expectation |
|---|---|
| plain text, no LLM tags | `{ action: "none", count: 0 }` |
| one `{% llm context="abstract" %}...{% endllm %}` block, `autoRun:false`, configured | `{ action: "preserve", count: 1 }` |
| two blocks, `autoRun:false`, configured | `{ action: "preserve", count: 2 }` |
| block + `autoRun:true` + configured (baseURL+model) | `{ action: "run", count: 1 }` |
| block + `autoRun:true` + **not** configured (empty baseURL) | `{ action: "preserve", count: 1 }` (canAutoRun false) |
| block + `autoRun:true` + empty model | `{ action: "preserve" }` |
| block + `autoRun:false` + not configured | `{ action: "preserve" }` |

**`executeLLMBlocks` with mock `fetchFn` (covers #2 enabled-execution, #3 abort-on-failure, #4 item-data render, #5 rules):**
| Test case | Expectation |
|---|---|
| 1 block, fetch returns `"Summary."` | `{ ok:true, md }` with block replaced by `Summary.` (trimmed) |
| 2 blocks, both succeed | `{ ok:true, md }` with **both** replaced |
| 2 blocks, 2nd `fetchFn` throws → abort | `{ ok:false, code:HTTP_FAILED, blockIndex:1, n:2 }`; **no `md` field** (no partial output) |
| 2 blocks, 1st succeeds, 2nd returns empty → abort | `{ ok:false, code:EMPTY_RESPONSE, blockIndex:1, n:2 }`; no `md` |
| 1 block, fetch returns `"   "` (whitespace) | `{ ok:false, code:EMPTY_RESPONSE }` (classifyLLMOutput) |
| 1 block, fetch returns `"  spaced  "` | md contains `spaced` (normalizeLLMOutput trims) — #5 output-trimming |
| context unsupported (`annotations`) | `{ ok:false, code:CONTEXT_UNSUPPORTED }` (pre-flight) |
| abstract empty (`itemData.abstractNote = ""`) | `{ ok:false, code:CONTEXT_MISSING }` — #5 missing-context |
| no LLM tags | `{ ok:false, code:NO_BLOCKS }` |
| `onProgress` callback | called with `(1, 1)` then `(2, 2)` for 2 blocks |
| `fetchFn` receives correct args | url ends `/chat/completions`; headers include `Content-Type`; payload has `model`, `messages`, `stream:false` |
| prompt body rendered from itemData | block body `Summarise {{title}}.` + itemData `{title:"X"}` → user message contains `Summarise X.` — #4 |
| HTTP error object has no prompt/response body | returned `error` is the raw thrown object; `code`/`blockIndex`/`n` are metadata only — #5 metadata-only |

**Mock `fetchFn` pattern:**
```js
const makeFetch = (responses) => {
  let i = 0;
  return async (url, headers, payload, timeout) => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return typeof r === "string" ? r : JSON.stringify({ choices: [{ message: { content: r } }] });
  };
};
```

### Existing tests — regression guard
- `test/llm.spec.js` — `canAutoRun`, `sanitizeLLMSettings` (unchanged, must still pass).
- `test/llm-blocks.spec.js` — parsing/validation (unchanged).
- `test/llm-runner.spec.js` existing `prepareLLMRun`/`applyLLMOutputs` cases (unchanged — `executeLLMBlocks` is additive).
- `test/render.spec.js` — LLM block preservation (unchanged).
- `test/templates.spec.js` (unchanged).

### Acceptance-criterion → test mapping
| Criterion | Covered by |
|---|---|
| #1 disabled preservation | `decideLLMAction` preserve cases + existing `render.spec.js` preservation + bootstrap wiring (build) |
| #2 enabled execution | `executeLLMBlocks` success cases |
| #3 abort-on-failure (no partial) | `executeLLMBlocks` HTTP-failure + empty-response abort cases (assert no `md` field) |
| #4 render prompt bodies from item data | `executeLLMBlocks` "prompt body rendered" case |
| #5 missing-context/empty/trim/metadata-only | `executeLLMBlocks` CONTEXT_MISSING + EMPTY_RESPONSE + trim + metadata cases |
| #6 config gating | `decideLLMAction` not-configured cases + existing `canAutoRun`/`sanitizeLLMSettings` tests + `wireLLMAutoRunGate` (existing) |
| #7 focused tests | this entire test plan |

---

## 5. Verification playbook

```bash
# 1. Pure-logic tests (fast, no Zotero)
npm test
# Focus: npx vitest run test/llm-runner.spec.js test/llm.spec.js test/render.spec.js

# 2. Build the .xpi (catches core.js re-export + bundle issues)
npm run build
# Confirm .scaffold/build/*.xpi exists and no errors about missing exports.

# 3. (If .env configured) integration smoke — optional, not required for DoD
npm run test:zotero
```

**DoD gates:**
- `npm test` green, including new `decideLLMAction` + `executeLLMBlocks` cases.
- `npm run build` green.
- No regressions in `test/llm*.spec.js`, `test/render.spec.js`, `test/templates.spec.js`.
- `status.llmBlocksPreserved` referenced in `addon/bootstrap.js` (grep confirms usage).
- `DEFAULT_LLM_AUTORUN`/`LLM_DEFAULTS.autoRun` still `false` (grep confirms unchanged).
- `core/core.js` re-exports `decideLLMAction` + `executeLLMBlocks`.

---

## 6. Risks & rollback

### Design decision needing confirmation
- **Abort semantics (graceful fallback vs. hard-abort).** The plan defaults to **graceful fallback** (write/insert preserved placeholders + error on auto-run failure). The stricter literal reading of criterion #3 ("abort without writing") = write/insert nothing. The graceful fallback satisfies "no **partial** output" (all placeholders = zero resolved = not partial) and is better UX. **If the orchestrator prefers hard-abort**, Slice 3/4 change to: on `!result.ok` (and not NO_BLOCKS), return `{status:"error", error}` (Create) / `return` before `insertAtCursor` (Insert), and skip the write/insert entirely. The pure functions (`decideLLMAction`, `executeLLMBlocks`) are unaffected — only the bootstrap fallback branch changes.

### Risks
- **Re-rendering already-rendered prompt bodies.** `prepareLLMRun` calls `render(block.body, itemData)` on a body already rendered by `LLMExtension`. This is idempotent (no leftover `{{vars}}`) and matches the manual `runLLM` (which reads rendered blocks off disk). Pre-existing edge case: a prompt body containing literal `{{...}}` or `{%...%}` would be mangled by the re-render — but this is **existing behavior** of the manual button, not a new regression. No action required for parity.
- **`buildItemData` called twice in the auto-run path** (once in `renderDocument`, once in the auto-run step). Wasteful but harmless (only when `action === "run"`); `importDate` differs by ms but isn't used in prompts. The optional `buildItemDataForItem` helper (§2) eliminates this if desired.
- **Bulk create + auto-run latency.** `bulkCreateNotes` loops items; with auto-run on, each item triggers HTTP calls → slow bulk creation. Mitigation: auto-run is default-off; users who enable it accept the cost. No concurrency change (keep sequential to match manual button). Log per-item state.
- **`Zotero.HTTP` availability in create/insert context.** `runLLM` already uses `Zotero.HTTP.request` from the note pane; `writeNoteForItem`/`insertTemplate` run in the same main-window context, so `Zotero.HTTP` is available. Low risk.
- **`writeNoteForItem` is rec-free** — it can't call `setStatus`. Solved by returning `llm` in the result object and letting `createNote`/`bulkCreateNotes` surface it. Verified both callers handle the return object.
- **New `core/core.js` exports missing from bundle.** If the re-export line isn't updated, `C.executeLLMBlocks` is `undefined` and the auto-run no-ops silently. Mitigation: the `runLLM` guard pattern (`if (!C.prepareLLMRun || !C.applyLLMOutputs)`) should be extended to check `C.executeLLMBlocks`/`C.decideLLMAction` and fall back to preserved (no crash). `npm run build` catches missing exports.

### Rollback
- The change is additive in `src/` (two new exported functions; existing exports unchanged) and localized in bootstrap (3 call sites + 2 small helpers). Reverting the bootstrap edits restores prior behavior (Create/Insert preserve placeholders, manual Run LLM uses inline loop). The `src/` additions can stay (harmless if unused) or be removed with the `core/core.js` re-export line.
- Each slice is independently revertible. Slice 1 (pure functions) has no runtime effect until Slice 3/4 wire it in. Slice 2 (runLLM refactor) is behavior-preserving.
- No data migrations, no pref changes, no file-format changes — fully reversible with no user-visible state impact.

---

## 7. Open questions for the orchestrator

1. **Abort semantics**: graceful fallback (recommended — placeholders + error on failure) vs. hard-abort (write/insert nothing on failure)? See §6.
2. **`buildItemDataForItem` helper**: extract to DRY the 3 call sites (optional polish), or keep the lazy inline build in the auto-run step (minimal diff)?
3. **Bulk-create summary**: should `bulkCreateNotes` mention auto-run counts in the summary string (would need a new STRINGS key), or keep per-item logging only (recommended — no new strings)?
