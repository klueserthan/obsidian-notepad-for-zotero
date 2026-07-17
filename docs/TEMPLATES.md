# Paper Summarizer for Zotero — Templates

This is the reference for writing a **template** — the thing the Composer's
template picker renders into a Summary Note. There are two kinds of file in
your Templates folder, distinguished only by name:

- **`note.md`** (and any **`note-*.md`**) — *whole-note scaffolds*. What the
  Composer renders by default (and what "Create note from template" used to
  call the same thing). Renders frontmatter, the citation, the abstract, and
  whatever sections you define. You can keep several (`note.md`, `note-book.md`,
  `note-minimal.md`, …); the **default** is set in
  Settings → Paper Summarizer → *Default note template* (any template, not just
  `note-*` — including a per-annotation/field template, in which case the
  generated note is just that block), and the Composer's picker lets you choose
  a different one per generate.
- **Every other file** (`highlight.md`, `key-quote.md`, …) — a *block
  template*: a per-annotation body. Selecting one directly in the Composer
  generates a Summary Note that's just a filled annotations block; used inside
  a `note.md` via `highlights(...)` (below), it routes a subset of highlights
  into a section.

Add or edit a file in the Templates folder on disk (there's no in-app editor
for the raw file — use the **Template Builder** for a live-preview authoring
UI instead, opened from the Composer). Templates are cached in memory and
reloaded when the Template Builder opens (it also reloads and re-selects a
template right after you save one there); if you hand-edit a template file
directly, open the Builder once (or restart Zotero) to pick it up.

---

## The language is Nunjucks

Templates are written in **Nunjucks**. You have `{{ variable }}`,
`{% if %}` / `{% for %}`, and filters like `{{ date | format("YYYY") }}`.

### Variables available in a *block* template (per annotation)

| Variable        | Meaning                                                |
|-----------------|--------------------------------------------------------|
| `{{text}}`      | the highlighted text                                   |
| `{{comment}}`   | your note on the annotation (may be empty)             |
| `{{page}}`      | page label shown in the PDF (e.g. `12`, `iv`)          |
| `{{link}}`      | `zotero://open-pdf/...` deep link back to that page    |
| `{{colour}}`    | annotation colour name (`yellow`, `red`, …)            |
| `{{type}}`      | `highlight`, `underline`, `image`, `note` (ink isn't rendered) |
| `{{citekey}}`   | the item's citekey                                     |
| `{{imageBaseName}}` | filename for an image annotation                   |
| `{{tags}}`      | the **highlight's own** tags, as a list (loop/filter it) |
| `{{tagList}}`   | the same tags as a comma-joined string                 |

`{{tags}}` is the annotation's *own* tags (the ones you add to a highlight in
the Zotero reader), distinct from the item-level `{{allTags}}` in a note
template. Use it to carry per-highlight role markers — tag highlights
`method` / `finding` / `quote` and filter a block on them (see `tag=` below).

### Variables in `note.md` and in a `kind=field` element (whole-item)

`{{citekey}}`, `{{title}}`, `{{date}}`, `{{dateAdded}}`, `{{dateModified}}`,
`{{itemType}}`, `{{publicationTitle}}`, `{{abstractNote}}`, `{{bibliography}}`,
`{{desktopURI}}` (a `zotero://select/…` link to the item in the Zotero
Library), `{{openPdf}}` (a `zotero://open-pdf/…` link to the item's PDF —
empty if it has none, so guard with `{% if openPdf %}`), `{{creators}}` (each
has `.firstName` / `.lastName`), `{{authors}}` (those creators as one
"First Last, First Last" string), `{{allTags}}`, `{{tags}}` (item tags as a
list of `{tag}`), and `{{relations}}` (the item's Zotero **Related** items,
each with `.citekey`, `.title`, `.key`).

```nunjucks
Tags: [{% for t in tags %}#{{t.tag | hashify}}{% if not loop.last %}, {% endif %}{% endfor %}]
Related: {% for r in relations | selectattr("citekey") %}[[{{r.citekey}}]]{% if not loop.last %}, {% endif %}{% endfor %}
```

