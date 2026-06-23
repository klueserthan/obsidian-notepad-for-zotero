# Plan — Issue #5: Add `context="annotations"` to the Run LLM interpreter

Status: draft · Owner: plan-runner · Repo: `obsidian-notepad-for-zotero` (Zotero 7 plugin, AGPL-3.0)

---

## Context & goals

GitHub issue #5 asks for `context="annotations"` support in the runnable LLM
interpreter path (`{% llm context="annotations" %}…{% endllm %}`). Today the
block **parser** already accepts `annotations` (`SUPPORTED_CONTEXTS` in
`src/llm-blocks.js:7`), but the **run planner** (`src/llm-runner.js`) only
resolves `abstract` and rejects `annotations` with `CONTEXT_UNSUPPORTED`.

Goal: make `context="annotations"` a first-class, all-or-nothing runnable
context that feeds the item's PDF annotations (gathered by the existing
`gatherAnnotations` flow) into the LLM prompt as structured markdown — sorted
in PDF order, with page labels, type/color, quoted text, and comments. Image-only
annotations (no text AND no comment) are omitted; if nothing usable remains the
run fails clearly with `CONTEXT_MISSING`.

Pure logic lives in `src/` (ES modules, no DOM/Zotero globals) and is unit-tested
with Vitest (`test/*.spec.js`). UI wiring lives in `addon/bootstrap.js` and is
NOT covered by Vitest (Zotero globals) — build-only verification there.

### Verified facts (read from source, not assumed)

- `src/llm-runner.js:17` — `RUNNABLE_CONTEXTS = ["abstract"]` (the gate).
- `src/llm-runner.js:49` `prepareLLMRun(text, itemData)` — iterates blocks; the
  abstract resolver is at lines 78-92 (reads `itemData.abstractNote`, empty →
  `CONTEXT_MISSING`). `buildLLMMessages(system, task, context)` at line 29
  assembles `Task:\n…\n\nContext:\n…`. All-or-nothing: any block failure →
  `{ok:false, tasks:[]}`.
- `src/annotations.js` — `renderAnnotationLine` (line 50) and
  `renderAnnotationsSection` (line 77) produce the **note** format with
  `%% ann:KEY %%` anchors and `![[…]]` embeds — **wrong for LLM context**.
  `mapZoteroAnnotation(a, attachmentKey)` (line 92) yields shape
  `{ key, type, annotatedText, comment, pageLabel, pageIndex, attachmentKey,
  color, colourName, imageBaseName, sortIndex }`. The sort comparator
  (lines 80-84) orders by `sortIndex` string then `key` localeCompare.
  Private `esc(s)` (line 22) collapses whitespace + trims — reusable inside
  the file.
- `src/item-data.js:84` — `buildItemData` already sets
  `annotations: opts.annotations || []`, but `addon/bootstrap.js:2722`
  (`runLLM`) does **not** pass `annotations`, so `data.annotations === []`.
- `addon/bootstrap.js:2315` `gatherAnnotations(item, win)` — fetches real
  annotations from `att.getAnnotations()`, maps via `mapZoteroAnnotation`,
  returns array in Zotero native order (NOT sortIndex-sorted; sorting is
  downstream). Uses `win.ZONCore` (capital C — confirmed; no casing bug).
- `addon/bootstrap.js:2740-2744` — `CONTEXT_UNSUPPORTED` / `CONTEXT_MISSING` /
  `RENDER_FAILED` all surface via the existing `this.t("err.llmRunBlock",
  {line, message})` status (STRINGS key at line 452). **No new UI strings
  required** — the missing-annotations message is generated in `src/` and
  shown through `err.llmRunBlock`.
- `core/core.js:8` re-exports `renderAnnotationsSection, mapZoteroAnnotation`
  from `annotations.js`; line 21 re-exports all of `llm-runner.js`.
- `test/fixtures/data.js` `item.annotations` (3 entries) **lack** `sortIndex`,
  `color`, `colourName` (they have `key,type,annotatedText,comment,pageLabel,
  date`). The formatter MUST handle missing fields. All 3 are "usable"
  (AAA111 highlight+text, BBB222 highlight+text, CCC333 text+comment).
- Code style: **semicolons used**, ES modules, 2-space indent, JSDoc comments
  on exports.

### Critical test-breakage (must be handled in Slice 2)

`test/llm-runner.spec.js` currently asserts `annotations` is unsupported in
**4 places**. Once `annotations` joins `RUNNABLE_CONTEXTS` these break:

