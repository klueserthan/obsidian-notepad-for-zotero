# Plan — Issue #6: Add primary-PDF full-text LLM context (`context="fulltext"`)

Status: draft · Owner: plan-runner · Repo: `obsidian-notepad-for-zotero` (Zotero 7 plugin, AGPL-3.0)

---

## Summary

GitHub issue #6 asks for `context="fulltext"` support in the runnable LLM
interpreter. Today the block **parser** already accepts `fulltext`
(`SUPPORTED_CONTEXTS` in `src/llm-blocks.js:7`), but the **run planner**
(`src/llm-runner.js`) only resolves `abstract` and `annotations`, and rejects
`fulltext` with `CONTEXT_UNSUPPORTED`. The `maxContextChars` setting is read
and sanitized but never enforced anywhere.

Goal: make `context="fulltext"` a first-class, all-or-nothing runnable context
that feeds the **primary PDF's already-extracted/indexed text** (Zotero's
`.zotero-ft-cache`) into the LLM prompt with a lightweight metadata header
(title, citekey, attachment title). The plugin must **never** perform its own
PDF extraction/OCR, **never** fall back to abstract/annotations when full text
is missing, and **never** log the full-text body. The configured
`maxContextChars` limit must be enforced as a hard pre-flight failure against
the resolved context text.

Pure logic lives in `src/` (ES modules, no DOM/Zotero globals) and is
unit-tested with Vitest (`test/*.spec.js`). Zotero calls live in
`addon/bootstrap.js` (build-only verification; integration tests need a Zotero
env and have no LLM execution coverage today).

---

## Context & goals

### Verified facts (read from source, not assumed)

- `src/llm-blocks.js:7` — `SUPPORTED_CONTEXTS = ["abstract","annotations","fulltext"]`.
  Parsing of `context="fulltext"` **already works**; `parseLLMBlocks` returns
  such blocks with `contexts: ["fulltext"]`. No parser change needed.
- `src/llm-runner.js:18` — `RUNNABLE_CONTEXTS = ["abstract","annotations"]` (the
  runnable gate). `fulltext` is rejected at line 65 (`block.contexts.length !== 1
  || !RUNNABLE_CONTEXTS.includes(...)`) → `CONTEXT_UNSUPPORTED`.
- `src/llm-runner.js:50` — `prepareLLMRun(text, itemData)` (2 args). Iterates
  blocks in document order; `abstract` resolver at lines 84-99 reads
  `itemData?.abstractNote` (empty → `CONTEXT_MISSING`); `annotations` resolver
  at lines 100-114 reads `itemData?.annotations || []` via
  `renderAnnotationsContext` (empty → `CONTEXT_MISSING`). All-or-nothing: first
  failure → `{ok:false, tasks:[]}`. `buildLLMMessages(system, task, context)`
  (line 30) assembles `Task:\n…\n\nContext:\n…`.
- `src/llm-runner.js:20-28` — `LLM_RUN_ERRORS` has 7 codes: `NO_BLOCKS,
  PARSE_ERRORS, CONTEXT_UNSUPPORTED, CONTEXT_MISSING, RENDER_FAILED,
  EMPTY_RESPONSE, HTTP_FAILED`. **No size-limit code.**
- `src/llm.js:31` — `LLM_DEFAULTS.maxContextChars = 100000`; `sanitizeLLMSettings`
  (line 54) clamps it to `≥1`; `sanitizeLogMetadata` (line 138) includes it. It
  is **read and stored but never enforced/truncated** anywhere.
- `src/item-data.js:66-87` — `buildItemData(item, opts)` returns `citekey:
  opts.citekey || ""`, `title: f("title")`, `abstractNote`, `annotations:
  opts.annotations || []`, etc. **No `fulltext` field.** `citekey` and `title`
  are present → available for the metadata header.
- `src/annotations.js:96` — `renderAnnotationsContext(annotations)` is the
  pattern to mirror: pure, returns `""` when nothing usable (caller treats as
  `CONTEXT_MISSING`).
- `core/core.js:21` — re-exports all of `llm-runner.js`; line 8 re-exports from
  `annotations.js`. Adding exports to a `src/*` module + a re-export line in
  `core/core.js` auto-propagates to the `ZONCore` IIFE global.
- `addon/bootstrap.js:2680` — `async runLLM(rec)`: reads note (line 2711,
  `IOUtils.readUTF8`), gathers annotations (line 2721, `gatherAnnotations`),
  builds `data = C.buildItemData(item, { citekey, bibliography, importDate,
  annotations })` (line 2728), calls `C.prepareLLMRun(existing, data)` (line
  2733), executes HTTP per task all-or-nothing (lines 2760-2788), then
  `C.applyLLMOutputs` + `safeWrite` (lines 2791-2792). Pre-flight failures
  surface at lines 2734-2752: `NO_BLOCKS`/`PARSE_ERRORS` have dedicated
  branches; **all other codes** (`CONTEXT_UNSUPPORTED`/`CONTEXT_MISSING`/
  `RENDER_FAILED`) flow through the generic `this.t("err.llmRunBlock",
  {line, message})` handler (line 2748) using `first.message` from the pure
  layer. `first.detail` is logged (line 2750) only for `RENDER_FAILED`.