The **`hashify`** filter lowercases a tag, turns spaces into underscores, and
strips punctuation. There's also a ready-made `related` field format —
`%% zon kind=field format=related %%` — that renders the related-items links.

(These whole-item variables work in `note.md` and `kind=field` elements, **not**
inside a per-annotation block, whose context is the highlight, not the item.)

---

## Routing highlights by colour in a *note* template

A whole-note template can place annotation blocks wherever you want, so blue
highlights land in one section and yellow in another. Use the
`highlights(...)` helper: each call drops in a block that's filled with the
matching highlights when the note is rendered.

```nunjucks
---
Title: "{{title}}"
Year: "{{date | format("YYYY")}}"
---

## Key passages (yellow)
{{ highlights(colour="yellow", format="quote") }}

## Critiques (red)
{{ highlights(colour="red", format="quote") }}

## To follow up (blue)
{{ highlights(colour="blue", format="quote") }}
```

When the Composer renders this template, each `highlights(...)` expands into a
block filled with just that colour's highlights, in place. (The shipped
**`note-by-colour`** starter template is exactly this.)

`highlights(...)` options (all optional):

| Argument  | Example | Meaning |
| --- | --- | --- |
| `colour`  | `highlights(colour="blue")` or `highlights("blue")` | Only this colour (`yellow`/`red`/`green`/`blue`/`purple`/`magenta`/`orange`/`grey`). Omit for **all** colours. |
| `type`    | `type="image"` | Only this annotation type. Omit for all. |
| `format`  | `format="quote"` | Which per-annotation format to render with (`list`, `quote`, `callout`, `compact`, or your own). Defaults to `list`. |
| `sync`    | `sync="off"` | See "`sync` in the generate pipeline" below. |

---

## The optional first-line directive: `%%! … %%`

A block template *may* begin with one special line that pins its defaults:

```
%%! colour=yellow sync=on sep=blank %%
> {{text}}
> — [p.{{page}}]({{link}})
```

- `%%! … %%` is read by the plugin and **stripped** before rendering — it
  never appears in a Summary Note. (The `!` marks it as a directive, distinct
  from a `%% zon %%` block marker.)
- Keys:
  - **`colour`** — pin this template to one annotation colour (`yellow`, `red`,
    `green`, `blue`, `purple`, `magenta`, `orange`, `grey`, or `all`).
  - **`sync`** — see below.
  - **`sep`** — how rendered annotations are joined: `blank` (blank line
    between) or `newline`. If omitted it's inferred (multi-line bodies get a
    blank line).
  - **`kind`** — what *kind* of element this template inserts:
    - omitted / `annotations` (default) — a live annotations block: the body
      is rendered once **per highlight**, filtered by colour.
    - `field` / `section` / `custom` — a **metadata element**: the body is
      rendered **once over the item's data** (title, abstract, citation, …).
      Uses the *whole-item* variables above, not the per-annotation ones, and
      ignores `colour`.

---

## `%% zon … %%` blocks — the authoring model

When a whole-note template is rendered, each `highlights(...)` call (or a
directly-selected block template) is wrapped in a pair of invisible-in-Obsidian
comment markers — inherited unchanged from the file-based upstream plugin's
authoring syntax:

```
%% zon kind=annotations colour=yellow type=highlight sync=on format=key-quote %%
> "A highlighted sentence." %% ann:ABCD1234 %%
> — [p.12](zotero://open-pdf/library/items/KEY?page=12&annotation=ABCD1234)
%% /zon %%
```

**This markup never reaches a Summary Note.** It exists purely as the
intermediate representation the render pipeline produces on the way to a note
— see "From template to Summary Note" below. You'll see it in the raw
rendered markdown if you're debugging a template, and the Template Builder's
preview shows the marker-stripped result. The open marker carries the block's
settings as `key=value` attributes:

