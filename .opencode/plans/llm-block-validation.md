# Plan: Template-side LLM Block Validation & Preservation (no model calls)

**Issue:** #3 (child of #1 PRD)
**Status:** Ready for implementation
**Scope:** Recognize, validate, and preserve `{% llm context="..." %}...{% endllm %}` blocks in templates **without** executing any model calls. Validation runs at create/insert time; placeholders survive into the written note when auto-run is off.

---

## Context & Goals

Users can author or insert templates containing unresolved LLM blocks:

```
{% llm context="abstract,annotations" %}
Summarise the key arguments of this paper in 5 bullet points.
{% endllm %}
```

While `llmAutoRun` is disabled (the default — `DEFAULT_LLM_AUTORUN: false` in `addon/bootstrap.js:80`), the plugin must:

1. **Recognize** these blocks in template text (fenced-code-aware, frontmatter-aware, live-block-aware).
2. **Validate** syntax + placement at create/insert time — but **not** context availability (that is execution time, out of scope).
3. **Preserve** the unresolved `{% llm %}...{% endllm %}` placeholder verbatim into the rendered/written note so a later execution pass can find and fill it.
4. **Classify** any template containing an LLM block as a `"document"` (once-per-item), never a per-annotation `"format"`.

No network calls, no provider configuration, no context-availability checks. This is purely a parsing/validation/preservation layer.

### Supported context names (v1, from parent issue #1 PRD)

`abstract`, `annotations`, `fulltext` — exported as `SUPPORTED_CONTEXTS` from `src/llm-blocks.js`.

### Block syntax (body-only)

```
{% llm context="abstract" %}prompt text{% endllm %}
{% llm context="abstract,annotations" %}prompt text{% endllm %}
```

- `context=` attribute is **required** (single name or comma-separated list).
- Each name must be in `SUPPORTED_CONTEXTS`.
- The **body** (text between open and close tags) is the prompt; it must be non-empty.
- The body IS rendered through Nunjucks for variable substitution (`{{title}}` etc.), but the `{% llm %}`/`{% endllm %}` wrapper is reconstructed around the rendered body so the placeholder survives.

---

## Existing code the plan builds on

| File | Role | Relevant lines |
|------|------|----------------|
| `src/render.js` | Nunjucks env; `PersistExtension` (lines 21–34) is the **model** for the new `LLMExtension`. `makeEnv()` at line 36, `render()` at line 78. | 21–34, 36–75 |
| `src/templates.js` | `templateKind(text)` (line 51) classifies `"document"` vs `"format"`. | 51–56 |
| `src/blocks.js` | `OPEN_RE`/`CLOSE_RE` (lines 22–23), `parseBlocks(md)` (line 47) — line-by-line scanner pattern to mirror. | 22–23, 47–70 |
| `src/preview.js` | `eachBodyLine(s, cb)` (line 29) — the **only** fenced-code-aware line walker in the repo. `findFrontmatterRange` (line 19). | 19–49 |
| `src/llm.js` | Pure LLM HTTP client. `canAutoRun(settings)` (line 43) — used by bootstrap to gate auto-run. No block parsing here. | 43–45 |
| `core/core.js` | Re-export hub for `ZONCore` global. Line 19 re-exports `src/llm.js`. | 5–19 |
| `addon/bootstrap.js` | `templateKindOf` (line 531, mirrors `src/templates.js`), `loadTemplates` (562), `allTemplates` (601), `renderTemplateAsNote` (1973), `renderDocument` (1958), `insertTemplate` (2660), `createNote` (2051), `writeNoteForItem` (2011), `STRINGS` (354), `t()` (444). | — |
| `vitest.config.js` | `include: ["test/*.spec.js"]`, excludes `test/integration/**`. | 6–11 |

### Patterns to follow

- **Frontmatter regex** (used everywhere): `/^---\r?\n([\s\S]*?)\r?\n---/`
- **Fenced code detection** (from `preview.js:40–46`):
  ```js
  const fenceM = line.match(/^\s*(`{3,}|~{3,})/);
  if (fenceM) {
    if (!inFence) { inFence = true; fenceTok = fenceM[1][0]; }
    else if (fenceM[1][0] === fenceTok) { inFence = false; fenceTok = ""; }
    continue;
  }
  if (inFence) continue;
  ```
- **Nunjucks extension pattern** (from `PersistExtension` in `render.js:21–34`): `this.tags`, `this.parse(parser, nodes)`, `this.run(context, ...args, body)`, return `new nunjucks.runtime.SafeString(...)`.
- **Test convention**: `import { describe, it, expect } from "vitest"`, import from `../src/<module>.js`.

---

## Phased steps (implementable in serialized slices)

### Slice 1 — `src/llm-blocks.js` + `test/llm-blocks.spec.js` (pure parser/validator)

**New file: `src/llm-blocks.js`**

Pure ES module, no DOM, no Zotero, no nunjucks. The foundation — all other slices depend on this.

#### Exports & signatures

```js
// src/llm-blocks.js