1. Line 38-42 — `RUNNABLE_CONTEXTS` equals `["abstract"]` → must become
   `["abstract", "annotations"]`.
2. Line 358-363 — `context="annotations"` → `CONTEXT_UNSUPPORTED`. Becomes
   `ok:true` (the `item` fixture has usable annotations). **Remove/replace**;
   keep the `fulltext` unsupported test (line 365-370) as the unsupported
   sentinel.
3. Line 380-385 — message-naming test uses `context="annotations"`, asserts
   `result.errors[0].message` contains "annotations". Will crash
   (`errors` is `[]`). **Convert to `context="fulltext"`** to keep asserting
   the unsupported-message contract.
4. Line 472-486 and 505-519 — all-or-nothing tests use
   `context="annotations"` as the "invalid 2nd block". Will no longer abort.
   **Change the 2nd block to `context="fulltext"`** (still unsupported) to
   preserve the tests' intent.

The all-or-nothing test at line 488-503 (two `abstract` blocks, missing
abstract) does **not** touch annotations → unchanged.

---

## Design decisions (decided)

1. **Formatter location**: new pure export `renderAnnotationsContext(anns)` in
   `src/annotations.js`. It reuses the file's private `esc` and the sort
   comparator. It produces LLM-friendly structured markdown **without**
   `%% ann:KEY %%` anchors or `![[…]]` embeds. A clear section comment
   separates it from the note-rendering functions (different concern).

2. **Annotations → `prepareLLMRun`**: **Option A** — populate
   `itemData.annotations` in the `runLLM` bootstrap flow by calling
   `gatherAnnotations` and passing it to `buildItemData`. `prepareLLMRun`
   keeps its `(text, itemData)` signature and reads `itemData.annotations`.
   This matches how templates already access annotations and minimizes
   signature churn.

3. **Availability rule**: an annotation is *usable* iff
   `esc(annotatedText) !== ""` OR `esc(comment) !== ""`. Image-only (no text,
   no comment) → omitted and not counted. Zero usable → `CONTEXT_MISSING`
   with a static, prompt-leak-free message (mirrors the abstract branch).

4. **`RUNNABLE_CONTEXTS`**: add `"annotations"` →
   `["abstract", "annotations"]`.

5. **Resolver branch**: `else if (block.contexts[0] === "annotations")` after
   the abstract branch, calling the formatter on `itemData.annotations`,
   checking availability, then assembling messages + pushing the task (same
   shape as abstract: `{ block, messages, contextLabel: "annotations" }`).

6. **Sort helper**: extract a private `sortAnnotations(anns)` from the
   inline comparator in `renderAnnotationsSection` (lines 80-84) and reuse it
   in both `renderAnnotationsSection` and `renderAnnotationsContext`. Pure
   refactor; the existing `renderAnnotationsSection` ordering tests guard it.

### Formatter output format (stable contract)

Per usable annotation, build `parts = [header]` then push quoted text and/or
comment, join parts with `"\n\n"`, join blocks with `"\n\n"`.

```
header  = `### p.{page} — {type}[ ({colourName})]`
quote   = `> "{annotatedText}"`        // only if annotatedText non-empty
comment = `Comment: {comment}`          // only if comment non-empty
```

- `page` = `esc(pageLabel) || (pageIndex != null ? String(pageIndex + 1) : "")`
  → `page || "?"` in the header (mirrors `pdfLink` fallback logic).
- `type` = raw annotation type string (`highlight`/`underline`/`image`/`ink`/
  `text`/`note`).
- `colourName` parenthetical appended only when non-empty.
- Returns `""` when zero usable annotations (the resolver treats `""` as
  `CONTEXT_MISSING`). Documented in JSDoc.

Example (highlight with comment, no colourName):
```
### p.3 — highlight
> "networks shape cognition"

Comment: central claim
```

Example (image with comment only):
```
### p.9 — image (yellow)

Comment: this figure shows the topology
```

Example (text/note with comment only):
```
### p.7 — text