- `addon/bootstrap.js:2315` — `gatherAnnotations(item, win)`: iterates
  `item.getAttachments()` + `Zotero.Items.get(id)` + `att.isPDFAttachment()` +
  `att.getAnnotations()`. **No primary-PDF selection; no fulltext access.**
- `addon/bootstrap.js:2388` — `hasPdfAttachment(item)`: any-PDF boolean.
- `addon/bootstrap.js:743` — `getLLMSettings()` returns `{ ..., maxContextChars:
  this.llmMaxContextChars() }` (line 750). `llmMaxContextChars()` (line 728)
  reads pref `PREF_LLM_MAX_CONTEXT` (line 48), default `DEFAULT_LLM_MAX_CONTEXT
  = 100000` (line 78).
- `addon/bootstrap.js:348` — `log(msg) { Zotero.debug("ZON: " + msg) }`. Current
  `runLLM` log calls log only exceptions/statuses, never context bodies.
- `addon/bootstrap.js:354-455` — `STRINGS` + `this.t(key, {args})` (line 458).
  Relevant keys: `btn.runLLM` (444), `status.llmRunning` (446),
  `status.llmRunDone` (447), `err.llmRunBlock` (452), `err.llmRunFailed` (451).
- `IOUtils.readUTF8` / `IOUtils.exists` are already used in bootstrap (lines
  2711, 2366) → safe to rely on in Zotero 7.
- `test/llm-runner.spec.js`:
  - Line 39-41 — asserts `RUNNABLE_CONTEXTS` equals `["abstract","annotations"]`
    (**must update**).
  - Lines 357-388 — "context unsupported" describe block; lines 358-363 and
    373-378 assert `fulltext` is `CONTEXT_UNSUPPORTED` (**must replace** with
    supported tests). Lines 365-371 and 380-387 assert **multi-context**
    (`abstract,annotations`) is unsupported — **keep** (still unsupported).
  - Lines 461-513 — all-or-nothing tests use `fulltext` as the failing 2nd
    block (lines 471, 505). Now that `fulltext` is runnable, those blocks would
    no longer fail with `CONTEXT_UNSUPPORTED` (**must update** to a still-
    unsupported context, e.g. multi-context).
- `test/fixtures/data.js` — `item` has `citekey:"Doe2023"`, `title:"Thinking in
  Networks"`, `abstractNote`, and 3 `annotations`. **No `fulltext` field** —
  so a `fulltext` block against the bare `item` fixture will resolve to
  `CONTEXT_MISSING` (useful for the no-fallback test).

### Zotero 7 API used (verified from Zotero source per issue brief)

- `item.getBestAttachment()` — async, `Promise<Zotero.Item | false>`. Regular
  items only. Zotero's "best/first PDF" heuristic (oldest PDF matching parent
  URL, then oldest PDF, …). This is the **primary-PDF selector**.
- `att.isPDFAttachment()` — sync bool (already used in bootstrap).
- `att.fileExists()` — async bool.
- `Zotero.Fulltext.getItemCacheFile(att)` — sync, returns nsIFile pointing at
  `.zotero-ft-cache` (plain UTF-8 extracted text). Returns the path **whether
  or not** the cache file exists.
