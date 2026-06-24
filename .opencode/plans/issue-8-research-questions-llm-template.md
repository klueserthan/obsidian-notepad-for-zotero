# Plan — Issue #8: Ship the `research-questions` LLM template and docs

Status: draft · Owner: plan-runner · Repo: `obsidian-notepad-for-zotero` (Zotero 7 plugin, AGPL-3.0)

---

## Summary

GitHub issue #8 asks to ship the first built-in LLM interpreter template
(`research-questions`) and document how users write and run LLM blocks. The LLM
interpreter itself is already fully implemented (block parser, run planner,
OpenAI-compatible provider, fulltext context, Nunjucks extension — blockers #5
and #6 are closed). What's missing is: (a) one built-in template that
demonstrates the `{% llm context="fulltext" %}` workflow, (b) user-facing and
developer-facing documentation of the LLM block syntax and behaviour, and (c) a
README feature mention. No interpreter, classification, or provider code
changes are required — the existing `hasLLMBlocks()` check already auto-
classifies any template containing `{% llm %}` as a once-per-item "document"
template.

The work is small and concentrated in four files: `addon/bootstrap.js` (add one
template string + extend the starter doc string), `docs/TEMPLATES.md` (add an
LLM section), `README.md` (add one feature bullet), and
`test/builtin-templates.spec.js` (add the 8th template name + a classification
assertion). The template addition and the test update are tightly coupled — the
existing test asserts the *exact* set of 7 built-in names, so adding an 8th
without updating the test breaks `npm test`. They MUST land in the same slice.

---

## Context & goals

### Verified facts (read from source, not assumed)

**Built-in templates (`addon/bootstrap.js`)**
- `BUILTIN_TEMPLATES` object literal at lines 91–163. Currently 7 keys:
  `note`, `note-minimal` (whole-note scaffolds), `abstract`, `critique`,
  `key-quote`, `highlight`, `snapshot` (per-annotation / field formats). Each
  value is a template string with `\n` escapes. The object closes with `},` at
  line 163; the last entry (`snapshot`) ends at line 162.
- `BUILTIN_TEMPLATES_DOC` string at lines 168–186. Written as `TEMPLATES.md`
  into the user's Templates folder. Currently explains two kinds of templates,
  naming, and Nunjucks basics. Does NOT mention LLM blocks. This is the
  "starter template documentation copied into user template folders" (AC #6).
- `installBuiltinTemplates(dir)` at line 1888 iterates
  `Object.keys(this.BUILTIN_TEMPLATES)` and writes each as `<name>.md` via
  `writeIfAbsent()` (idempotent, never overwrites user edits). It also writes
  `TEMPLATES.md` from `BUILTIN_TEMPLATES_DOC` (line 1901). **Adding a new key
  to `BUILTIN_TEMPLATES` automatically gets it installed into every user's
  Templates folder on next init — no install-loop change needed.**
- `loadTemplates()` at line 577 calls `addBuiltins(out)` (line 595) which
  iterates `BUILTIN_TEMPLATES` and classifies each via `templateKindOf()`.
  User-folder files of the same name override afterwards (line 597). **Adding a
  new key auto-registers it in the template list / dropdown.**
- Files filtered from loading (line 587): `if (/^(templates|readme)$/i.test(name)) continue;`
  — so `TEMPLATES.md` (stem `TEMPLATES`) is skipped and never loaded as a template.

**Template classification (auto — no logic change needed)**
- `src/templates.js` `templateKind()` lines 52–58: returns `"document"` if YAML
  frontmatter OR `%% zon` marker OR `hasLLMBlocks(text)`. Otherwise `"format"`.
  The `hasLLMBlocks` branch (line 56) is the key: any template with `{% llm %}`
  is auto-classified as `"document"` (once-per-item).
- `addon/bootstrap.js` `templateKindOf()` lines 545–551: the privileged-scope
  mirror. Checks `/\{%\s*llm\b/` at line 549 → returns `"document"`. Both
  classifiers agree; no change needed.
- `src/llm-blocks.js` line 58: `hasLLMBlocks(text)` returns
  `/\{%\s*llm\b/.test(String(text || ""))` — a cheap boolean.

**LLM interpreter (already implemented — read-only, do NOT change)**
- `src/llm-blocks.js` line 7: `SUPPORTED_CONTEXTS = ["abstract", "annotations", "fulltext"]`.
  `parseLLMBlocks()` validates: `context="..."` required (else `llm.missingContext`),
  non-empty (else `llm.emptyContext`), each context in `SUPPORTED_CONTEXTS` (else
  `llm.unknownContext`), body non-empty (else `llm.emptyBody`), not in frontmatter
  (else `llm.inFrontmatter`), not inside `%% zon %%` live blocks (else
  `llm.inLiveBlock`), no unclosed/stray tags. Comma-separated contexts
  (`context="abstract,fulltext"`) are **parsed and validated** as valid syntax.
- `src/llm-runner.js` line 28: `RUNNABLE_CONTEXTS = ["abstract", "annotations", "fulltext"]`.
  `prepareLLMRun()` (line 61): guard at line 79 rejects multi-context blocks
  (`block.contexts.length !== 1` → `CONTEXT_UNSUPPORTED`). `fulltext` resolver
  (lines 129–143) calls `renderFulltextContext(itemData)`; empty →
  `CONTEXT_MISSING`. All-or-nothing: first failure → `{ok:false, tasks:[]}`, no
  write, no silent fallback. `executeLLMBlocks()` (line 220): HTTP failure or
  empty response aborts the whole run.
- `src/render.js` lines 43–65: `LLMExtension` Nunjucks extension. Renders the
  prompt body (resolving `{{variables}}` against item data) then reconstructs
  `{% llm context="..." %}\n<rendered body>\n{% endllm %}` as a `SafeString`.
  Undefined Nunjucks variables render as empty string (`autoescape: false`,
  line 69). **`render()` does NOT need `fulltext` in the data — it just
  preserves the block.** This is why the existing render-no-throw test will
  still pass for the new template even though the test's `SAMPLE` fixture has
  no `fulltext` field.
- `src/llm.js` lines 25–34: `LLM_DEFAULTS = { baseURL: "http://localhost:11434/v1"
  (Ollama default), model: "", apiKey: "", temperature: 0.2, maxTokens: 2048,
  maxContextChars: 100000, timeoutSeconds: 60, autoRun: false }`.
  `isLLMConfigured()` (line 36) requires non-empty `baseURL` + `model`.
  `canAutoRun()` (line 43) requires configured + `autoRun`. OpenAI-compatible
  Chat Completions (`/chat/completions`). BYOK: user supplies their own
  `baseURL` + `model` + optional `apiKey`.
- `src/fulltext.js` line 5: `renderFulltextContext(itemData)` reads
  `itemData.fulltext` (`{ok, text, attachmentTitle}`); returns `""` if
  missing/empty. The plugin never does its own PDF extraction — it reads
  Zotero's already-extracted `.zotero-ft-cache`.

**Documentation files**
- `docs/TEMPLATES.md` — 114 lines, developer-facing reference. Explains
  variables, `%%!` directive, `%% zon %%` blocks, example templates. Does NOT
  mention LLM blocks. **This is where the full LLM documentation goes (AC #5).**
- `README.md` — 145 lines. `## Features` heading at line 35; 6 bullet points
  (lines 37–49). No LLM mention. **Need to add one feature bullet (AC #7).**
  The Templates section (lines 78–85) links to `docs/TEMPLATES.md`.

**Existing tests**
- `test/builtin-templates.spec.js` (65 lines) — extracts `BUILTIN_TEMPLATES`
  from `bootstrap.js` source via `eval()`. Asserts: (a) exactly 7 expected
  names sorted (line 39: `["abstract", "critique", "highlight", "key-quote",
  "note", "note-minimal", "snapshot"]`); (b) classification — `note` /
  `note-minimal` as `"document"`, the 5 others as `"format"` (lines 43–49);
  (c) every template renders without throwing (lines 51–56, iterates all
  builtins); (d) the `note` scaffold renders frontmatter + body + zon block
  (lines 58–64). **This test MUST be updated** to add `"research-questions"`
  to the names array and assert it classifies as `"document"`. The render
  test (c) automatically covers the new template (it iterates all builtins).
- `test/templates.spec.js` lines 49–61 — already tests `templateKind()` with
  LLM blocks as `"document"`. No change needed.
- `test/llm-blocks.spec.js` (562 lines), `test/llm-runner.spec.js`,
  `test/render.spec.js`, `test/fulltext.spec.js` — comprehensive LLM tests
  already exist. No change needed.
- `test/fixtures/data.js` — sample item has `abstractNote`, `annotations`, but
  no `fulltext` field. Irrelevant to the render-no-throw test (LLMExtension
  doesn't read `fulltext`).

### Goals

1. Add a built-in `research-questions` template that demonstrates the
   `{% llm context="fulltext" %}` workflow — a once-per-item template using
   primary-PDF full text.
2. Document the LLM block syntax and behaviour in both the developer reference
   (`docs/TEMPLATES.md`) and the user-copied starter guide
   (`BUILTIN_TEMPLATES_DOC` in `addon/bootstrap.js`).
3. Add a README feature mention for BYOK OpenAI-compatible LLM-assisted
   templates.
4. Update `test/builtin-templates.spec.js` so the 8th template is expected,
   classified as `"document"`, and verified to contain the exact heading and
   prompt.

### Non-goals (explicit)

- Do NOT change LLM interpreter behaviour, classification logic, or provider
  code (`src/llm-blocks.js`, `src/llm-runner.js`, `src/llm.js`, `src/render.js`,
  `src/fulltext.js` are read-only).
- Do NOT add more built-in LLM templates — just `research-questions`.
- Do NOT add UI strings to `STRINGS` — the template/docs content is content,
  not UI chrome.
- Do NOT change `addon/manifest.json` or the FTL file.

---

## Steps / phased approach

This is a single small slice. The template addition and the test update MUST be
in the same commit/slice because the test asserts the exact set of built-in
names. The documentation edits are independent and can be in the same slice or
split, but there's no reason to split — the whole change is ~one file of code +
three files of docs.

### Step 1 — Add the `research-questions` template to `BUILTIN_TEMPLATES`

**File:** `addon/bootstrap.js`
**Location:** Insert a new key after the `snapshot` entry (after line 162,
before the closing `},` at line 163).

Add this entry (matching the existing style — backtick template string with
literal newlines, NOT `\n` escapes, since the existing entries use real
newlines inside backticks):

```js
    "research-questions": `## Research Questions

{% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}
`,
```

**Verification of exact content (AC #1–4):**
- Heading: `## Research Questions` (AC #2). ✓
- `context="fulltext"` (AC #3). ✓
- Prompt: `What is/are the research question(s) the paper answers? Render as concrete bullet points.` (AC #4). ✓
- No YAML frontmatter, no `%%!` directive, no `%% zon %%` block — but
  `hasLLMBlocks()` returns `true` → `templateKind()` returns `"document"` →
  once-per-item (AC #1). ✓

**Why this auto-classifies as once-per-item:** `templateKind()` in
`src/templates.js` line 56 checks `hasLLMBlocks(t)` after the frontmatter and
zon checks. `hasLLMBlocks()` matches `/\{%\s*llm\b/` against
`{% llm context="fulltext" %}` → `true` → returns `"document"`. The
privileged-scope mirror `templateKindOf()` in `bootstrap.js` line 549 does the
same. No classification logic change needed.

**Why it auto-installs and auto-loads:** `installBuiltinTemplates()` iterates
`Object.keys(this.BUILTIN_TEMPLATES)` (line 1898) → writes
`research-questions.md` via `writeIfAbsent()`. `addBuiltins()` (line 604) does
the same iteration → classifies via `templateKindOf()` → registers as
`{kind:"document", text}` in the template map. The filename stem
`research-questions` does not match `/^(templates|readme)$/i` → not filtered.

### Step 2 — Update `test/builtin-templates.spec.js`

**File:** `test/builtin-templates.spec.js`

Three edits:

**(a) Update the "ships exactly the expected set" test (line 37–41).**
Add `"research-questions"` to the expected names array (now 8 names, sorted):

```js
  it("ships exactly the expected set", () => {
    expect(Object.keys(builtins).sort()).toEqual(
      ["abstract", "critique", "highlight", "key-quote", "note", "note-minimal", "research-questions", "snapshot"]
    );
  });
```

**(b) Update the classification test (lines 43–49).**
Add an assertion that `research-questions` is `"document"`:

```js
  it("classifies note scaffolds as documents and the rest as formats", () => {
    expect(templateKind(builtins["note"])).toBe("document");
    expect(templateKind(builtins["note-minimal"])).toBe("document");
    expect(templateKind(builtins["research-questions"])).toBe("document");
    for (const n of ["abstract", "critique", "key-quote", "highlight", "snapshot"]) {
      expect(templateKind(builtins[n])).toBe("format");
    }
  });
```

**(c) Add a focused content test (new `it` block after the classification
test).** This directly verifies AC #2, #3, #4 against the shipped string:

```js
  it("research-questions ships the exact heading, context, and prompt", () => {
    const t = builtins["research-questions"];
    expect(t).toContain("## Research Questions");
    expect(t).toContain('{% llm context="fulltext" %}');
    expect(t).toContain("{% endllm %}");
    expect(t).toContain(
      "What is/are the research question(s) the paper answers? Render as concrete bullet points."
    );
  });
```

**Note on the render-no-throw test (lines 51–56):** It iterates all builtins
and calls `render(body, SAMPLE)`. For `research-questions`, `render()` invokes
`LLMExtension`, which renders the prompt body (no `{{variables}}` → literal
text) and wraps it back in `{% llm context="fulltext" %}\n…\n{% endllm %}`. The
`SAMPLE` fixture has no `fulltext` field, but `LLMExtension` doesn't read it —
it only preserves the block. **No throw. No change needed to this test.**

### Step 3 — Add the LLM section to `docs/TEMPLATES.md`

**File:** `docs/TEMPLATES.md` (developer-facing reference, 114 lines)
**Location:** Append a new top-level section after the existing content (after
line 114). This is where AC #5's full documentation goes.

The new section must cover all nine topics from AC #5. Proposed content
(adapt wording, but cover every topic):

```markdown
---

## LLM-assisted templates (`{% llm %}` blocks)

A template can ask a language model to fill in a section. Add an **LLM block**
anywhere in the note body:

```
## Research Questions

{% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}
```

When you run the note through the LLM interpreter, each block's prompt is sent
to your configured model with the requested context, and the block is replaced
in-place by the model's Markdown output. A template containing any `{% llm %}`
block is automatically treated as a **once-per-item** (document) template — it
is never rendered once per annotation.

### Syntax

```
{% llm context="<ctx>" %}<prompt>{% endllm %}
```

- `context="..."` — **required**. What the model is allowed to see.
- `<prompt>` — the task, written in plain prose. May use `{{variables}}`
  (resolved from the item's data when the note is rendered). Must be non-empty.
- `{% endllm %}` — **required** closing tag.

### Supported contexts

| Context       | What it feeds the model                                       |
|---------------|---------------------------------------------------------------|
| `abstract`    | the item's `abstractNote` field                               |
| `annotations` | the item's PDF annotations, rendered to text                  |
| `fulltext`    | the primary PDF's already-extracted full text (`.zotero-ft-cache`) |

### Comma-separated contexts

You may list more than one context, comma-separated:

```
{% llm context="abstract,annotations" %}Summarise.{% endllm %}
```

The syntax is valid and the block is preserved through rendering, but **Run
LLM currently executes single-context blocks only.** A multi-context block
fails with a clear `context unsupported` error at run time — it does not
silently degrade.

### Unresolved placeholders

`{{variables}}` in the prompt body are resolved by Nunjucks against the item's
data when the note is rendered. An undefined variable renders as **empty
string** (Nunjucks default). Use variables that exist in the item data
(`{{title}}`, `{{abstractNote}}`, `{{citekey}}`, … — see the variable tables
above); otherwise the prompt silently loses that text.

### Run LLM

With an LLM configured (Settings → Obsidian Notes → LLM), open a note
containing `{% llm %}` blocks and choose **Run LLM**. Each block is executed
in document order and replaced by the model's output. The run is
**all-or-nothing**: if any block fails, nothing is written and the original
blocks are left intact.

### Auto-run

If **Auto-run LLM** is enabled (and the LLM is configured), LLM blocks run
automatically when a note is created from a template or refreshed — no manual
click. With auto-run off, blocks are preserved as-is in the note until you run
them yourself.

### Missing-context failure

If the requested context is empty for an item (no abstract, no annotations, or
no extracted full text for the primary PDF), the run **fails with a clear
error** naming the missing context. It does **not** fall back to a different
context or insert a placeholder.

### Where LLM blocks are allowed (body-only)

LLM blocks live in the **note body only**. They are rejected:

- in **YAML frontmatter** (`--- … ---`),
- inside **managed `%% zon %%` live blocks**,
- with an **empty body** (the prompt must be non-empty),
- with a **missing or empty** `context="..."`,
- with an **unknown** context (not one of the three above),
- if **unclosed** (missing `{% endllm %}`) or **stray** (close without open).

Any of these is a validation error — the block is not executed.

### No silent fallback

The interpreter never guesses. If anything goes wrong — a parse error, missing
context, an HTTP failure, an empty response — the whole run aborts, the note is
not modified, and the error is surfaced. There is no fallback to "remove the
block" or "insert a best-effort guess".

### BYOK (bring your own key)

The LLM provider is **OpenAI-compatible Chat Completions**. Point it at any
compatible endpoint — a local [Ollama](https://ollama.com) server (the
default, `http://localhost:11434/v1`), OpenAI, LM Studio, etc. — and set the
model name (and API key, if your endpoint requires one) in Settings. The plugin
does not ship a model or key; you bring your own.
```

### Step 4 — Extend `BUILTIN_TEMPLATES_DOC` with LLM syntax (AC #6)

**File:** `addon/bootstrap.js`
**Location:** `BUILTIN_TEMPLATES_DOC` string, lines 168–186. This is the short
guide written as `TEMPLATES.md` into the user's Templates folder.

Append a concise LLM subsection to the existing doc string (keep it shorter
than the developer reference — it's a starter guide, not the full spec; it
should point to `docs/TEMPLATES.md` for details). Add after the existing
"Templates are written in Nunjucks…" paragraph (before the closing backtick at
line 186):

```
A template can also ask a language model to fill in a section with an **LLM
block**:

    ## Research Questions

    {% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}

`context="..."` selects what the model sees: `abstract`, `annotations`, or
`fulltext` (the primary PDF's extracted text). The block is replaced by the
model's Markdown output when you run it. A template with any `{% llm %}` block
is automatically a once-per-item (whole-note) template. The LLM is
OpenAI-compatible and bring-your-own-key — configure it in Settings → Obsidian
Notes → LLM. Runs are all-or-nothing: if a block fails (missing context, HTTP
error, empty response) nothing is written and the error is shown — there is no
silent fallback. Full reference:
https://github.com/Acatechnic/obsidian-notepad-for-zotero/blob/main/docs/TEMPLATES.md
```

**Note:** The existing doc already ends with the `docs/TEMPLATES.md` URL. When
appending, either keep one URL at the very end or keep both — but don't
duplicate it awkwardly. Simplest: insert the LLM paragraphs before the existing
final "Full reference: …" line so the URL stays as the closing line.

### Step 5 — Add a README feature bullet (AC #7)

**File:** `README.md`
**Location:** `## Features` section, after the last bullet (line 49, the
"Safe by design." bullet). Add one bullet:

```markdown
- **LLM-assisted templates (BYOK).** Add a `{% llm context="fulltext" %}` block
  to a template and the plugin asks your own OpenAI-compatible model (local
  Ollama, OpenAI, LM Studio, …) to fill it in from the paper's abstract,
  annotations, or full text. Bring your own key/endpoint; runs are
  all-or-nothing with no silent fallback. See
  [docs/TEMPLATES.md](docs/TEMPLATES.md).
```

Keep it short — it's a feature mention, not a tutorial. The link points to the
full reference added in Step 3.

---

## Risks / rollback considerations

### Risks

1. **Test breakage if the template and test update are split.** The existing
   `test/builtin-templates.spec.js` asserts the *exact* sorted set of 7 names.
   Adding `research-questions` to `BUILTIN_TEMPLATES` without updating the test
   array makes `npm test` fail with an array-mismatch. **Mitigation:** the two
   edits are in the same slice (Steps 1 + 2). The plan explicitly couples them.

2. **`installBuiltinTemplates` writes `research-questions.md` into existing
   users' Templates folders.** This is by design (it's `writeIfAbsent`, so it
   only seeds the file for users who don't already have one). But existing
   beta users will see a new `research-questions.md` appear in their Templates
   folder on next plugin load. This is expected and desirable (it's the
   feature), but worth noting in release notes. **Not a risk to revert.**

3. **The `research-questions` template has no frontmatter.** It's a body-only
   document template (heading + LLM block). When used as a "Create note"
   template, the created note will have no frontmatter — just the heading and
   the un-run LLM block. This is fine: the user runs the LLM block, and the
   note is a section that gets inserted/created. If a user wants frontmatter,
   they'd copy the LLM block into their own `note-*.md` scaffold. **Not a
   blocker**, but the docs should make clear that `research-questions` is a
   section template, not a full-note scaffold.

4. **Comma-separated contexts documentation accuracy.** The parser accepts
   `context="abstract,fulltext"` as valid syntax, but `prepareLLMRun` rejects
   multi-context blocks with `CONTEXT_UNSUPPORTED`. The docs (Step 3) must say
   this honestly: valid syntax, not yet runnable. Misrepresenting it as
   "supported" would mislead users. **Mitigation:** the proposed doc text
   explicitly says "Run LLM currently executes single-context blocks only."

5. **`BUILTIN_TEMPLATES_DOC` is a JS string literal.** When editing it, watch
   for backticks or `${}` inside the added text — they'd break the template
   literal. The proposed LLM doc text uses indented code blocks (4-space
   indent) rather than triple-backtick fences to avoid closing the JS template
   literal. **Mitigation:** use 4-space-indented code blocks inside
   `BUILTIN_TEMPLATES_DOC`, or escape backticks if fences are preferred. The
   existing `BUILTIN_TEMPLATES_DOC` already uses backtick-escaped words like
   `\`note.md\`` — follow that escaping style.

6. **`docs/TEMPLATES.md` is a standalone Markdown file** (not a JS string), so
   triple-backtick fences are fine there. No escaping needed.

### Rollback

Every edit is additive and isolated:
- Remove the `"research-questions"` key from `BUILTIN_TEMPLATES` → template
  disappears from the built-in set and is no longer installed for new users
  (existing copies in user folders remain, which is fine — they're user-owned).
- Revert the test array to 7 names.
- Remove the LLM section from `docs/TEMPLATES.md` and the LLM paragraphs from
  `BUILTIN_TEMPLATES_DOC`.
- Remove the README bullet.

No schema, storage, or runtime-state migration is involved. The change is
purely content (template strings + docs + test expectations).

---

## Testing & verification playbook

### Unit tests (Vitest — no Zotero needed)

```bash
npm test
```

Expected: all green. Specifically:

- `test/builtin-templates.spec.js`:
  - "ships exactly the expected set" → 8 names including `research-questions`. ✓
  - "classifies note scaffolds as documents and the rest as formats" →
    `research-questions` is `"document"`. ✓ (AC #1, #8)
  - "every template renders through the engine without throwing" →
    `research-questions` renders without throwing (LLMExtension preserves the
    block; no `fulltext` needed in `SAMPLE`). ✓
  - new "research-questions ships the exact heading, context, and prompt" →
    asserts `## Research Questions`, `context="fulltext"`, `{% endllm %}`, and
    the exact prompt string. ✓ (AC #2, #3, #4)
- `test/templates.spec.js` — unchanged, still green (already covers
  `templateKind` with LLM blocks as `"document"`).
- `test/llm-blocks.spec.js`, `test/llm-runner.spec.js`, `test/render.spec.js`,
  `test/fulltext.spec.js` — unchanged, still green.

**Single-file focus:**
```bash
npx vitest run test/builtin-templates.spec.js
```

### Build verification

```bash
npm run build
```

Confirms the `BUILTIN_TEMPLATES` / `BUILTIN_TEMPLATES_DOC` string edits in
`bootstrap.js` don't break the scaffold build (no unescaped backticks, no
syntax errors). The `.xpi` is produced in `.scaffold/build/`.

### Integration tests (Mocha inside Zotero — optional, needs `.env`)

```bash
npm run test:zotero
```

Not strictly required for this change (no interpreter/classification logic
changed), but if a `.env` is configured it confirms `installBuiltinTemplates`
writes `research-questions.md` and `loadTemplates` surfaces it as a document
template. Per AGENTS.md, escalate here if the build config or shared contracts
were touched — they were not, so `npm test` + `npm run build` is the minimum
bar.

### Manual smoke test (in a running Zotero, optional)

1. `npm start` (needs `.env` with a dedicated dev profile).
2. Open an item with a PDF that has extracted full text.
3. Configure Settings → Obsidian Notes → LLM (e.g. local Ollama
   `http://localhost:11434/v1` + a model name).
4. Create a note from the `research-questions` template (or Insert it).
5. Confirm the note contains `## Research Questions` and the un-run
   `{% llm context="fulltext" %}…{% endllm %}` block.
6. Click **Run LLM**. Confirm the block is replaced by the model's bullet
   points. Confirm the template appears in the template list as a
   once-per-item template (not a per-annotation format).

---

## Acceptance criteria

All eight must be met. Each is mapped to the step that satisfies it and the
test/verification that proves it.

1. **A built-in `research-questions` template is available as a once-per-item
   template, not a per-annotation format.**
   → Step 1 adds the key to `BUILTIN_TEMPLATES`; `templateKind()` /
   `templateKindOf()` auto-classify it as `"document"` via `hasLLMBlocks()`.
   Proven by `test/builtin-templates.spec.js` classification assertion.

2. **The template includes `## Research Questions` as its heading.**
   → Step 1. Proven by the focused content test in Step 2(c).

3. **The template uses `context="fulltext"`.**
   → Step 1. Proven by the focused content test in Step 2(c).

4. **The template prompt is exactly: "What is/are the research question(s) the
   paper answers? Render as concrete bullet points."**
   → Step 1. Proven by the focused content test in Step 2(c).

5. **Template documentation explains `{% llm context="..." %}...{% endllm %}`,
   supported contexts, comma-separated contexts, unresolved placeholders, Run
   LLM, auto-run, missing-context failure, body-only restrictions, and no
   silent fallback.**
   → Step 3 adds a section to `docs/TEMPLATES.md` covering all nine topics.
   Verified by doc review.

6. **Starter template documentation copied into user template folders includes
   the LLM interpreter syntax and behavior.**
   → Step 4 extends `BUILTIN_TEMPLATES_DOC` (written as `TEMPLATES.md` into the
   user's Templates folder by `installBuiltinTemplates`). Verified by doc
   review + build.

7. **README includes a short feature mention for BYOK OpenAI-compatible
   LLM-assisted templates.**
   → Step 5 adds one bullet to `## Features`. Verified by doc review.

8. **Focused tests or existing template-loading tests verify the built-in
   template is classified once-per-item and appears in the template list
   without becoming a per-annotation format.**
   → Step 2 updates `test/builtin-templates.spec.js`: the names array includes
   `research-questions` (appears in the list), the classification test asserts
   it is `"document"` (once-per-item, not `"format"`). Proven by `npm test`.

### Definition of done

- All 8 acceptance criteria met.
- `npm test` passes (all Vitest suites green).
- `npm run build` succeeds (no string-literal syntax errors in `bootstrap.js`).
- The built-in `research-questions` template is classified as `"document"`
  (once-per-item), contains the exact heading and prompt, uses
  `context="fulltext"`, and appears in the template list.
- `docs/TEMPLATES.md` and `BUILTIN_TEMPLATES_DOC` cover all nine LLM topics.
- `README.md` has the BYOK LLM feature bullet.

---

## Files touched (summary)

| File | Change | AC |
|------|--------|----|
| `addon/bootstrap.js` | Add `"research-questions"` key to `BUILTIN_TEMPLATES` (after `snapshot`, before closing `},` at line 163). Extend `BUILTIN_TEMPLATES_DOC` string (lines 168–186) with LLM syntax paragraphs. | #1–4, #6 |
| `test/builtin-templates.spec.js` | Add `"research-questions"` to expected names array (line 39); add classification assertion (lines 43–49); add focused content test (new `it` block). | #8 |
| `docs/TEMPLATES.md` | Append "LLM-assisted templates" section covering all 9 topics. | #5 |
| `README.md` | Add one feature bullet to `## Features` (after line 49). | #7 |

No other files change. No `src/` logic changes. No `STRINGS`, FTL, or
`manifest.json` changes.