Comment: follow up on this method
```

---

## Files to create / modify

| File | Action | Slice |
| --- | --- | --- |
| `src/annotations.js` | Add `sortAnnotations` (extract) + `renderAnnotationsContext` export | 1 |
| `test/annotations.spec.js` | Add `renderAnnotationsContext` test block | 1 |
| `src/llm-runner.js` | Import formatter; add `"annotations"` to `RUNNABLE_CONTEXTS`; add resolver branch | 2 |
| `test/llm-runner.spec.js` | Update 4 broken tests; add annotations success/missing/image tests | 2 |
| `core/core.js` | (Recommended) add `renderAnnotationsContext` to the `annotations.js` re-export line | 4 |
| `addon/bootstrap.js` | In `runLLM`, call `gatherAnnotations` and pass to `buildItemData` | 3 |

No new files. No build config changes. No FTL/manifest changes.

---

## Implementation slices

Each slice is one code-executor task. Slices are ordered by dependency:
**1 → 2 → 3** (3 also benefits from 4). **5** is final verification.

### Slice 1 — Formatter + tests (`src/annotations.js`, `test/annotations.spec.js`)

**Allowed scope**: `src/annotations.js` and `test/annotations.spec.js` only.

**Steps**:

1. Extract a private `sortAnnotations(anns)` helper from the inline
   comparator currently at `src/annotations.js:80-84`:
   ```js
   function sortAnnotations(annotations) {
     return [...(annotations || [])].sort((x, y) => {
       const sx = String(x.sortIndex ?? ""), sy = String(y.sortIndex ?? "");
       if (sx !== sy) return sx < sy ? -1 : 1;
       return String(x.key).localeCompare(String(y.key));
     });
   }
   ```
   Replace the inline sort in `renderAnnotationsSection` with
   `const sorted = sortAnnotations(annotations);`. **Do not change any other
   behavior of `renderAnnotationsSection`** — the existing tests
   (`orders by sortIndex and anchors every block`, `renders Zotero sortIndex
   order correctly via the string comparator`, merge idempotence) must still
   pass unchanged.

2. Add the new export after `renderAnnotationsSection` (with a section
   comment marking it as the LLM-context formatter, distinct from the
   note-rendering functions above):
   ```js
   // LLM-context formatter — a DIFFERENT concern from the note-rendering
   // functions above: produces clean structured markdown for an LLM prompt,
   // with NO `%% ann:KEY %%` anchors and NO `![[…]]` embeds. Image-only
   // annotations (no text AND no comment) are omitted. Returns "" when no
   // usable annotations remain (caller treats that as CONTEXT_MISSING).
   export function renderAnnotationsContext(annotations) {
     const usable = sortAnnotations(annotations)
       .filter((a) => esc(a.annotatedText) !== "" || esc(a.comment) !== "");
     if (usable.length === 0) return "";
     const blocks = usable.map((a) => {
       const page = esc(a.pageLabel) || (a.pageIndex != null ? String(a.pageIndex + 1) : "");
       const colour = esc(a.colourName);
       const type = String(a.type || "");
       const header = `### p.${page || "?"} — ${type}${colour ? ` (${colour})` : ""}`;
       const parts = [header];
       const text = esc(a.annotatedText);
       if (text) parts.push(`> "${text}"`);
       const comment = esc(a.comment);
       if (comment) parts.push(`Comment: ${comment}`);
       return parts.join("\n\n");
     });
     return blocks.join("\n\n");
   }
   ```
   (Sketch — executor finalizes exact whitespace; keep the contract above.)

3. Add a `describe("renderAnnotationsContext (LLM context formatter)", …)`
   block to `test/annotations.spec.js` covering:
   - **structured formatting**: a highlight with text+comment+colourName
     produces `### p.3 — highlight (yellow)\n\n> "…"\n\nComment: …`.
   - **ordering by sortIndex then key**: input out of order → output in
     sortIndex order (use full-shape fixtures with `sortIndex`).
   - **comments present**: comment-only line appears when comment set.
   - **image-comment inclusion**: an `image` annotation with empty
     `annotatedText` but a non-empty `comment` is included and contributes
     only header + `Comment:` (no blockquote).
   - **image-only omission**: an `image` (or `ink`) annotation with empty
     text AND empty comment is omitted and does not appear.
   - **text/note with comment**: a `text`/`note` annotation with only a
     comment is included (header + Comment).
   - **missing fields graceful**: annotations without `sortIndex`/`colourName`
     /`pageLabel` still render (page falls back to `pageIndex+1` then `?`;
     no colour parenthetical; sort falls back to key).
   - **empty input → ""**: `renderAnnotationsContext([])` returns `""`.
   - **all-image-only → ""**: input of only image-only annotations returns
     `""`.
   - **no anchors/embeds**: output contains neither `%% ann:` nor `![[`.

   Use full-shape inline fixtures (with `sortIndex`, `colourName`, `type:
   "image"`) for the image/colour/ordering cases — do NOT rely on the shared
   `item` fixture (it lacks those fields).