- `att.attachmentText` — async getter with an **on-demand
  `Zotero.PDFWorker.getFullText()` fallback** that triggers NEW extraction.
  **We will NOT use it** (would violate "extracted/indexed text only" + "no
  custom extraction/OCR"). Reading the cache file directly avoids triggering
  extraction.

---

## Design decisions (A–F) with rationale

### A. Where to fetch full text — the mockable boundary

The pure `prepareLLMRun` cannot call Zotero. Full text must be fetched in
`addon/bootstrap.js` `runLLM()` and passed into the `data` object, mirroring
the annotations pattern (`gatherAnnotations` → `data.annotations`).

**Decision:** Introduce a **new pure module `src/fulltext.js`** with two
exports:

1. `resolvePrimaryPDFFulltext(item, zoteroAdapter)` — **async, pure-ish**: an
   orchestrator that takes an **injected `zoteroAdapter`** (no Zotero import)
   so it is Vitest-testable with a mock boundary. It implements the
   decision tree:
   - `att = await zoteroAdapter.getBestAttachment(item)` → falsy ⇒
     `{ok:false, reason:"noPrimaryPDF"}`.
   - `!zoteroAdapter.isPDFAttachment(att)` ⇒ `{ok:false, reason:"noPrimaryPDF"}`
     (defensive — `getBestAttachment` may return a non-PDF best attachment).
   - `!(await zoteroAdapter.fileExists(att))` ⇒
     `{ok:false, reason:"primaryPdfMissing"}`.
   - `path = zoteroAdapter.getCacheFile(att)` → falsy ⇒
     `{ok:false, reason:"noExtractedText"}`.
   - `!(await zoteroAdapter.exists(path))` ⇒
     `{ok:false, reason:"noExtractedText"}` — **and `readUTF8` is NOT called**
     (this is the guarantee that we never trigger on-demand extraction).
   - `text = await zoteroAdapter.readUTF8(path)` (throw ⇒
     `{ok:false, reason:"readFailed"}`); trim; empty ⇒
     `{ok:false, reason:"noExtractedText"}`.
   - return `{ok:true, attachmentTitle: zoteroAdapter.getAttachmentTitle(att),
     text}`.

2. `renderFulltextContext(itemData)` — **pure**: formats the metadata header +
   extracted text (see decision C). Returns `""` when `itemData.fulltext` is
   absent/`ok:false`/empty (caller treats as `CONTEXT_MISSING`).

**Bootstrap side:** add `async getPrimaryPDFFulltext(item)` to
`addon/bootstrap.js` (near `gatherAnnotations`/`hasPdfAttachment`). It builds
the **real adapter** and delegates:

```js
async getPrimaryPDFFulltext(item) {
  const C = Zotero.getMainWindow().ZONCore || win.ZONCore; // see note below
  const adapter = {
    getBestAttachment: (it) => it.getBestAttachment(),
    isPDFAttachment: (att) => att.isPDFAttachment(),
    fileExists: (att) => att.fileExists(),
    getCacheFile: (att) => { try { let f = Zotero.Fulltext.getItemCacheFile(att); return f ? f.path : null; } catch (e) { return null; } },
    exists: (p) => IOUtils.exists(p),
    readUTF8: (p) => IOUtils.readUTF8(p),
    getAttachmentTitle: (att) => { try { return att.getField("title") || ""; } catch (e) { return ""; } },
  };
  try { return await C.resolvePrimaryPDFFulltext(item, adapter); }
  catch (e) { return { ok: false, reason: "fetchError" }; }
}
```

(`runLLM` already has `win`/`C` in scope — use `C` from there rather than
re-resolving; the snippet above is illustrative. The real implementation
lives inside `runLLM`'s scope or receives `C`/`win`.)

**Why read `.zotero-ft-cache` directly (not `att.attachmentText`):** strictly
honors "extracted/indexed text ONLY" and "no custom extraction/OCR."
`attachmentText` has an on-demand `PDFWorker.getFullText()` fallback that would
trigger NEW extraction for PDFs lacking a cache file — exactly what AC 3/4
forbid. Reading the cache file via `getItemCacheFile(att)` + `IOUtils.readUTF8`
only ever returns text Zotero has **already** extracted/indexed. If no cache
exists, we fail clearly (`noExtractedText`) rather than extracting.

**Gating the fetch (avoid unnecessary IO):** mirror how annotations are
fetched, but only when needed. After reading `existing`, parse once to detect
whether any block requests `fulltext`:

```js
let needFulltext = false;
try {
  let parsed = C.parseLLMBlocks(existing);
  if (!parsed.errors.length) needFulltext = parsed.blocks.some(b => b.contexts && b.contexts.includes("fulltext"));
} catch (e) { this.log("parseLLMBlocks (fulltext detect) failed: " + e); }
```

Only fetch when `needFulltext`. (Parsing is cheap line-by-line; the second
parse inside `prepareLLMRun` is acceptable. Optimizing to a single parse is
out of scope.)

### B. maxContextChars enforcement semantics — HARD FAILURE

**Decision:** Exceeding `maxContextChars` is a **hard pre-flight failure** with
a new error code `CONTEXT_TOO_LARGE` (not silent truncation).

**Rationale:** The issue says "enforced against requested context text" and
lists "context-size failure" as a testable path — "failure" implies a failure,
not silent truncation. Silent truncation would feed the LLM an incomplete
context and produce grounded-but-misleading answers without warning; a hard
failure is explicit, matches the existing `CONTEXT_MISSING` philosophy (missing
⇒ fail, never silently substitute), and preserves the all-or-nothing contract
(a too-large context aborts before any HTTP). It is also trivially testable.

**Where enforced — the PURE layer** (`src/llm-runner.js`), so it is
Vitest-testable and uniform across all contexts. `prepareLLMRun` currently
takes `(text, itemData)` and never receives `maxContextChars`.

**New signature:** `prepareLLMRun(text, itemData, opts = {})` where
`opts.maxContextChars` defaults to `LLM_DEFAULTS.maxContextChars` (100000) when
not a positive number. Import `LLM_DEFAULTS` from `./llm.js` (no cycle: `llm.js`
does not import `llm-runner.js`). This keeps a *setting* out of *item data*
(`maxContextChars` is a pref, not item state — mixing it into `itemData` would
muddy the data model).

**Enforcement point:** immediately after resolving `contextText` for a block
(and before prompt rendering), check `contextText.length > maxContextChars` ⇒
return `{ok:false, code: CONTEXT_TOO_LARGE, errors:[{code, message, line}],
blocks, tasks:[]}`. This applies **uniformly** to abstract/annotations/fulltext
(abstract/annotations are unlikely to exceed 100k, but the check is harmless
and consistent). The check is on the **resolved context text** (post-formatting
for fulltext = header + body), matching "enforced against requested context
text."

**Error message (counts only, never the body):**
`"context is {N} characters, exceeds the configured limit of {max} — reduce
the context or raise maxContextChars"`.

**Bootstrap wiring:** pass `C.prepareLLMRun(existing, data, { maxContextChars:
settings.maxContextChars })`. The new `CONTEXT_TOO_LARGE` code flows through
the **existing generic** `err.llmRunBlock` handler (line 2748) — **no new
bootstrap branch needed**; `first.message` carries the counts-only message.

**Backward compatibility:** the 3rd arg defaults to `{}`; existing 2-arg
callers (bootstrap line 2733 today, and all existing tests) keep working with
the 100000 default. Existing fixtures are tiny (≪ 100000) so they stay green.

### C. Metadata formatting — pure, lightweight, in `src/fulltext.js`

`citekey` and `title` are on `itemData` (`buildItemData`); `attachmentTitle`
comes from the fetched `itemData.fulltext.attachmentTitle`.

**Decision:** `renderFulltextContext(itemData)` (pure, in `src/fulltext.js`,
imported by `llm-runner.js` symmetrically to `renderAnnotationsContext` from
`./annotations.js`) produces:

```
Title: {title}
Citekey: {citekey}
Attachment: {attachmentTitle}

{extracted text body}
```

- Header lines joined with `\n`; a single blank line separates header from the
  extracted text body.
- `Title` and `Attachment` always present; `Citekey` line **omitted when empty**
  (filter `Boolean`) — a bare `Citekey: ` adds noise.
- Returns `""` when `itemData.fulltext` is `null`/`undefined`/`{ok:false}` or
  when the trimmed text is empty — `prepareLLMRun` treats `""` as
  `CONTEXT_MISSING`.
- Does not mutate `itemData` (purity).

**Exact implementation:**

```js
export function renderFulltextContext(itemData) {
  const ft = itemData?.fulltext;
  if (!ft || ft.ok === false) return "";
  const text = String(ft.text ?? "").trim();
  if (text === "") return "";
  const title = String(itemData?.title ?? "").trim();
  const citekey = String(itemData?.citekey ?? "").trim();
  const attachmentTitle = String(ft.attachmentTitle ?? "").trim();
  const header = [
    `Title: ${title}`,
    citekey ? `Citekey: ${citekey}` : null,
    `Attachment: ${attachmentTitle}`,
  ].filter(Boolean).join("\n");
  return `${header}\n\n${text}`;
}
```

### D. No-fallback guarantee — structural + explicit test

The per-block context model already prevents fallback **structurally**: each
runnable block declares exactly one context (enforced by
`block.contexts.length !== 1` ⇒ `CONTEXT_UNSUPPORTED`), and `prepareLLMRun`
resolves only that declared context, failing with `CONTEXT_MISSING` if absent.
There is no code path that tries `abstract` after `fulltext` fails.

**Decision:** keep the model as-is; add an **explicit test** that a `fulltext`
block with missing full text does **not** degrade to abstract/annotations —
using the `item` fixture (which **has** `abstractNote` and `annotations`) plus
`fulltext: null`, asserting `{ok:false, code: CONTEXT_MISSING, tasks:[]}`. If
fulltext succeeded here, it would mean fallback occurred; it must not.

### E. Logging contract — never log the full-text body

`log()` (line 348) writes `Zotero.debug("ZON: " + msg)`. Current `runLLM` log
calls log only exceptions/statuses. For fulltext:

**Decision:**
- The **only** fulltext-related log is metadata-level: attachment title, char
  count, and the missing-reason — never `text`:
  ```js
  if (fulltext && fulltext.ok) this.log("fulltext context: " + (fulltext.attachmentTitle || "(untitled)") + " (" + fulltext.text.length + " chars)");
  else if (fulltext) this.log("fulltext context missing: " + fulltext.reason);
  ```
- **Never** pass `fulltext.text` / `data.fulltext.text` to `this.log()` or
  `Zotero.debug`. Add a code comment in `runLLM` marking this contract.
- Pure-layer error messages are leak-safe by construction: `CONTEXT_MISSING`
  (fulltext) is a static string; `CONTEXT_TOO_LARGE` includes counts only.
  Neither includes the body. (`first.message` is not logged today; only
  `first.detail` is, and only for `RENDER_FAILED` — the nunjucks error, not
  context text.)
- Add a Vitest assertion that the `CONTEXT_TOO_LARGE` and fulltext
  `CONTEXT_MISSING` error messages do **not** contain the extracted text body.

### F. STRINGS — no new keys required

The fulltext missing/too-large messages are **pure-layer messages** surfaced
via the **existing** `err.llmRunBlock` (`"LLM block (line {line}): {message}"`,
line 452), exactly as the abstract/annotations `CONTEXT_MISSING` messages
already work (those are inline English in `src/llm-runner.js`, not in
`STRINGS`). The AGENTS.md rule "never inline user-visible strings in
`bootstrap.js`" applies to **bootstrap** — the pure layer's error messages are
its own contract (already established for abstract/annotations).

**Decision:** reuse `err.llmRunBlock`; **no new STRINGS keys**, **no Fluent
changes** (Fluent is only for UI chrome — header/sidenav/toolbar — not status
messages). This also means **zero risk** of breaking
`fluent.prefixLocaleFiles`/`prefixFluentMessages` (untouched).

---

## File-by-file change list (exact paths + signatures)

### 1. `src/fulltext.js` — NEW pure module

```js
// Pure full-text context resolution for the LLM interpreter.
// No DOM, no Zotero globals — Zotero access is injected via `zoteroAdapter`.

export async function resolvePrimaryPDFFulltext(item, zoteroAdapter) { ... }
//   Returns { ok:true, attachmentTitle, text } | { ok:false, reason }.
//   reason ∈ {"noPrimaryPDF","primaryPdfMissing","noExtractedText","readFailed"}.
//   Decision tree per design A. Never calls readUTF8 when the cache file is
//   missing (no on-demand extraction).

export function renderFulltextContext(itemData) { ... }
//   Returns the formatted header + text, or "" (CONTEXT_MISSING signal).
//   Implementation per design C.
```

`zoteroAdapter` surface (7 methods): `getBestAttachment(item)` async,
`isPDFAttachment(att)` sync, `fileExists(att)` async, `getCacheFile(att)` sync
→ path|string|null, `exists(path)` async, `readUTF8(path)` async,
`getAttachmentTitle(att)` sync.

### 2. `src/llm-runner.js` — modify

- **Line 18:** `export const RUNNABLE_CONTEXTS = ["abstract", "annotations", "fulltext"];`
- **Lines 20-28:** add `CONTEXT_TOO_LARGE: "llm.run.contextTooLarge"` to `LLM_RUN_ERRORS`.
- **Imports:** add `import { LLM_DEFAULTS } from "./llm.js";` and
  `import { renderFulltextContext } from "./fulltext.js";`.
- **Line 50:** change signature to `export function prepareLLMRun(text, itemData, opts = {})`.
  At the top of the body, resolve the limit:
  ```js
  const maxContextChars = (typeof opts?.maxContextChars === "number" && opts.maxContextChars > 0)
    ? Math.floor(opts.maxContextChars) : LLM_DEFAULTS.maxContextChars;
  ```
- **Context-resolution loop:** after the `annotations` branch (line 114), add a
  `fulltext` branch:
  ```js
  } else if (ctxKind === "fulltext") {
    contextText = renderFulltextContext(itemData);
    if (contextText === "") {
      return { ok: false, code: LLM_RUN_ERRORS.CONTEXT_MISSING, errors: [{
        code: LLM_RUN_ERRORS.CONTEXT_MISSING,
        message: "no extracted full text available for the primary PDF — cannot run with context='fulltext'",
        line: block.lineFrom,
      }], blocks, tasks: [] };
    }
  }
  ```
- **Enforcement:** immediately after the context-resolution `if/else` (before
  prompt rendering at line 131), add:
  ```js
  if (contextText.length > maxContextChars) {
    return { ok: false, code: LLM_RUN_ERRORS.CONTEXT_TOO_LARGE, errors: [{
      code: LLM_RUN_ERRORS.CONTEXT_TOO_LARGE,
      message: `context is ${contextText.length} characters, exceeds the configured limit of ${maxContextChars} — reduce the context or raise maxContextChars`,
      line: block.lineFrom,
    }], blocks, tasks: [] };
  }
  ```
- The defensive `else` (lines 115-128) stays for the unreachable case, but its
  message still names `RUNNABLE_CONTEXTS` (now including `fulltext`) — fine.

### 3. `src/item-data.js` — modify

- In `buildItemData`'s return object (lines 70-87), add near `annotations`:
  ```js
  fulltext: opts.fulltext ?? null,
  ```
  Carries the bootstrap-fetched `{ok:true, attachmentTitle, text}` (or
  `{ok:false, reason}` or `null`) into the pure layer.

### 4. `core/core.js` — modify

- Add a re-export line for the new module:
  ```js
  export { resolvePrimaryPDFFulltext, renderFulltextContext } from "../src/fulltext.js";
  ```
  (So `ZONCore.resolvePrimaryPDFFulltext` / `ZONCore.renderFulltextContext`
  exist on the IIFE global. `llm-runner.js`'s existing re-export on line 21 is
  unchanged — it does not re-export `renderFulltextContext` because that now
  lives in `fulltext.js` and is imported internally by `llm-runner.js`.)

### 5. `addon/bootstrap.js` — modify

- **Add `async getPrimaryPDFFulltext(item, C)`** near `hasPdfAttachment`
  (~line 2396). Builds the real adapter (per design A) and returns
  `C.resolvePrimaryPDFFulltext(item, adapter)`; wraps unexpected throws as
  `{ok:false, reason:"fetchError"}`. **Never logs `text`.**
- **In `runLLM(rec)` (~lines 2718-2733):**
  - After reading `existing` (line 2711) and gathering annotations (line 2721),
    add the `needFulltext` detection + gated fetch (per design A) with the
    metadata-only logging (per design E) and a code comment forbidding body
    logging.
  - Pass `fulltext` into `buildItemData`:
    `C.buildItemData(item, { citekey, bibliography, importDate: ..., annotations, fulltext })`.
  - Pass the limit into the planner:
    `C.prepareLLMRun(existing, data, { maxContextChars: settings.maxContextChars })`.
  - **No new error-handling branch** — `CONTEXT_TOO_LARGE` and fulltext
    `CONTEXT_MISSING` surface via the existing generic `err.llmRunBlock` path
    (line 2748).

### 6. `test/fulltext.spec.js` — NEW Vitest file

See test plan below. Imports from `../src/fulltext.js` (no Zotero globals).

### 7. `test/llm-runner.spec.js` — modify

See test plan below.

---

## Test plan (each case mapped to acceptance criteria)

### NEW: `test/fulltext.spec.js`

**`describe("resolvePrimaryPDFFulltext")` — mocked Zotero boundary**

| # | Test | Mock setup | Asserts | AC |
|---|------|-----------|---------|----|
| F1 | returns `{ok:true, attachmentTitle, text}` when primary PDF has a cache file | adapter returns att, isPDF true, fileExists true, getCacheFile→path, exists true, readUTF8→"extracted text", getAttachmentTitle→"Full Text.pdf" | `ok:true`, `text` trimmed, `attachmentTitle==="Full Text.pdf"` | 2, 3, 9 |
| F2 | `noPrimaryPDF` when `getBestAttachment` returns `false` | getBestAttachment→false | `{ok:false, reason:"noPrimaryPDF"}` | 6, 9 |
| F3 | `noPrimaryPDF` when best attachment is not a PDF | isPDF→false | `{ok:false, reason:"noPrimaryPDF"}` | 6 |
| F4 | `primaryPdfMissing` when `fileExists` is false | fileExists→false | `{ok:false, reason:"primaryPdfMissing"}` | 6 |
| F5 | `noExtractedText` when cache file does not exist | getCacheFile→path, exists→false | `{ok:false, reason:"noExtractedText"}`; **and `readUTF8` was NOT called** | 3, 4, 6, 9 |
| F6 | `noExtractedText` when cache file is empty | exists→true, readUTF8→"   " | `{ok:false, reason:"noExtractedText"}` | 6 |
| F7 | `readFailed` when `readUTF8` throws | readUTF8→throws | `{ok:false, reason:"readFailed"}` | robustness |
| F8 | `noExtractedText` when `getCacheFile` returns `null` | getCacheFile→null | `{ok:false, reason:"noExtractedText"}`; `readUTF8` not called | 3, 6 |
| F9 | trims surrounding whitespace from extracted text | readUTF8→"\n  hello world  \n" | `text==="hello world"` | 5 |

**`describe("renderFulltextContext")` — pure formatter**

| # | Test | Asserts | AC |
|---|------|---------|----|
| F10 | formats Title/Citekey/Attachment header + blank line + text | output === `Title: Thinking in Networks\nCitekey: Doe2023\nAttachment: Full Text.pdf\n\n<body>` | 5, 9 |
| F11 | omits `Citekey` line when citekey is empty | output has no `Citekey:` line; still has Title + Attachment | 5 |
| F12 | returns `""` when `fulltext` is `null` | `""` | 6 |
| F13 | returns `""` when `fulltext.ok === false` | `""` | 6 |
| F14 | returns `""` when `fulltext.text` is empty/whitespace | `""` | 6 |
| F15 | does not mutate `itemData` | deep-equal before/after | purity |

### MODIFIED: `test/llm-runner.spec.js`

**Updates to existing tests:**

| # | Change | Why |
|---|--------|-----|
| U1 | Line 39-41: assert `RUNNABLE_CONTEXTS` equals `["abstract","annotations","fulltext"]` | AC 1 |
| U2 | Remove the `fulltext`-unsupported test (lines 358-363) and the `fulltext`-message test (373-378) from the "context unsupported" block | fulltext is now supported (AC 1) |
| U3 | Keep the multi-context unsupported tests (365-371, 380-387) — multi-context is still unsupported | preserve coverage |
| U4 | All-or-nothing test at 465 ("aborts when 2nd block is unsupported"): change the 2nd block from `context="fulltext"` to `context="abstract,annotations"` (multi-context, still `CONTEXT_UNSUPPORTED`) | preserve the unsupported→no-partial intent (AC 1) |
| U5 | All-or-nothing test at 498 ("never returns a partial task list"): change the 2nd block to `context="abstract,annotations"` (multi-context) | preserve no-partial coverage without relying on fulltext being unsupported (AC 1) |

**NEW describe blocks:**

**`describe("prepareLLMRun — fulltext context")`**

| # | Test | Setup | Asserts | AC |
|---|------|-------|---------|----|
| N1 | returns `{ok:true}` with one task for a single fulltext block | `data = {...item, fulltext:{ok:true, attachmentTitle:"Full Text.pdf", text:"body text"}}` | `ok:true`, `tasks.length===1`, `contextLabel==="fulltext"` | 1 |
| N2 | user message Context section contains the metadata header + extracted text | same | `messages[1].content` contains `Context:`, `Title: Thinking in Networks`, `Citekey: Doe2023`, `Attachment: Full Text.pdf`, and `body text` | 5, 9 |
| N3 | returns `CONTEXT_MISSING` when `fulltext` is `null` | `data = {...item, fulltext:null}` | `{ok:false, code:CONTEXT_MISSING, tasks:[]}` | 6 |
| N4 | returns `CONTEXT_MISSING` when `fulltext.text` is empty | `data = {...item, fulltext:{ok:true, attachmentTitle:"X.pdf", text:""}}` | `{ok:false, code:CONTEXT_MISSING}` | 6 |
| N5 | **no fallback**: fulltext missing does NOT degrade to abstract/annotations (item has both) | `data = {...item, fulltext:null}` (item has `abstractNote` + 3 annotations) | `{ok:false, code:CONTEXT_MISSING}` (NOT ok) — proves no fallback | 7, 9 |
| N6 | error.message is static and does not include the extracted text body | `fulltext:{ok:true, attachmentTitle:"X", text:"SECRET BODY"}`, `fulltext:null` for the missing case | `errors[0].message` does not contain `SECRET BODY`; contains "no extracted full text" | leak (E) |

**`describe("prepareLLMRun — maxContextChars enforcement")`**

| # | Test | Setup | Asserts | AC |
|---|------|-------|---------|----|
| N7 | returns `CONTEXT_TOO_LARGE` when contextText exceeds `opts.maxContextChars` | fulltext text length 200, `opts.maxContextChars:100` | `{ok:false, code:CONTEXT_TOO_LARGE, tasks:[]}` | 8, 9 |
| N8 | succeeds when contextText is under `opts.maxContextChars` | fulltext text length 50, `opts.maxContextChars:100` | `{ok:true}` | 8 |
| N9 | defaults `maxContextChars` to 100000 when `opts` omitted | text length 5000 (2-arg call) | `{ok:true}`; and text length 100001 → `CONTEXT_TOO_LARGE` | 8 |
| N10 | applies to abstract context too (uniform) | `abstractNote` length 200, `opts.maxContextChars:100` | `{ok:false, code:CONTEXT_TOO_LARGE}` | 8 |
| N11 | error.message includes char counts but NOT the context body | text `"SECRET".repeat(100)`, `maxContextChars:10` | `errors[0].message` contains the counts, not `SECRET` | 8, leak (E) |
| N12 | aborts the whole run (`tasks:[]`) on `CONTEXT_TOO_LARGE` | two blocks, 2nd too large | `{ok:false, tasks:[]}` | 1, 8 |

**Mapping summary:** AC 1 (U1, U2, U4, U5, N1); AC 2 (F1); AC 3 (F1, F5, F8);
AC 4 (F5 — `readUTF8` not called when cache missing); AC 5 (F10, F11, N2);
AC 6 (F2-F6, F8, N3, N4); AC 7 (N5); AC 8 (N7-N12); AC 9 (F1-F15, N1-N6 — all
via mocked boundary / pure assertions).

---

## Slicing order for implementation

Each slice is independently testable; the pure layer lands first.

1. **Slice 1 — pure formatter + data plumbing (no behavior change):**
   - Add `src/fulltext.js` with `renderFulltextContext` only.
   - Add `fulltext: opts.fulltext ?? null` to `src/item-data.js`.
   - Re-export `renderFulltextContext` in `core/core.js`.
   - Add `test/fulltext.spec.js` `renderFulltextContext` tests (F10-F15).
   - `npm test` green. (Fulltext still unsupported in runner — no behavior change.)

2. **Slice 2 — pure runner: fulltext runnable + maxContextChars:**
   - `src/llm-runner.js`: `RUNNABLE_CONTEXTS` += `fulltext`; add
     `CONTEXT_TOO_LARGE`; import `LLM_DEFAULTS` + `renderFulltextContext`;
     change signature to `(text, itemData, opts={})`; add fulltext branch; add
     maxContextChars enforcement.
   - Update `test/llm-runner.spec.js` (U1-U5, N1-N12).
   - `npm test` green. (Pure layer complete; bootstrap not yet wired.)

3. **Slice 3 — pure selector + mocked-boundary tests:**
   - Add `resolvePrimaryPDFFulltext` to `src/fulltext.js`; re-export in
     `core/core.js`.
   - Add `test/fulltext.spec.js` `resolvePrimaryPDFFulltext` tests (F1-F9).
   - `npm test` green. (Selector logic tested without Zotero.)

4. **Slice 4 — bootstrap wiring:**
   - Add `getPrimaryPDFFulltext(item, C)` to `addon/bootstrap.js`.
   - Wire into `runLLM`: `needFulltext` detect → gated fetch → metadata-only
     logging → pass `fulltext` into `buildItemData` and `maxContextChars` into
     `prepareLLMRun`. Add the no-body-logging code comment.
   - `npm run build` green (no integration test — requires Zotero env).

5. **Slice 5 — verify:**
   - `npm test` green (all updated + new tests).
   - `npm run build` green.
   - Manual review: grep bootstrap `runLLM`/`getPrimaryPDFFulltext` for any
     `log(` call that could receive `fulltext.text` / `data.fulltext.text`
     (must be none).

---

## Risks & rollback

- **`getBestAttachment()` may return a non-PDF best attachment** (e.g., an
  HTML attachment matched by URL). Mitigation: verify `isPDFAttachment(att)`
  after; treat non-PDF as `noPrimaryPDF` rather than guessing. Documented in
  the decision tree.
- **`.zotero-ft-cache` absent for PDFs never opened in the Zotero reader.**
  This is **intended** (extracted/indexed only), but users may expect text for
  any PDF. Mitigation: the clear `CONTEXT_MISSING` message + the bootstrap
  `reason:"noExtractedText"` log. **Do NOT** fall back to `att.attachmentText`
  (would trigger on-demand extraction and violate AC 3/4). Rollback for this
  point would be a product decision, not a code revert.
- **`maxContextChars` hard-failure could break existing abstract/annotations
  runs** if a user set a tiny limit. Mitigation: default 100000 is large;
  abstract/annotations rarely exceed it; existing tests use tiny fixtures (≪
  100000) and stay green. The check only triggers on actual exceedance.
- **3rd `opts` arg to `prepareLLMRun`** — backward compatible (`opts={}`
  default; 2-arg callers keep the 100000 default). Existing 2-arg tests pass.
- **Double parse in `runLLM`** (fulltext detect + inside `prepareLLMRun`) —
  cheap (line-by-line over a note); acceptable. Single-parse optimization is
  out of scope.
- **Logging text leakage** — mitigated by explicit guard + tests (N6, N11) +
  code comment. The pure-layer messages are leak-safe by construction.
- **Rollback:** all changes are additive to the fulltext path. Reverting
  `RUNNABLE_CONTEXTS` to exclude `fulltext` + reverting the bootstrap wiring
  restores prior behavior; the pure `src/fulltext.js` additions become dead
  code if unwired. Low-risk, fully reversible.

---

## Verification playbook

1. `npm test` — Vitest. Expect: all pre-existing abstract/annotations tests
   green; updated `RUNNABLE_CONTEXTS` test green; removed fulltext-unsupported
   tests gone; new `test/fulltext.spec.js` (F1-F15) green; new
   `llm-runner.spec.js` fulltext + maxContextChars blocks (N1-N12) green;
   updated all-or-nothing tests (U4, U5) green.
2. `npm run build` — packages the `.xpi` to `.scaffold/build/`. Expect success
  (confirms `core/core.js` re-export + new `src/fulltext.js` bundle cleanly).
3. **No integration test** (`npm run test:zotero` requires a Zotero env + `.env`
   and has no LLM execution coverage today — HTTP is not testable in throwaway
   Zotero). Bootstrap wiring is build-only verified.
4. **Leak audit (manual):** confirm no `this.log(...)` in `runLLM` /
   `getPrimaryPDFFulltext` receives `fulltext.text` or `data.fulltext.text`.
5. **Constraints check:** no Fluent changes; no `prefixLocaleFiles`/
   `prefixFluentMessages` toggle; no `&&` in single-command config fields; no
   Zotero globals imported in `src/*` or `test/*.spec.js` (mocked boundary
   only); existing abstract/annotations behavior + tests untouched in
   semantics.

---

## Acceptance checklist (verbatim from the issue)

- [ ] 1. `context="fulltext"` is accepted by Run LLM and participates in the same all-or-nothing execution path as abstract context.
- [ ] 2. Full-text context resolves the item's primary PDF using Zotero's best/first PDF behavior (`item.getBestAttachment()`).
- [ ] 3. Full-text context uses Zotero-available extracted/indexed text ONLY.
- [ ] 4. The plugin does NOT perform custom PDF extraction or OCR.
- [ ] 5. Full-text context is formatted as plain extracted text with lightweight metadata (title, citekey, attachment title).
- [ ] 6. The LLM call fails clearly when no primary PDF exists OR when Zotero has no extracted/indexed full text for the primary PDF.
- [ ] 7. The LLM call NEVER falls back from full text to abstract or annotations.
- [ ] 8. The configured max context character limit (`maxContextChars`) is enforced against requested context text.
- [ ] 9. Focused Vitest tests cover: primary-PDF selection behavior through a MOCKED Zotero boundary, unavailable full text, no fallback, metadata formatting, and context-size failure.

---

## Definition of done

- All 9 acceptance criteria met (checkboxes above).
- `npm test` (Vitest) green, including new fulltext tests and updated tests
  that previously asserted fulltext as unsupported.
- `npm run build` succeeds (no integration test run — requires a Zotero env).
- No full text ever appears in logs (leak audit clean).
- This plan file is self-contained (survives context compaction).
