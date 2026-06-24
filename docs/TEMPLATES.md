# Zotero → Obsidian Notes — Templates

This folder holds the templates the **Obsidian Notes** Zotero plugin uses. There
are two kinds of file here, distinguished only by name:

- **`note.md`** (and any **`note-*.md`**) — *whole-note scaffolds*. Used by
  **Create note from template** when an item has no note yet. Renders the
  frontmatter, citation, abstract, and empty section headings. You can keep
  several (`note.md`, `note-book.md`, `note-minimal.md`, …); the **default** is
  set in Settings → Obsidian Notes → *Default note template* (which can be **any**
  template, not just `note-*` — including a per-annotation or field template, in
  which case a created note is just that block), and the Create panel lets you pick
  a different one per note.
- **Every other file** (`highlight.md`, `key-quote.md`, …) — an *insertable block
  template*. Each appears in the **Template** dropdown in the item pane by its
  filename (without the extension). When you click **Insert**, the selected
  template renders the item's annotations into a live block.

You manage all of this from Obsidian: add a file → it shows up in the dropdown;
edit a file → the new look applies on the next Insert/Refresh.

---

## The language is Nunjucks

Templates are written in **Nunjucks** — the *same* templating language as your
existing `Zotero Template.md`. Nothing new to learn. You have `{{ variable }}`,
`{% if %}` / `{% for %}`, and filters like `{{ date | format("YYYY") }}`.

### Variables available in a *block* template (per annotation)

| Variable        | Meaning                                                |
|-----------------|--------------------------------------------------------|
| `{{text}}`      | the highlighted text                                   |
| `{{comment}}`   | your note on the annotation (may be empty)             |
| `{{page}}`      | page label shown in the PDF (e.g. `12`, `iv`)          |
| `{{link}}`      | `zotero://open-pdf/...` deep link back to that page    |
| `{{colour}}`    | annotation colour name (`yellow`, `red`, …)            |
| `{{type}}`      | `highlight`, `note`, `image`                           |
| `{{citekey}}`   | the item's citekey                                     |
| `{{imageBaseName}}` | filename for an image annotation                   |

### Variables in `note.md` and in a `kind=field` element (whole-item)

`{{citekey}}`, `{{title}}`, `{{date}}`, `{{itemType}}`, `{{publicationTitle}}`,
`{{abstractNote}}`, `{{bibliography}}`, `{{desktopURI}}`, `{{creators}}` (each has
`.firstName` / `.lastName`), `{{allTags}}`.

---

## The optional first-line directive: `%%! … %%`

A block template *may* begin with one special line that pins its defaults:

```
%%! colour=yellow sync=on sep=blank %%
> {{text}}
> — [p.{{page}}]({{link}})
```

- `%%! … %%` is read by the plugin and **stripped** before rendering — it never
  appears in your note. (The `!` is what marks it as a directive, so it isn't
  confused with a `%% zon %%` block marker.)
- Keys:
  - **`colour`** — pin this template to one annotation colour (`yellow`, `red`,
    `green`, `blue`, `purple`, `magenta`, `orange`, `grey`, or `all`). This is how
    a "yellow key-quotes" preset is always available in the dropdown.
  - **`sync`** — `on` (default) keeps the block refreshing from Zotero; `off`
    inserts a frozen one-time snapshot.
  - **`sep`** — how rendered annotations are joined: `blank` (blank line between)
    or `newline`. If omitted it's inferred (multi-line bodies get a blank line).
  - **`kind`** — what *kind* of element this template inserts:
    - omitted / `annotations` (default) — a live annotations block (everything
      above): the body is rendered once **per highlight**, filtered by colour.
    - `field` / `section` / `custom` — a **metadata element**: the body is rendered
      **once over the item's data** (Title, abstract, citation, …) and refreshes
      from Zotero like an annotations block does. Use this for, e.g., an abstract
      panel or a formatted citation that stays in sync. A `kind=field` template
      uses the *whole-item* variables below, not the per-annotation ones, and
      ignores `colour` (there are no highlights to filter).

Anything you set in the toolbar at Insert time overrides these defaults.

---

## What `%% zon … %%` is (in your finished notes)

When you Insert, the plugin wraps the rendered annotations in an invisible marker:

```
%% zon kind=annotations colour=yellow sync=on format=key-quote %%
> …your annotations…
%% /zon %%
```

`%% … %%` is **Obsidian's own comment syntax** — it's invisible in reading view.
It's there so **Refresh** can find the block and regenerate it from Zotero without
touching your prose or any frozen (`sync=off`) blocks. You don't write these by
hand — Insert does it. `format=` records which template produced the block.

---

## Example templates in this folder

- **`highlight.md`** — plain list, colour chosen in the toolbar.
- **`key-quote.md`** — blockquote, pinned to `yellow` (`%%! colour=yellow %%`).
- **`critique.md`** — red callout, pinned to `red`.
- **`snapshot.md`** — a frozen one-time list (`%%! sync=off %%`).
- **`abstract.md`** — a `kind=field` element: the item's abstract in a callout,
  kept in sync (`%%! kind=field %%`).