**Per-slice acceptance**:
- `npx vitest run test/annotations.spec.js` passes (new + existing tests).
- `renderAnnotationsContext` is exported and pure (no DOM/Zotero imports).
- `renderAnnotationsSection` behavior unchanged (its existing tests pass
  unmodified).

---

### Slice 2 — Runner resolver + tests (`src/llm-runner.js`, `test/llm-runner.spec.js`)

**Depends on**: Slice 1. **Allowed scope**: `src/llm-runner.js`,
`test/llm-runner.spec.js`, (optionally `core/core.js` — see Slice 4).

**Steps**:

1. In `src/llm-runner.js`, add the import at the top (after the existing
   `./render.js` import):
   ```js
   import { renderAnnotationsContext } from "./annotations.js";
   ```

2. Change line 17:
   ```js
   export const RUNNABLE_CONTEXTS = ["abstract", "annotations"];
   ```

3. Restructure the per-block resolution (currently lines 78-115) so the
   abstract branch and the new annotations branch are mutually exclusive
   based on `block.contexts[0]`. The `block.contexts.length !== 1` guard
   (line 64) stays as-is (multi-context still → `CONTEXT_UNSUPPORTED`).
   Sketch:
   ```js
   const ctxKind = block.contexts[0];

   // --- context resolution ---
   let contextText = "";
   let contextLabel = ctxKind;

   if (ctxKind === "abstract") {
     const abstract = String(itemData?.abstractNote ?? "").trim();
     if (abstract === "") {
       return { ok: false, code: LLM_RUN_ERRORS.CONTEXT_MISSING,
         errors: [{ code: LLM_RUN_ERRORS.CONTEXT_MISSING,
           message: "abstract is empty for this item — cannot run with context='abstract'",
           line: block.lineFrom }], blocks, tasks: [] };
     }
     contextText = abstract;
   } else if (ctxKind === "annotations") {
     contextText = renderAnnotationsContext(itemData?.annotations || []);
     if (contextText === "") {
       return { ok: false, code: LLM_RUN_ERRORS.CONTEXT_MISSING,
         errors: [{ code: LLM_RUN_ERRORS.CONTEXT_MISSING,
           message: "no usable annotations for this item — cannot run with context='annotations'",
           line: block.lineFrom }], blocks, tasks: [] };
     }
   } else {
     // Unreachable (RUNNABLE_CONTEXTS gate above), but keep defensive.
     return { ok: false, code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
       errors: [{ code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
         message: "context '" + block.contexts.join(", ") + "' is not yet supported by Run LLM (only '" + RUNNABLE_CONTEXTS.join("', '") + "')",
         line: block.lineFrom }], blocks, tasks: [] };
   }

   // --- prompt rendering (unchanged) ---
   let rendered;
   try { rendered = render(block.body, itemData); }
   catch (e) { /* RENDER_FAILED — unchanged */ }

   const messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, contextText);
   tasks.push({ block, messages, contextLabel });
   ```
   **Preserve the exact error shapes** (`code`, `errors[].code`,
   `errors[].message`, `errors[].line`, `blocks`, `tasks: []`) and the
   `RENDER_FAILED` branch verbatim. The abstract `CONTEXT_MISSING` message
   string stays byte-identical (existing test asserts it contains
   "abstract is empty").