export const SUPPORTED_CONTEXTS = ["abstract", "annotations", "fulltext"];

// Line-level regexes (mirrors the OPEN_RE/CLOSE_RE style in blocks.js).
// LLM open:  {% llm context="abstract,fulltext" %}
// LLM close: {% endllm %}
const LLM_OPEN_RE  = /^\s*\{%\s*llm\s+(.*?)\s*%\}\s*$/;
const LLM_CLOSE_RE = /^\s*\{%\s*endllm\s*%\}\s*$/;

// Parse the `context="..."` attribute from an open-tag's arg string.
// Returns { contexts: string[], raw: string } or null if no context attr.
export function parseLLMContext(argString) { ... }

// Cheap boolean: does `text` contain any LLM open tag (naive, no fence awareness)?
// Used by templateKind for fast classification. May false-positive inside fenced
// code — that's fine; templateKind only needs to know "might be a document".
export function hasLLMBlocks(text) { ... }

// Fenced-code + frontmatter + live-block-aware scanner.
// Returns { blocks, errors } where:
//   blocks: [{ openRaw, closeRaw, contextArg, contexts, body, lineFrom, lineTo }]
//   errors: [{ code, message, line }]
//
// `code` is one of:
//   "llm.inFrontmatter"   — LLM tag found inside YAML frontmatter
//   "llm.inLiveBlock"     — LLM tag found inside a %% zon %% managed block
//   "llm.inFencedCode"     — LLM-like text inside a fenced code block (WARNING only;
//                            not surfaced as an error by validateLLMBlocks — these
//                            are simply not counted as blocks)
//   "llm.unclosed"        — open tag with no matching {% endllm %}
//   "llm.strayClose"      — {% endllm %} with no preceding open
//   "llm.missingContext"  — open tag has no context= attribute
//   "llm.emptyContext"    — context="" (empty value)
//   "llm.unknownContext"  — a context name not in SUPPORTED_CONTEXTS
//   "llm.emptyBody"       — body between open/close is whitespace-only
export function parseLLMBlocks(text) { ... }

// Full validation. Returns { valid: boolean, errors, blocks }.
// Surfaces all parseLLMBlocks errors EXCEPT llm.inFencedCode (those are ignored,
// not errors). `blocks` is the array of valid blocks (empty if any errors).
export function validateLLMBlocks(text, opts = {}) { ... }
```

#### Scanner algorithm (line-by-line, single pass)

```
1. Detect frontmatter range via /^---\r?\n[\s\S]*?\r?\n---/. Record [fmStart, fmEnd].
2. Walk lines, tracking:
   - inFence (bool), fenceTok (char)  — via the preview.js fence regex
   - inLiveBlock (bool)               — via OPEN_RE/CLOSE_RE from blocks.js
   - openLLM (pending open or null)   — at most one open at a time (no nesting)
3. For each line:
   a. If inside frontmatter and line matches LLM_OPEN_RE or LLM_CLOSE_RE
      → push error "llm.inFrontmatter", continue.
   b. If line is a fence delimiter → toggle inFence, continue.
   c. If inFence and line matches LLM_OPEN_RE or LLM_CLOSE_RE
      → it's inside code; skip (do NOT count as a block, do NOT error).
   d. If line matches blocks.js OPEN_RE (%% zon ... %%)
      → set inLiveBlock = true, continue.
   e. If line matches blocks.js CLOSE_RE (%% /zon %%)
      → set inLiveBlock = false, continue.
   f. If inLiveBlock and line matches LLM_OPEN_RE or LLM_CLOSE_RE
      → push error "llm.inLiveBlock", continue.
   g. If line matches LLM_OPEN_RE:
      → if openLLM already pending → push error "llm.unclosed" for the previous,
        then start new open.
      → parse context arg via parseLLMContext; record openLLM = { openRaw, ... }.
   h. If line matches LLM_CLOSE_RE:
      → if no openLLM pending → push error "llm.strayClose".
      → else close the block: body = accumulated lines; validate context + body;
        push block or errors; clear openLLM.
