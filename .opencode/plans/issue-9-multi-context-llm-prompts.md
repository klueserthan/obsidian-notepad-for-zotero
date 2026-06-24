# Issue #9 — Multi-context LLM prompts

Plan for implementing comma-separated multi-context LLM blocks (e.g.
`context="abstract,annotations"`) in the obsidian-notepad-for-zotero plugin.

## Context & goals

The LLM block parser (`src/llm-blocks.js`) already accepts comma-separated
context lists and emits a `contexts` array per block. The runner
(`src/llm-runner.js`) currently rejects any block whose `contexts.length !== 1`
with `CONTEXT_UNSUPPORTED`. Issue #9 asks the runner to *accept* multi-context
blocks, resolve each requested context in template order, label each section in
the assembled user message, enforce the combined character limit on the
concatenated context (excluding the task prompt), and fail the whole block if
any one requested source is missing.

Goals:

- Multi-context blocks run end-to-end through `prepareLLMRun` →
  `executeLLMBlocks` → `runLLM` (bootstrap) with no signature changes.
- Single-context behavior is byte-for-byte unchanged (same messages, same
  error codes, same `contextLabel`).
- All-or-nothing sequential execution is untouched.

Out of scope (per issue): new context types, chunking/summarization over the
limit, fallback from missing to available contexts, changes to
`src/llm-blocks.js`, changes to `executeLLMBlocks`.

## Affected files

| File | Change |
| --- | --- |
| `src/llm-runner.js` | Rewrite context resolution + size enforcement + message assembly in `prepareLLMRun`; extend `buildLLMMessages` (or add a sibling) to label sections. |
| `test/llm-runner.spec.js` | Replace the two `CONTEXT_UNSUPPORTED` multi-context tests (lines ~359–376) with acceptance tests; add the four focused scenarios. |

Unchanged (verified): `src/llm-blocks.js`, `src/annotations.js`,
`src/fulltext.js`, `addon/bootstrap.js` (uses `task.messages` and
`b.contexts.includes("fulltext")` — both already multi-context-safe),
`executeLLMBlocks`, `applyLLMOutputs`, `decideLLMAction`.

## Design decisions

### Labeling format

Use a Markdown heading per section, in template order:

```
## Context: abstract
<abstract text>

## Context: annotations
<annotations text>
```

Sections joined by a blank line. This is clear, simple, and survives as Markdown
if the model echoes structure. The single-context path produces the *same*
labeled output (so single-context messages change slightly — see risk below).

### `contextLabel` on the task object

Today `tasks.push({ block, messages, contextLabel })` where `contextLabel` is a
single string. For multi-context, set `contextLabel` to the comma-joined list
(`block.contexts.join(", ")`) — matches the existing `error.message` style and
keeps the task object shape stable. No consumer reads `contextLabel` for
behavior; it's diagnostic only.

### Combined character limit

`maxContextChars` applies to the **concatenated, labeled** context text
*excluding* the task prompt. The label headings count toward the limit (simple,
deterministic, no special-casing). This matches the issue's "combined context
sections, excluding the task prompt" wording.

### Missing-context semantics

If **any** requested context resolves to empty/missing, the **entire block**
fails with `CONTEXT_MISSING` (no partial assembly, no provider call). The error
message names the first missing context kind (keeps messages actionable and
keeps the existing "static message, no prompt body" test pattern working).

## Steps (phased)

### Phase 1 — `src/llm-runner.js`

1. **Extract a per-kind resolver.** Add a small helper
   `resolveContext(kind, itemData)` returning `{ text, missingReason }`:
   - `abstract`: `text = String(itemData?.abstractNote ?? "").trim()`;
     `missingReason = "abstract is empty for this item"` if empty.
   - `annotations`: `text = renderAnnotationsContext(itemData?.annotations || [])`;
     `missingReason = "no usable annotations for this item"` if empty.
   - `fulltext`: `text = renderFulltextContext(itemData)`;
     `missingReason = "no extracted full text available for the primary PDF"` if empty.
   - unknown kind (defensive): `missingReason = "context '<kind>' is not yet supported by Run LLM (only 'abstract', 'annotations', 'fulltext')"`, `text = ""`, treat as `CONTEXT_UNSUPPORTED`.

   This collapses the existing `if/else if` chain into one reusable function and
   keeps the missing-context messages identical to today's.