4. Update `test/llm-runner.spec.js`:
   - **Line 38-42**: change expected `RUNNABLE_CONTEXTS` to
     `["abstract", "annotations"]`.
   - **Line 358-363**: remove the `context="annotations"` →
     `CONTEXT_UNSUPPORTED` test (annotations is now supported). Keep the
     `fulltext` unsupported test (line 365-370) and multi-context test
     (line 372-378).
   - **Line 380-385**: change `context="annotations"` to
     `context="fulltext"` so it still asserts the unsupported-message
     contract (message contains the context name, not the prompt body).
   - **Line 472-486** (all-or-nothing, 2nd block unsupported): change the
     2nd block from `context="annotations"` to `context="fulltext"`.
   - **Line 505-519** (never returns partial task list): change the 2nd
     block from `context="annotations"` to `context="fulltext"`.
   - Add a new `describe("prepareLLMRun — annotations context", …)` block:
     - **success**: `context="annotations"` with the shared `item` fixture
       → `ok:true`, 1 task, `contextLabel === "annotations"`, user message
       contains `Context:` and the quoted annotation text
       (`networks shape cognition`) and `Comment: central claim`.
     - **ordering**: with `item` fixture (annotations lack `sortIndex` →
       falls back to key order AAA111, BBB222, CCC333), assert
       `indexOf("networks shape cognition") < indexOf("degree distribution matters") < indexOf("follow up on this method")`.
     - **missing — empty array**: `{ ...item, annotations: [] }` →
       `ok:false`, `code: CONTEXT_MISSING`, `tasks: []`.
     - **missing — all image-only**: an item whose annotations are all
       image-only (empty text + empty comment) → `CONTEXT_MISSING`.
     - **image-comment included**: an item with one image annotation that
       has a comment → `ok:true`, context text contains `Comment:` but no
       blockquote `>` line for that annotation.
     - **image-only omitted but run still succeeds**: an item with one
       usable highlight + one image-only annotation → `ok:true`, context
       text contains the highlight's text and does NOT contain the
       image-only annotation's key/page.
     - **no prompt leakage**: the `CONTEXT_MISSING` error message does not
       contain the prompt body (mirror the abstract test at line 345-351).
     - **all-or-nothing with annotations**: two `context="annotations"`
       blocks where the 2nd has no usable annotations
       (`{ ...item, annotations: [] }`) → `ok:false`,
       `code: CONTEXT_MISSING`, `tasks: []`.
   - The existing abstract tests (success, missing, render, message
     assembly) must pass **unchanged**.

**Per-slice acceptance**:
- `npx vitest run test/llm-runner.spec.js` passes (all updated + new tests).
- `npx vitest run test/llm-blocks.spec.js` passes (parser untouched).
- Abstract-context behavior is byte-identical (the
  `the user message is exactly 'Task:\\n…\\n\\nContext:\\n…'` test at line
  533-539 still passes).

---

### Slice 3 — Bootstrap wiring (`addon/bootstrap.js`)

**Depends on**: Slice 2. **Allowed scope**: `addon/bootstrap.js` only.
**Not covered by Vitest** (Zotero globals) — verify by build only.

**Steps**:

1. In `runLLM` (`addon/bootstrap.js:2680`), after `win`/`C` are resolved
   (line 2688) and before `buildItemData` (line 2722), gather annotations so
   they are available to the resolver via `itemData.annotations`:
   ```js
   // Gather PDF annotations so context="annotations" blocks can resolve.
   // (Same flow Refresh uses; cheap on an explicit user action.)
   let annotations = [];
   try { annotations = this.gatherAnnotations(item, win); }
   catch (e) { this.log("gatherAnnotations (llm) failed: " + e); }
   ```
2. Pass them to `buildItemData` at line 2722:
   ```js
   data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString(), annotations });
   ```
   (Add the `annotations` option; keep the other options verbatim.)

**Notes**:
- `gatherAnnotations` is the existing method at line 2315; it uses
  `win.ZONCore` (already injected at line 2687) and returns `[]` on error
  (its own try/catch). The extra try/catch here is belt-and-suspenders.
- `gatherAnnotations` is called on every Run LLM, including abstract-only
  runs. This is acceptable (Run LLM is an explicit user click; Refresh
  already calls it routinely). A conditional-gather optimization (peek for
  an annotations-context block before gathering) is a possible follow-up
  but out of scope here — keep the diff minimal.
- **No new STRINGS entries.** The `CONTEXT_MISSING` for annotations surfaces
  through the existing `err.llmRunBlock` mapping (line 2742) with the
  message produced in `src/llm-runner.js`.

**Per-slice acceptance**:
- `npm run build` succeeds (the `.xpi` is produced in `.scaffold/build/`).
- No syntax errors; `gatherAnnotations` and `buildItemData` are called with
  the correct `win`/options.
- (Manual / integration) In a running Zotero, a note with
  `{% llm context="annotations" %}Summarize the highlights{% endllm %}` on
  an item that has PDF annotations produces a grounded summary; an item with
  no usable annotations shows the `err.llmRunBlock` status with the
  "no usable annotations" message. Integration testing is out of scope
  unless trivial.

---

### Slice 4 — Core re-export (`core/core.js`) — recommended

**Depends on**: Slice 1. **Allowed scope**: `core/core.js` only.

**Steps**: add `renderAnnotationsContext` to the `annotations.js` re-export
line (line 8):
```js
export { renderAnnotationsSection, renderAnnotationsContext, mapZoteroAnnotation } from "../src/annotations.js";
```