Copy any of these to make your own. Rename freely — the filename is the label.
The built-in templates `list`, `quote`, `callout`, `compact` are always present
even if this folder is empty.

---

## LLM-assisted templates (`{% llm %}` blocks)

Templates can include **LLM blocks** — prompt-marked regions that are sent to an
LLM endpoint and replaced by the model's response. This lets you summarise,
rewrite, classify, or translate content without leaving Zotero.

**Requirements:**
- An LLM provider must be configured in Settings → Obsidian Notes → LLM.
- The template containing an `{% llm %}` block is treated as a
  **once-per-item** (document) template — it is never rendered once per
  annotation, even if it lives in a file named like an annotation template.
- The provider is OpenAI-compatible Chat Completions. Point it at any compatible
  endpoint — local Ollama (default, `http://localhost:11434/v1`), OpenAI,
  LM Studio, etc. The model name and optional API key are set in Settings. The
  plugin does not ship a model or key.

### Syntax

```
{% llm context="<ctx>" %}
<prompt body>
{% endllm %}
```

- **`context`** (required) — which item data to prepend as context for the prompt.
- **Prompt body** — free-form text; must be non-empty.
- **`{% endllm %}`** (required) — closes the block.

Example:

```
{% llm context="abstract" %}
Summarise the following in three bullet points:
{% endllm %}
```

### Supported contexts

| Context         | Data source                                          |
|-----------------|------------------------------------------------------|
| `abstract`      | The item's `abstractNote` field                      |
| `annotations`   | PDF annotations rendered to text                     |
| `fulltext`      | Primary PDF's extracted text (from Zotero's FT cache) |

Each context injects its data into the prompt as part of the request payload.
### Comma-separated contexts

You may list more than one context, comma-separated:

```
{% llm context="abstract,annotations" %}Summarise how the abstract and annotations relate.{% endllm %}
```

Each requested context is resolved in template order and labeled in the
assembled prompt:

```
## Context: abstract
<abstract text>

## Context: annotations
<annotations text>
```

The combined context text (excluding the task prompt) must fit within the
configured `maxContextChars` limit; if it exceeds the limit the run fails with
a `CONTEXT_TOO_LARGE` error. If **any** requested context is missing for an
item (e.g. no extracted full text), the **entire block** fails with
`CONTEXT_MISSING` — there is no partial assembly or silent fallback to the
available contexts.

### Unresolved placeholders

Placeholders in the prompt body (`{{variable}}`) are resolved by Nunjucks
against item data when the note is rendered, before the LLM block is executed.
This works exactly like the rest of the template — use variables that exist in
the item data (see [Variables in `note.md`](#variables-in-notemd-and-in-a-kindfield-element-whole-item)).

Undefined variables render as the empty string (Nunjucks default behaviour;
`autoescape` is off). For example, if `{{title}}` is defined it will be
substituted; if `{{nonexistent}}` is used it will vanish silently.

### Run LLM (manual execution)

Open a note containing one or more `{% llm %}` blocks and choose **Run LLM**
from the note-pane toolbar or context menu.

- Blocks execute in document order.
- Each block's result replaces the block in-place.
- **All-or-nothing:** if any block fails (context missing, HTTP error, empty
  response, etc.), *no* block results are written and all original `{% llm %}`
  blocks are left intact. The error is surfaced to the user.

### Auto-run

When **Auto-run LLM** is enabled in Settings (and an LLM is configured), blocks
run automatically when:
- A note is created from a template.
- A template block is inserted into an existing note (via the Insert toolbar).

With auto-run off, blocks are preserved as-is and left for manual execution.
Note that auto-run still honours all-or-nothing semantics — if auto-run fails,
the note is left in its un-run state so the user can diagnose and retry.

### Missing-context failure

If the requested context exists (e.g. `abstract`) but the item's corresponding
data is empty (the item has no `abstractNote`), the run fails with a **clear
error naming the missing context**. No fallback to a different context, no
placeholder insertion. The block is left untouched and the error is shown.

### Body-only restrictions

LLM blocks are subject to the following validation rules. Any violation is a
parse error — the block is not executed and the error is surfaced:

| Restriction                     | Detail                                              |
|---------------------------------|-----------------------------------------------------|
| **Frontmatter**                 | LLM blocks are rejected inside YAML frontmatter.    |
| **Inside `%% zon %%`**         | LLM blocks are rejected inside live annotation blocks. |
| **Empty body**                  | The prompt body must be non-empty.                  |
| **Missing / empty context**     | `context` attribute is required and must be set.    |
| **Unknown context**             | A context name not in the supported list is rejected. |
| **Unclosed block**              | `{% endllm %}` missing → parse error.               |
| **Stray close**                 | `{% endllm %}` without a matching open → parse error. |

### No silent fallback

The interpreter **never guesses**. Every error scenario — parse errors, missing
context, HTTP failures (timeout, network error, non-200 status), empty model
responses, malformed JSON — **aborts the whole run**. The note is not modified
and the error is surfaced to the user with a descriptive message. There is no
fallback to "remove the block" or "insert a best-effort guess".

This means a template with LLM blocks always produces exactly the intended
output on success, and preserves the template source on failure for diagnosis.