2. **Rewrite the per-block loop body** in `prepareLLMRun` (lines 77–196):

   - **Remove** the `block.contexts.length !== 1` guard (lines 79–91). Replace
     with a validation pass: every `kind` in `block.contexts` must be in
     `RUNNABLE_CONTEXTS`; if any isn't, return `CONTEXT_UNSUPPORTED` with the
     existing message format naming `block.contexts.join(", ")`.
   - Iterate `block.contexts` **in array order** (parser preserves template
     order — see `parseLLMContext` line 46). For each kind, call
     `resolveContext`. If any returns a `missingReason`, return
     `CONTEXT_MISSING` immediately with `message` = `"<missingReason> — cannot run with context='<raw>'"`,
     where `<raw>` is `block.contexts.join(",")`. Use the **first** missing
     kind encountered (template order) for the message.
   - Build `contextSections`: array of `## Context: <kind>\n<text>` strings.
   - `contextText = contextSections.join("\n\n")`.
   - **Size enforcement** (replaces lines 159–172): if
     `contextText.length > maxContextChars`, return `CONTEXT_TOO_LARGE` with
     message `` `context is ${contextText.length} characters, exceeds the configured limit of ${maxContextChars} — reduce the context or raise maxContextChars` ``
     (identical wording to today).
   - Prompt rendering (lines 174–191) is **unchanged** — still
     `render(block.body, itemData)`, same `RENDER_FAILED` handling.
   - `contextLabel = block.contexts.join(", ")`.
   - `messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, contextText)`.

3. **`buildLLMMessages`** (lines 41–49): leave the signature and the
   `Task:\n${task}\n\nContext:\n${ctx}` wrapper **unchanged**. The labels live
   inside `ctx` (produced by the loop), so the assembler stays generic. This
   keeps the existing `buildLLMMessages` unit tests green.

### Phase 2 — `test/llm-runner.spec.js`

4. **Replace** the `describe("prepareLLMRun — context unsupported")` block
   (lines 359–376). Keep one test asserting `CONTEXT_UNSUPPORTED` for an
   **unknown** context kind (e.g. `context="abstract,bogus"`), since that path
   is still rejected. Drop the two tests that asserted *valid* multi-context
   (`abstract,annotations`) is rejected.

5. **Add** a new `describe("prepareLLMRun — multi-context")` block with the
   four focused scenarios from acceptance criterion 7:

   a. **Template-order preservation.** Block `context="annotations,abstract"`
      on the fixture `item` (which has both). Assert `result.ok === true`,
      `result.tasks[0].messages[1].content` contains
      `## Context: annotations` **before** `## Context: abstract` (use
      `indexOf`). Also assert the abstract section text equals
      `item.abstractNote` and the annotations section contains the fixture's
      first highlight `annotatedText`.

   b. **Missing one-of-many fails the block.** Block
      `context="abstract,fulltext"` on the default fixture (which has no
      `fulltext`). Assert `result.ok === false`,
      `result.code === LLM_RUN_ERRORS.CONTEXT_MISSING`, and
      `result.errors[0].message` mentions fulltext. Confirm no provider call
      is possible (i.e. `result.tasks` is empty — the run aborts pre-flight).

   c. **Combined character limit.** Block `context="abstract,annotations"`
      with `opts.maxContextChars` set just above `abstract.length` but below
      `abstract.length + annotations.length` (compute from the fixture).
      Assert `result.ok === false`,
      `result.code === LLM_RUN_ERRORS.CONTEXT_TOO_LARGE`, and the message
      reports the combined length. Add a companion assertion that the same
      block **passes** when `maxContextChars` is large enough (sanity check
      that the limit is on the *combined* text, not per-section).

   d. **Labeled multi-context prompt assembly.** Block
      `context="abstract,annotations"` on the fixture. Assert
      `result.tasks[0].messages[1].content` matches the exact expected shape:
      ```
      Task:
      <rendered body>

      Context:
      ## Context: abstract
      <abstractNote>

      ## Context: annotations
      <rendered annotations>
      ```
      Use a regex or `toContain` for each label + section; assert exactly two
      `## Context:` headings appear, in order.