**Why**: Not strictly required for function (esbuild follows the
`llm-runner.js → annotations.js` import when bundling `ZONCore`, so
`prepareLLMRun` can call the formatter internally without it being a named
`ZONCore` export). But every other `src/annotations.js` export is surfaced
via `ZONCore`, so adding it keeps the re-export complete and lets future
bootstrap code call `ZONCore.renderAnnotationsContext` if needed. Low risk,
one line.

**Per-slice acceptance**: `npm run build` succeeds; the bundle still loads
(`ZONCore.renderAnnotationsContext` is defined if inspected).

---

### Slice 5 — Verification

**Depends on**: all prior slices.

**Commands** (run from repo root):
1. `npm test` — full Vitest suite. Expect: all `test/*.spec.js` pass,
   including updated `llm-runner.spec.js`, `annotations.spec.js`, and
   untouched `blocks.spec.js` / `merge.spec.js` / etc.
2. `npm run build` — packages the `.xpi` into `.scaffold/build/`. Expect:
   success, no build config errors, new export bundled.
3. (Optional, if a dev `.env` is present) `npm run test:zotero` — Mocha
   integration. Not required for this issue (no integration test added) but
   should not regress.

**Regression watchlist**:
- `test/llm-runner.spec.js` — abstract path byte-identical (esp. the exact
  user-message test at line 533-539).
- `test/annotations.spec.js` — `renderAnnotationsSection` / merge idempotence
  unchanged after the `sortAnnotations` extraction.
- `test/llm-blocks.spec.js` — parser untouched (`SUPPORTED_CONTEXTS`
  unchanged).

---

## Risks & rollback

- **Test breakage in Slice 2 is the highest risk.** Four existing tests
  assume `annotations` is unsupported; missing one leaves a red suite.
  Mitigation: the slice enumerates all four (lines 38-42, 358-363, 380-385,
  472-486, 505-519) and the executor must update each. Run
  `npx vitest run test/llm-runner.spec.js` after the slice.
- **`sortAnnotations` extraction** touches existing tested code
  (`renderAnnotationsSection`). Risk is low (pure refactor, identical
  comparator) and guarded by existing ordering/merge tests. If any
  regression appears, revert to an inline comparator in
  `renderAnnotationsContext` and leave `renderAnnotationsSection` untouched.
- **Formatter output stability**: the exact markdown shape is a contract the
  new tests pin. Changing whitespace/structure later would break tests and
  shift model behavior. Keep the `parts.join("\n\n")` / `blocks.join("\n\n")`
  structure.
- **`""` ⟺ no-usable contract**: the resolver treats an empty formatter
  result as `CONTEXT_MISSING`. This is safe because any usable annotation
  yields at least a header line. Do not introduce an annotation that
  produces an empty block.
- **Bootstrap not unit-tested**: the `runLLM` change is build-verified only.
  A typo in the `gatherAnnotations`/`buildItemData` wiring would surface at
  runtime, not in CI. Mitigation: keep the diff to 2-3 lines, mirror the
  Refresh path's usage, and rely on the existing `gatherAnnotations` method
  unchanged.
- **`core/core.js` re-export** (Slice 4) is optional; if it causes any
  bundle issue, drop it — functionality does not depend on it.
- **Rollback**: all changes are confined to 5 known files. `git revert` the
  slices (or the feature commit) restores `RUNNABLE_CONTEXTS = ["abstract"]`
  and the prior test expectations. No data/format migrations, no manifest
  changes, no on-disk note format changes.

---

## Acceptance checklist (mirrors the issue)

- [ ] 1. `context="annotations"` is accepted by Run LLM and participates in
      the same all-or-nothing execution path as abstract context.
- [ ] 2. Annotation context includes all PDF annotations gathered by the
      existing `gatherAnnotations` flow (wired in `runLLM`).
- [ ] 3. Annotation context is formatted as structured markdown sorted in
      Zotero/PDF order (by `sortIndex` then key).
- [ ] 4. Annotation context includes page labels, annotation type/color,
      quoted text, and comments where present.
- [ ] 5. Image annotations contribute comments when comments are present.
- [ ] 6. Image-only annotations (no text AND no comment) are omitted from
      text context and do not count as available annotation context.
- [ ] 7. The LLM call fails clearly (`CONTEXT_MISSING`) when annotations
      context is requested but no usable text/comment annotations exist.
- [ ] 8. Focused Vitest tests cover: structured annotation formatting,
      ordering, comments, image-comment inclusion, image-only omission, and
      missing-annotations failure.
- [ ] `npm test` passes (no regressions in abstract/blocks/merge tests).
- [ ] `npm run build` succeeds.