| Attribute | Values | What it does |
| --- | --- | --- |
| `kind` | `annotations` (default), `field`, `section`, `custom` | `annotations` renders the body once **per highlight**; the others render **once over the item's data**. |
| `colour` | `all`, `yellow`, `red`, `green`, `blue`, `purple`, `magenta`, `orange`, `grey` | Only pull highlights of this colour (`annotations` blocks only). |
| `type` | `all`, `highlight`, `underline`, `image`, `ink`, `note` | Only pull annotations of this type. Omitted = all types. |
| `tag` | a tag name, or a comma list (`tag=method` / `tag=method,finding`) | Only pull highlights carrying one of these **annotation tags** (OR semantics). Combines with `colour`/`type` (AND across filters). `tags=` is an alias. |
| `sync` | `on` (default), `off` | See below. |
| `format` | a template name (`list`, `quote`, `callout`, `compact`, or your own file) | Which per-annotation template renders the body. |
| `style` | `list`, `quote`, `callout` | Compose a body from a base style + `parts` instead of a named `format` (the Template Builder's "Compose" mode). Takes precedence over `format`. |
| `parts` | a comma list of `page`, `comment`, `tags` | Which extra pieces a composed (`style=…`) body includes; the highlight text is always shown. |
| `order` | `comment-first` | On a composed block (`style=…` with `comment` in `parts`), put **your comment first** and the quote underneath as support. Omit for quote-first. |

### `sync` in the generate pipeline

Every Generate is a fresh render — there's no existing Summary Note the
plugin reads back and reconciles against (ADR-0002: **one-way, create-once**).
So `sync` means something narrower than it used to:

- **`sync=on` (default)** — the block is filled with the item's *current*
  matching annotations at render time. This is what you want in every normal
  template.
- **`sync=off`** — the block renders **empty**. There's no prior document to
  preserve a frozen snapshot from, so "freeze this block" has nothing to
  freeze on a first render. It's only useful if you intend to fill the block
  by hand afterward in Better Notes (the marker text itself is stripped before
  the note is created, so you'd just be leaving a gap in the layout).

### The `%% ann:KEY %%` anchors

Inside an `annotations` block, each rendered highlight ends in an invisible
`%% ann:<annotationKey> %%` anchor. It's stripped along with everything else
before a Summary Note is created; it has no effect on a one-way render.

---

## From template to Summary Note

Generate (and the Composer's live preview, which runs the identical pipeline)
does this, in order:

1. **Render** — the Nunjucks template is filled with the item's data, then
   `%% zon %%` blocks are filled with the matching annotations (above).
2. **Resolve `{% llm %}` blocks** — see below. The preview never does this
   step; Generate refuses to proceed while any block is unresolved.
3. **Strip frontmatter** — a leading `---\n…\n---` YAML block, if the template
   has one, is dropped. It has no place in a Zotero note body; use it in the
   Template Builder for organizing fields if you like, but it never reaches
   the generated note.
4. **Strip markers** — every `%% zon … %%` / `%% /zon %%` line and every
   `%% ann:KEY %%` anchor is removed, byte-identically preserving everything
   else.
5. **Markdown → HTML** — the stripped markdown is converted with a fixed,
   explicit rule set (headings, lists, blockquotes, links, emphasis, code,
   tables, strikethrough, hard breaks; raw HTML is escaped, never passed
   through) and saved as the Summary Note's content.
6. **Create** — a new Zotero child note carrying the Marker Tag
   (`zps:summary-note`) is created, or (with your explicit confirmation) the
   newest existing Summary Note is overwritten. No other note is ever touched.

### A note on `![[…]]` image embeds

Image (area) annotations still render into `{{imageBaseName}}`-based
`![[<folder>/<citekey>/<file>]]` wiki-embed syntax in the built-in formats — a
holdover from the file-based upstream plugin, where Obsidian understands that
syntax and the image file actually gets exported to the vault. **Neither of
those is true here**: nothing exports an image file, and step 5 above doesn't
understand wiki-embed syntax, so `![[…]]` shows up as **literal text** in the
generated Summary Note, not an image. Avoid `{{imageBaseName}}`-based formats
if you don't want that text in your notes.

---

## Example templates in this folder

- **`highlight.md`** — plain list, colour chosen when selected directly.
- **`key-quote.md`** — blockquote, pinned to `yellow` (`%%! colour=yellow %%`).
- **`critique.md`** — red callout, pinned to `red`.
- **`snapshot.md`** — a block set `sync=off` (renders empty — see above).
- **`abstract.md`** — a `kind=field` element: the item's abstract in a callout.
- **`note-by-colour.md`** — a whole-note scaffold that routes each highlight
  colour into its own section with `highlights(colour="…")`.

Copy any of these to make your own. Rename freely — the filename is the label.
The built-in formats `list`, `quote`, `callout`, `compact` are always present
even if the Templates folder is empty or unset.

---

## LLM-assisted templates (`{% llm %}` blocks)

Templates can include **LLM blocks** — prompt-marked regions resolved by an
LLM and replaced with static markdown. See
[docs/adr/0001-explicit-static-llm-interpreter.md](adr/0001-explicit-static-llm-interpreter.md)
for the design rationale: model calls are BYOK, explicit, and never part of
normal rendering.

**Requirements:**
- An LLM provider must be configured in Settings → Paper Summarizer → LLM
  Interpreter (base URL + model).
- A template containing an `{% llm %}` block is treated as a
  **once-per-item** (document) template — it is never rendered once per
  annotation, even if it lives in a file named like a block template.
- The provider is OpenAI-compatible Chat Completions. Point it at any
  compatible endpoint — local Ollama (default,
  `http://localhost:11434/v1`), OpenAI, LM Studio, etc. The model name and
  optional API key are set in Settings. The plugin does not ship a model or
  key.

### Syntax

```
{% llm context="<ctx>" %}
<prompt body>
{% endllm %}
```

- **`context`** (required) — which item data to prepend as context for the
  prompt.
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
against item data when the template is rendered, before the LLM block is
executed. Undefined variables render as the empty string (Nunjucks default
behaviour; `autoescape` is off).

### Run LLM (the Composer's manual execution step)

The Composer's live preview **never** calls a model — every `{% llm %}` block
in the preview shows as an inert placeholder naming its target model and
context spec. Click **Run LLM** (shown only when the current render has
unresolved blocks) to resolve them:

- Blocks execute in document order, exactly once per click.
- **All-or-nothing:** if any block fails (context missing, HTTP error, empty
  response, etc.), *no* block results are kept and every block stays
  unresolved. The error is surfaced in a visible error box in the pane —
  never console-only.
- The resolved static markdown is what **Generate** uses. **Generate refuses
  while any `{% llm %}` block is unresolved** — the button is disabled with a
  visible reason, so a Summary Note can never be created with a hole.
- Switching the item or template invalidates any resolved output for the
  previous compose; you Run LLM again for the new one.

Templates with no `{% llm %}` blocks Generate immediately — no Run LLM button
appears.

### Missing-context failure

If the requested context exists (e.g. `abstract`) but the item's corresponding
data is empty (the item has no `abstractNote`), the run fails with a **clear
error naming the missing context**. No fallback to a different context, no
placeholder insertion.

### Body-only restrictions

LLM blocks are subject to the following validation rules. Any violation is a
parse error — the block is not executed and the error is surfaced:

| Restriction                     | Detail                                              |
|---------------------------------|-----------------------------------------------------|
| **Frontmatter**                 | LLM blocks are rejected inside YAML frontmatter.    |
| **Inside `%% zon %%`**          | LLM blocks are rejected inside live annotation blocks. |
| **Empty body**                  | The prompt body must be non-empty.                  |
| **Missing / empty context**     | `context` attribute is required and must be set.    |
| **Unknown context**             | A context name not in the supported list is rejected. |
| **Unclosed block**              | `{% endllm %}` missing → parse error.               |
| **Stray close**                 | `{% endllm %}` without a matching open → parse error. |

### No silent fallback

The interpreter **never guesses**. Every error scenario — parse errors,
missing context, HTTP failures (timeout, network error, non-200 status),
empty model responses, malformed JSON — **aborts the whole run**. Nothing is
written and the error is surfaced with a descriptive message.