6. **Regression guard.** Add one test confirming single-context
   `context="abstract"` still produces a **labeled** section
   (`## Context: abstract`) — documents that single-context now also gets a
   label (behavior change, see Risks). Update any existing single-context test
   that asserts the *unlabeled* `Context:\n<text>` shape if one exists (scan
   the file for `Context:\n` assertions before editing).

### Phase 3 — verification

7. Run `npx vitest run test/llm-runner.spec.js` — all green.
8. Run `npm test` — full suite green (no other test files touch
   `prepareLLMRun` message shape, but `test/llm-blocks.spec.js` is parser-only
   and unaffected).
9. (Optional, if a dev Zotero profile is configured) `npm run test:zotero` —
   integration tests don't exercise LLM context assembly, so this is a
   smoke check only.

## Risks & rollback

- **Single-context message shape changes.** Today single-context emits
  `Context:\n<text>` (no label). After this change it emits
  `Context:\n## Context: abstract\n<text>`. This is intentional (uniformity)
  and called out in the issue ("clearly labels each requested context section"),
  but it *is* a user-visible change to the prompt for existing single-context
  users. **Mitigation:** acceptable per issue wording; document in the test at
  step 6. If the maintainer prefers zero-change for single-context, branch the
  assembler: label only when `block.contexts.length > 1`. Flag this as the one
  open decision.

- **Label characters count toward the limit.** A block that fit before might
  now exceed `maxContextChars` by a few bytes per section. **Mitigation:**
  labels are tiny (`## Context: abstract\n` ≈ 22 chars); the existing
  `CONTEXT_TOO_LARGE` path handles it gracefully with the same message. No
  action needed beyond the test at step 5c.

- **`contextLabel` semantics shift** from a single kind to a comma-joined list.
  No code reads it for behavior (grep-confirmed: only `tasks.push` writes it;
  `executeLLMBlocks` and `runLLM` read `task.messages`, not `contextLabel`).
  Low risk.

- **Rollback.** The change is confined to one function body in
  `src/llm-runner.js` plus tests. Revert the commit to restore the
  `length !== 1` guard and the unlabeled single-context shape. No data
  migration, no persisted state.

## Testing & verification playbook

```bash
# Focused
npx vitest run test/llm-runner.spec.js

# Full unit suite (no Zotero needed)
npm test

# Build sanity (catches any accidental config drift)
npm run build
```

Manual smoke (optional, needs `.env` + dev profile):

1. `npm start`
2. Open an item with both an abstract and PDF annotations.
3. Add a note containing:
   ```
   {% llm context="abstract,annotations" %}
   Summarize how the abstract and annotations relate.
   {% endllm %}
   ```
4. Run LLM; confirm the status banner shows progress and the block is replaced.
5. Repeat with `context="abstract,fulltext"` on an item with **no** extracted
   full text; confirm a `CONTEXT_MISSING`-style error status (no provider call).

## Acceptance checklist

- [ ] LLM blocks accept comma-separated context lists such as `context="abstract,annotations"` and `context="abstract,fulltext"`.
- [ ] Context sections are assembled in the exact order written in the template.
- [ ] Every requested context is required; if any requested source is missing, the LLM run fails without provider calls for that block.
- [ ] The max context character limit applies to the combined requested context sections, excluding the task prompt.
- [ ] The assembled user message clearly labels each requested context section.
- [ ] Multi-context blocks participate in the same sequential, all-or-nothing Run LLM behavior as single-context blocks.
- [ ] Focused tests cover template-order preservation, missing one-of-many context failure, combined character limit enforcement, and labeled multi-context prompt assembly.
- [ ] `npm test` passes with all existing tests still green (except the two updated multi-context rejection tests).
- [ ] Single-context blocks continue to work unchanged (modulo the labeled-section shape noted in Risks).
- [ ] No changes to `src/llm-blocks.js` or `executeLLMBlocks`.