4. After loop: if openLLM still pending → push error "llm.unclosed".
```

**Import note:** `src/llm-blocks.js` must NOT import from `src/blocks.js` (which pulls in nunjucks via `src/render.js`). Inline the `OPEN_RE`/`CLOSE_RE` regexes (same pattern `src/markers.js:34–35` uses to stay dependency-free). This keeps `llm-blocks.js` pure and bundleable anywhere.

#### `parseLLMContext(argString)` detail

```js
// argString e.g. 'context="abstract,fulltext"' or 'context = "abstract"'
const m = String(argString).match(/context\s*=\s*"([^"]*)"/);
if (!m) return null;
const raw = m[1].trim();
const contexts = raw.split(",").map(s => s.trim()).filter(Boolean);
return { contexts, raw };
```

(Also accept single quotes: `/context\s*=\s*["']([^"']*)["']/`.)

#### `hasLLMBlocks(text)` detail

```js
// Naive — no fence/frontmatter awareness. Used only for templateKind fast-path.
return /\{%\s*llm\b/.test(String(text || ""));
```

#### `validateLLMBlocks(text, opts)` detail

```js
const { blocks, errors } = parseLLMBlocks(text);
// Filter out llm.inFencedCode (informational, not an error).
const realErrors = errors.filter(e => e.code !== "llm.inFencedCode");
return { valid: realErrors.length === 0, errors: realErrors, blocks };
```

#### Test file: `test/llm-blocks.spec.js`

Comprehensive Vitest coverage. Import from `../src/llm-blocks.js`.

```js
import { describe, it, expect } from "vitest";
import {
  SUPPORTED_CONTEXTS, parseLLMContext, hasLLMBlocks,
  parseLLMBlocks, validateLLMBlocks,
} from "../src/llm-blocks.js";
```

**Test cases (each a separate `it`):**

1. **`SUPPORTED_CONTEXTS`** — equals `["abstract", "annotations", "fulltext"]`.
2. **`parseLLMContext`** —
   - `context="abstract"` → `{ contexts: ["abstract"], raw: "abstract" }`.
   - `context="abstract,fulltext"` → `{ contexts: ["abstract","fulltext"], raw: "abstract,fulltext" }`.
   - `context = "abstract"` (spaces) → parsed correctly.
   - `context='abstract'` (single quotes) → parsed correctly.
   - `context=""` → `{ contexts: [], raw: "" }`.
   - `model="x"` (no context attr) → `null`.
   - empty string → `null`.
3. **`hasLLMBlocks`** —
   - `"{% llm context=\"abstract\" %}x{% endllm %}"` → `true`.
   - `"no llm here"` → `false`.
   - text with `{% llm %}` inside a fenced block → still `true` (naive by design).
4. **`parseLLMBlocks` — valid block** —
   - Single block: returns one block with correct `openRaw`, `closeRaw`, `contexts`, `body`, line ranges.
   - Multiple blocks: returns all in order.
   - Block with surrounding text: text is ignored, blocks extracted.
5. **`parseLLMBlocks` — fenced code ignored** —
   - ` ```\n{% llm context="abstract" %}x{% endllm %}\n``` ` → zero blocks, zero errors (the LLM-like lines are inside a fence, skipped silently).
   - `~~~\n{% llm ... %}\n~~~` (tilde fence) → same.
   - Mixed: a real block before the fence is found; the one inside the fence is not.
6. **`parseLLMBlocks` — frontmatter rejection** —
   - `---\n{% llm context="abstract" %}x{% endllm %}\n---` → error `llm.inFrontmatter`.
7. **`parseLLMBlocks` — live-block rejection** —
   - `%% zon kind=annotations %%\n{% llm context="abstract" %}x{% endllm %}\n%% /zon %%` → error `llm.inLiveBlock`.
8. **`parseLLMBlocks` — unclosed** —
   - `{% llm context="abstract" %}prompt` (no endllm) → error `llm.unclosed`.
9. **`parseLLMBlocks` — stray close** —
   - `{% endllm %}` alone → error `llm.strayClose`.
10. **`parseLLMBlocks` — missing context** —
    - `{% llm model="x" %}prompt{% endllm %}` → error `llm.missingContext`.
11. **`parseLLMBlocks` — empty context** —
    - `{% llm context="" %}prompt{% endllm %}` → error `llm.emptyContext`.
12. **`parseLLMBlocks` — unknown context** —
    - `{% llm context="summary" %}prompt{% endllm %}` → error `llm.unknownContext`.
13. **`parseLLMBlocks` — empty body** —
    - `{% llm context="abstract" %}{% endllm %}` → error `llm.emptyBody`.
    - `{% llm context="abstract" %}   \n  {% endllm %}` (whitespace only) → error `llm.emptyBody`.
14. **`parseLLMBlocks` — multiple contexts, one unknown** —
    - `{% llm context="abstract,summary" %}x{% endllm %}` → error `llm.unknownContext` (mentions `summary`).
15. **`validateLLMBlocks`** —
    - Valid template → `{ valid: true, errors: [], blocks: [...] }`.
    - Invalid → `{ valid: false, errors: [...], blocks: [] }`.
    - Fenced-code LLM-like text → `valid: true` (not an error), `blocks: []`.
16. **`parseLLMBlocks` — line offsets** —
    - `lineFrom`/`lineTo` are 0-based line indices of the open and close lines.

**Verification:** `npx vitest run test/llm-blocks.spec.js` passes.

---

### Slice 2 — `src/render.js` LLMExtension + render tests

**Edit: `src/render.js`**

Add an `LLMExtension` that mirrors `PersistExtension` but reconstructs the `{% llm %}...{% endllm %}` wrapper around the (Nunjucks-rendered) body so the placeholder survives into the output.

```js
// src/render.js — add after PersistExtension (after line 34)

// `{% llm context="abstract" %} ... {% endllm %}` -> renders its body through
// Nunjucks (so {{title}} etc. in the prompt get substituted), then wraps the
// rendered body back in the original {% llm %}/{% endllm %} tags so the
// unresolved placeholder survives into the written note. The LLM is NOT called
// here — a later execution pass (out of scope for this slice) finds and fills it.
function LLMExtension() {
  this.tags = ["llm"];
  this.parse = function (parser, nodes) {
    const tok = parser.nextToken();
    const args = parser.parseSignature(null, true); // parse the context="..." arg
    parser.advanceAfterBlockEnd(tok.value);
    const body = parser.parseUntilBlocks("endllm");
    parser.advanceAfterBlockEnd();
    return new nodes.CallExtension(this, "run", args, [body]);
  };
  this.run = function (_context, ...rest) {
    // The body callback is the last argument; the context kwarg may be passed
    // as a positional or as a kwargs object depending on nunjucks version.
    // Robustly extract the context string and the body.
    const body = rest[rest.length - 1];
    const renderedBody = typeof body === "function" ? body() : String(body || "");
    // Extract context: try kwargs (last-but-one if body is last) or scan args.
    let context = "";
    for (let i = 0; i < rest.length - 1; i++) {
      const a = rest[i];
      if (a && typeof a === "object" && typeof a.context === "string") context = a.context;
      else if (typeof a === "string" && a) context = a;
    }
    const raw = `{% llm context="${context}" %}\n${renderedBody}\n{% endllm %}`;
    return new nunjucks.runtime.SafeString(raw);
  };
}
```

Register in `makeEnv()` (after line 43 where `PersistExtension` is added):

```js
env.addExtension("LLMExtension", new LLMExtension());
```

> **Implementation note for the code-executor:** The exact mechanism by which
> nunjucks `CallExtension` passes keyword args (`context="..."`) to `run` varies
> by nunjucks version. The `...rest` approach above is defensive. **Verify with a
> test** (below) that `{% llm context="abstract" %}prompt{% endllm %}` renders to
> `{% llm context="abstract" %}\nprompt\n{% endllm %}`. If the context value is
> not reaching `run`, fall back to `parseSignature(null, false)` and inspect
> `args` (a NodeList) — extract the `context` keyword arg from the parsed AST
> before calling `run`. The test in `test/render.spec.js` is the gate.

**Edit: `test/render.spec.js`** — add a new `describe` block:

```js
describe("LLM block preservation", () => {
  it("preserves an {% llm %} block verbatim around the rendered body", () => {
    const out = render(
      '{% llm context="abstract" %}Summarise {{title}}.{% endllm %}',
      { title: "My Paper" }
    );
    expect(out).toContain('{% llm context="abstract" %}');
    expect(out).toContain('{% endllm %}');
    expect(out).toContain("Summarise My Paper."); // body rendered
  });

  it("preserves a multi-context block", () => {
    const out = render(
      '{% llm context="abstract,annotations" %}prompt{% endllm %}',
      {}
    );
    expect(out).toContain('context="abstract,annotations"');
    expect(out).toContain("{% endllm %}");
  });

  it("preserves multiple LLM blocks in one template", () => {
    const tpl = [
      "Before",
      '{% llm context="abstract" %}A{% endllm %}',
      "Middle",
      '{% llm context="fulltext" %}B{% endllm %}',
      "After",
    ].join("\n");
    const out = render(tpl, {});
    expect(out).toContain('context="abstract"');
    expect(out).toContain('context="fulltext"');
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  it("does not call any model (body is the prompt, preserved)", () => {
    const out = render('{% llm context="abstract" %}prompt{% endllm %}', {});
    // The placeholder survives — no network call, no substitution of the block itself.
    expect(out).toMatch(/\{%\s*llm\s+context="abstract"\s*%\}/);
    expect(out).toMatch(/\{%\s*endllm\s*%\}/);
  });
});
```

**Verification:** `npx vitest run test/render.spec.js` passes.

---

### Slice 3 — `src/templates.js` templateKind update + test

**Edit: `src/templates.js`** — `templateKind` (line 51–56)

Treat templates containing LLM blocks as `"document"` (once-per-item), never per-annotation `"format"`.

```js
// src/templates.js — add import at top
import { hasLLMBlocks } from "./llm-blocks.js";

// ... existing code ...

export function templateKind(text) {
  const t = String(text || "");
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(t)) return "document";
  if (/%%\s*zon\b/.test(t)) return "document";
  if (hasLLMBlocks(t)) return "document";   // NEW
  return "format";
}
```

**Edit: `test/templates.spec.js`** — add tests:

```js
import { parseTemplateFile, templateKind } from "../src/templates.js";

describe("templateKind with LLM blocks", () => {
  it("classifies a template with an LLM block as document", () => {
    expect(templateKind('{% llm context="abstract" %}x{% endllm %}')).toBe("document");
  });
  it("classifies a plain per-annotation format as format", () => {
    expect(templateKind("> {{text}}")).toBe("format");
  });
  it("LLM block beats format-only body (no frontmatter, no zon)", () => {
    const t = "- {{text}}\n{% llm context=\"abstract\" %}p{% endllm %}";
    expect(templateKind(t)).toBe("document");
  });
});
```

**Verification:** `npx vitest run test/templates.spec.js` passes.

---

### Slice 4 — `core/core.js` re-exports

**Edit: `core/core.js`** — add re-exports so `ZONCore` (the IIFE global in the Zotero window) exposes the new functions to `bootstrap.js`.

After line 19 (the `src/llm.js` re-export), add:

```js
export { SUPPORTED_CONTEXTS, parseLLMContext, hasLLMBlocks, parseLLMBlocks, validateLLMBlocks } from "../src/llm-blocks.js";
```

> No test needed — this is a re-export. The build (`npm run build`) bundles
> `core/core.js` into `core.bundle.js`; if the export path is wrong, the build
> fails. `bootstrap.js` accesses these via `win.ZONCore.<name>`.

**Verification:** `npm run build` succeeds (the esbuild bundle resolves the new import).

---

### Slice 5 — `addon/bootstrap.js` integration (validate + preserve at create/insert)

This slice wires the pure logic into the create/insert paths. **No new logic** — just calls into `ZONCore.validateLLMBlocks` and surfaces errors via `STRINGS`.

#### 5a. Mirror `templateKindOf` (line 531)

`bootstrap.js` has its own `templateKindOf` (line 531) that mirrors `src/templates.js` `templateKind` (runs in the privileged scope before `ZONCore` is guaranteed loaded). Update it to also detect LLM blocks.

```js
// addon/bootstrap.js line 531 — add LLM detection
templateKindOf(text) {
  let t = String(text || "");
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(t)) return "document";
  if (/%%\s*zon\b/.test(t)) return "document";
  if (/\{%\s*llm\b/.test(t)) return "document";   // NEW — mirrors hasLLMBlocks
  return "format";
},
```

> Note: `bootstrap.js` cannot import `src/llm-blocks.js` directly (it's not
> bundled into the bootstrap scope — `ZONCore` is). So inline the naive regex
> `/\{%\s*llm\b/` (same as `hasLLMBlocks`). This mirrors the existing pattern
> where `templateKindOf` inlines the frontmatter/zon regexes rather than
> importing `src/templates.js`.

#### 5b. Add STRINGS for validation errors (line 354 block)

Add new keys to the `STRINGS` object (before the closing `},` at line ~440):

```js
"err.llmBlockInvalid": "LLM block error (line {line}): {message}",
"err.llmBlocksInvalid": "LLM block errors — fix the template before inserting. ({count} error(s))",
"status.llmBlocksPreserved": "LLM blocks preserved (run-on-create disabled) — {count} placeholder(s)",
```

#### 5c. Add a validation helper method on `ZON`

Add a new method `validateLLMTemplate(win, text)` that calls into `ZONCore` and returns `{ valid, errors }` or a safe fallback if `ZONCore` isn't loaded:

```js
// addon/bootstrap.js — add near blockConfigFor (line ~2003)
validateLLMTemplate(win, text) {
  try {
    if (!win.ZONCore || !win.ZONCore.validateLLMBlocks) return { valid: true, errors: [] };
    const r = win.ZONCore.validateLLMBlocks(text);
    return { valid: r.valid, errors: r.errors };
  } catch (e) {
    this.log("validateLLMTemplate failed: " + e);
    return { valid: true, errors: [] }; // don't block on a validator crash
  }
},
```

#### 5d. Wire validation into `insertTemplate` (line 2660)

After `let t = this.allTemplates(win)[name] || {};` (line 2667), before computing `text`:

```js
// Validate LLM block syntax + placement (no context-availability check).
if (t.text) {
  let v = this.validateLLMTemplate(win, t.text);
  if (!v.valid) {
    let first = v.errors[0];
    this.setStatus(rec, this.t("err.llmBlockInvalid", {
      line: first.line != null ? first.line : "?",
      message: first.message,
    }));
    return;
  }
}
```

The existing `renderDocument`/`makeBlock` path then renders the template through `ZONCore.render` (which now has the `LLMExtension`), preserving the placeholders. No further change needed — the preservation is automatic via the extension.

#### 5e. Wire validation into `renderTemplateAsNote` (line 1973) / `writeNoteForItem` (line 2011)

In `renderTemplateAsNote`, after resolving `t` (line 1974) or the scaffold text (line 1976), validate before rendering:

```js
// addon/bootstrap.js renderTemplateAsNote — after resolving template text
async renderTemplateAsNote(win, item, name) {
  let t = this.allTemplates(win)[name];
  let templateText;
  if (!t) {
    templateText = await this.resolveNoteScaffoldText(name);
  } else if (t.kind === "document") {
    templateText = t.text;
  } else {
    // format-kind: rendered as a block via makeBlock below (no LLM blocks possible
    // — templateKind already classified LLM-containing templates as "document").
    templateText = null;
  }
  if (templateText) {
    let v = this.validateLLMTemplate(win, templateText);
    if (!v.valid) {
      throw new Error(this.t("err.llmBlocksInvalid", { count: v.errors.length }) +
        " " + v.errors.map(e => `line ${e.line}: ${e.message}`).join("; "));
    }
  }
  if (!t) return this.renderDocument(win, item, templateText);
  if (t.kind === "document") return this.renderDocument(win, item, t.text);
  // ... existing format-kind path unchanged ...
}
```

> `writeNoteForItem` (line 2011) calls `renderTemplateAsNote` and catches
> exceptions into `{ status: "error", error }` (line 2043–2045), which `createNote`
> (line 2051) surfaces via `this.t("msg.createFailed") + r.error` (line 2059). So
> the validation error reaches the user as a banner message with no extra wiring.

#### 5f. Preserve placeholders when auto-run is off

This is **already handled** by the `LLMExtension` in `src/render.js` (Slice 2): the extension reconstructs the `{% llm %}...{% endllm %}` wrapper around the rendered body regardless of the `autoRun` setting. No model call is made. The placeholder survives into `md`, which `safeWrite` writes to disk.

The `canAutoRun(settings)` function from `src/llm.js` (line 43) is **not** called in this slice — auto-run gating is the execution slice (out of scope). This slice only ensures that when auto-run is off (the default), the placeholder is preserved.

> **Optional status message:** After a successful create/insert with preserved
> LLM blocks, the bootstrap could call `this.setStatus(rec, this.t("status.llmBlocksPreserved", { count: N }))`
> where `N = win.ZONCore.parseLLMBlocks(md).blocks.length`. This is a nice-to-have;
> the acceptance criteria only require preservation, not a status message. Include
> it if straightforward, otherwise defer.

**Verification:** `npm test` passes (Vitest — no bootstrap.js tests, but the pure modules it calls are tested). `npm run build` succeeds.

---

### Slice 6 — Full verification

```bash
npm test                    # all Vitest tests pass (existing + new)
npm run build               # .xpi builds; core bundle resolves new imports
```

If `npm run build` fails, the most likely cause is a bad import path in `core/core.js` (Slice 4) or `src/templates.js` (Slice 3). Check that `src/llm-blocks.js` has no imports from `src/blocks.js` or `src/render.js` (it must stay nunjucks-free).

---

## Risks & rollback considerations

### Risks

1. **Nunjucks kwarg passing to `CallExtension.run`** — The exact mechanism by which `context="abstract"` reaches the `run` method varies by nunjucks version (3.2.4 per `package.json`). The `...rest` defensive approach in Slice 2 handles both positional and kwargs forms, but **the test in `test/render.spec.js` is the gate**. If it fails, fall back to inspecting the `args` NodeList from `parseSignature` and extracting the context value from the parsed AST before `run` is called (pre-evaluate in `parse`).

2. **`src/llm-blocks.js` accidentally importing nunjucks** — If `llm-blocks.js` imports from `blocks.js` (which imports `render.js` → `nunjucks`), it can no longer be bundled into contexts that must stay nunjucks-free, and `npm test` may slow. **Mitigation:** inline the `OPEN_RE`/`CLOSE_RE` regexes (as `src/markers.js` does). The plan specifies this.

3. **`templateKind` false-positive from `hasLLMBlocks`** — The naive regex `/\{%\s*llm\b/` matches LLM-like text inside fenced code. This means a per-annotation format that happens to contain a fenced code block with `{% llm %}` inside would be classified as `"document"`. **Mitigation:** This is acceptable — such a template would be rendered once (as a document) rather than per-annotation, which is the safer default. The validator (`validateLLMBlocks`) correctly ignores fenced-code LLM-like text, so no false validation errors. Document this in the `hasLLMBlocks` JSDoc.

4. **`bootstrap.js` mirror drift** — `templateKindOf` (bootstrap.js:531) and `templateKind` (src/templates.js:51) must stay in sync. The plan adds the LLM check to both. The AGENTS.md (line 15–17) already warns about this mirror. **Mitigation:** Both use the same inlined regex `/\{%\s*llm\b/`.

5. **Validation blocking create/insert on a validator crash** — If `validateLLMBlocks` throws (unexpected input), `validateLLMTemplate` catches and returns `{ valid: true }` (fail-open) so a bug in the validator never blocks the user's workflow. **Mitigation:** already in the design (5c).

6. **Body rendering through Nunjucks** — The LLM block body IS rendered through Nunjucks (so `{{title}}` in a prompt gets substituted). If a user's prompt contains literal `{{` that is NOT a Nunjucks expression, Nunjucks may error or strip it. **Mitigation:** Document in the template guide that prompt bodies are Nunjucks-rendered; users escape literal `{{` as `{% raw %}{{{% endraw %}` (stock Nunjucks). This matches the existing behavior for all template text.

### Rollback

Each slice touches independent files:
- Slice 1: new file `src/llm-blocks.js` + `test/llm-blocks.spec.js` — delete to roll back.
- Slice 2: `src/render.js` — remove `LLMExtension` + the `addExtension` line.
- Slice 3: `src/templates.js` — remove the `hasLLMBlocks` import and the one `if` line.
- Slice 4: `core/core.js` — remove the one re-export line.
- Slice 5: `addon/bootstrap.js` — remove the added STRINGS keys, `validateLLMTemplate`, the `templateKindOf` LLM line, and the validation blocks in `insertTemplate`/`renderTemplateAsNote`.

No data migrations, no pref changes, no manifest changes. Rolling back any slice leaves the note files on disk untouched (they may contain preserved `{% llm %}` placeholders, which are inert text).

---

## Testing & verification playbook

### Unit tests (Vitest — `npm test`)

| File | Covers |
|------|--------|
| `test/llm-blocks.spec.js` (new) | Parser, validator, fenced-code ignoring, frontmatter rejection, live-block rejection, all error codes, line offsets |
| `test/render.spec.js` (extended) | LLMExtension preserves `{% llm %}...{% endllm %}` around rendered body; multi-context; multiple blocks; no model call |
| `test/templates.spec.js` (extended) | `templateKind` classifies LLM-containing templates as `"document"` |
| `test/blocks.spec.js` (unchanged) | Regression — existing block parsing/sync unaffected |
| `test/llm.spec.js` (unchanged) | Regression — LLM HTTP client unaffected |

### Build verification

```bash
npm run build    # esbuild bundles core/core.js → core.bundle.js; must resolve
                 # the new src/llm-blocks.js import. Fails loudly if the path is wrong.
```

### Manual / integration (out of scope for this slice, but documented for the next)

- `npm start` → create a note from a template with an `{% llm %}` block → the note file on disk contains the preserved placeholder.
- Insert a template with a malformed `{% llm %}` block → banner shows the error.
- A template with `{% llm %}` inside a `%% zon %%` block → banner shows "LLM block error (line N): ...inside a managed block".
- Integration tests (`test/integration/*.spec.js`, Mocha in Zotero) are **not** required by the acceptance criteria for this slice; the pure-logic coverage in Vitest is the gate.

---

## Acceptance criteria (enumerated)

1. ✅ The template system recognizes unresolved `{% llm context="..." %}...{% endllm %}` blocks with required block-body prompts — **`parseLLMBlocks` in `src/llm-blocks.js`**.
2. ✅ LLM blocks require an explicit context name or comma-separated context list using supported context names (`abstract`, `annotations`, `fulltext`) — **`parseLLMContext` + `validateLLMBlocks`**; errors `llm.missingContext`, `llm.emptyContext`, `llm.unknownContext`.
3. ✅ LLM blocks are invalid in YAML frontmatter — **error `llm.inFrontmatter`**.
4. ✅ LLM blocks are invalid inside managed `%% zon %%` live blocks — **error `llm.inLiveBlock`**.
5. ✅ LLM-like examples inside fenced code blocks are ignored — **scanner skips fenced code; `validateLLMBlocks` does not surface `llm.inFencedCode` as an error**.
6. ✅ Templates containing LLM blocks are treated as once-per-item templates, not per-annotation formats — **`templateKind` returns `"document"` via `hasLLMBlocks`**.
7. ✅ Create and Insert preserve unresolved LLM placeholders when run-on-create/insert is disabled — **`LLMExtension` in `src/render.js` reconstructs the tag around the rendered body; no model call is made**.
8. ✅ Create and Insert validate LLM syntax and placement immediately but do not check context availability until execution time — **`validateLLMTemplate` in `bootstrap.js` calls `validateLLMBlocks` (syntax + placement only); context availability is not checked**.
9. ✅ Focused tests cover valid block detection, malformed tags, missing/unknown contexts, fenced-code ignoring, frontmatter rejection, live-block rejection, and placeholder preservation — **`test/llm-blocks.spec.js` (16 test cases) + `test/render.spec.js` (4 test cases) + `test/templates.spec.js` (3 test cases)**.

---

## File change summary

| File | Action | Slice |
|------|--------|-------|
| `src/llm-blocks.js` | **NEW** — pure parser/validator | 1 |
| `test/llm-blocks.spec.js` | **NEW** — 16 test cases | 1 |
| `src/render.js` | **EDIT** — add `LLMExtension`, register in `makeEnv` | 2 |
| `test/render.spec.js` | **EDIT** — add 4 LLM preservation tests | 2 |
| `src/templates.js` | **EDIT** — `templateKind` adds `hasLLMBlocks` check | 3 |
| `test/templates.spec.js` | **EDIT** — add 3 `templateKind` LLM tests | 3 |
| `core/core.js` | **EDIT** — re-export `llm-blocks.js` functions | 4 |
| `addon/bootstrap.js` | **EDIT** — `templateKindOf` mirror, STRINGS, `validateLLMTemplate`, validation in `insertTemplate` + `renderTemplateAsNote` | 5 |

**No changes to:** `src/blocks.js`, `src/preview.js`, `src/llm.js`, `src/markers.js`, `addon/manifest.json`, `addon/locale/`, `addon/content/preferences.*`, `zotero-plugin.config.ts`, `vitest.config.js`, `package.json`.