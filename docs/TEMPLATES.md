# Paper Summarizer for Zotero — Templates

This is the reference for writing a **note type** — a template in your
Templates folder that the Composer's picker renders into a Summary Note.
Every note type is a whole-note scaffold that declares a **paper type** in its
YAML frontmatter:

```yaml
---
paperType: inferential
paperTypeDescription: Quantitative study that states hypotheses and tests them with statistical inference
---
```

`paperType` is a short, unique label and `paperTypeDescription` a one-line
description of the papers it fits (they never appear in the rendered note;
frontmatter is stripped as always). A file without both keys is **not** a
note type: it never appears in the Composer picker, the Settings →
*Default note template* dropdown, or the bulk summary-note dialog, and bulk
auto-detection can't choose it — it only shows up in the Template Builder's
note-type list, flagged as needing a paper type. Fill in the label and
description there (or by hand) and it becomes a real note type.

A file named after one of the four shipped note types (below) that carries no
declaration of its own inherits the shipped one, so a Templates-folder copy
seeded before paper types existed keeps working without edits.

No two note types may share a paper type label — bulk detection maps one
label to exactly one note type, so saving a duplicate label is refused.

**Where the folder lives:** by default the plugin manages its own folder —
`paper-summarizer/templates` under your Zotero data directory. It is created
on startup and **seeded** with the starter note types. Seeding remembers,
per folder, which shipped note types it has already created there, so
deleting or renaming one of them is remembered — it is not re-created on the
next start (your edits to an existing file are never overwritten either way).
The starters are Obsidian-free: no YAML frontmatter beyond the paper-type
keys, no `[[wikilinks]]`, no `> [!callout]` syntax. You can point the
*Templates folder* preference somewhere else if you want to relocate it.

**Retired templates are archived, not deleted.** The first time the plugin
starts after an update that retires a shipped template, any of those old
files still sitting in your Templates folder are moved into an `archive`
subfolder that no picker or editor reads — nothing is ever deleted. Move a
file back out of `archive` by hand to restore it; it's then treated like any
other file (add a paper type to make it a note type again).

Add or edit a file in the Templates folder on disk, or use the **Template
Builder** (opened from the Composer) as a note-type editor: markdown source
beside a live rendered preview for the selected item, with required fields
for the note type's name, paper type label, and description, an Insert menu
for common snippets (an `{% llm %}` prompt, an annotations section, the
citation, the abstract), and New, Duplicate, Rename, Delete, and Reset to
built-in actions. Delete moves a note type's file into the archive subfolder
after confirmation rather than deleting it, and is refused for the last
remaining note type; Reset to built-in is offered only for the four shipped
note types. Templates are cached in memory and reloaded when the Template
Builder opens (it also reloads and re-selects a note type right after you
save one there); if you hand-edit a template file directly, open the Builder
once (or restart Zotero) to pick it up.

---

## The language is Nunjucks

Templates are written in **Nunjucks**. You have `{{ variable }}`,
`{% if %}` / `{% for %}`, and filters like `{{ date | format("YYYY") }}`.

### Variables available inside an annotations section (per highlight)

These are the variables the built-in per-annotation formats (`list`, `quote`,
`callout`, `compact`) render with, one highlight at a time. You don't author
format bodies yourself — pick one by name with `format=` — but knowing these
matters for the `tag=`/`colour=`/`type=` filters below.

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
the Zotero reader), distinct from the item-level `{{allTags}}` in a note type.
Use it to carry per-highlight role markers — tag highlights `method` /
`finding` / `quote` and filter a section on them (see `tag=` below).

### Variables in a note type and in a `kind=field` element (whole-item)

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

(These whole-item variables work in a note type's own markdown and in
`kind=field` elements, **not** inside an annotations section, whose context is
the highlight, not the item.)

---

## Routing highlights by colour in a note type

A note type can place annotation sections wherever you want, so blue
highlights land in one section and yellow in another. Use the
`highlights(...)` helper: each call drops in a section that's filled with the
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
section filled with just that colour's highlights, in place.

`highlights(...)` options (all optional):

| Argument  | Example | Meaning |
| --- | --- | --- |
| `colour`  | `highlights(colour="blue")` or `highlights("blue")` | Only this colour (`yellow`/`red`/`green`/`blue`/`purple`/`magenta`/`orange`/`grey`). Omit for **all** colours. |
| `type`    | `type="image"` | Only this annotation type. Omit for all. |
| `format`  | `format="quote"` | Which built-in per-annotation format to render with (`list`, `quote`, `callout`, `compact`). Defaults to `list`. |
| `sync`    | `sync="off"` | See "`sync` in the generate pipeline" below. |

---

## `%% zon … %%` blocks — the authoring model

When a note type is rendered, each `highlights(...)` call is wrapped in a
pair of invisible-in-Obsidian comment markers — inherited unchanged from the
file-based upstream plugin's authoring syntax:

```
%% zon kind=annotations colour=yellow type=highlight sync=on format=quote %%
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
| `format` | `list`, `quote`, `callout`, `compact` | Which built-in per-annotation format renders the body. |
| `style` | `list`, `quote`, `callout` | Compose a body from a base style plus `parts` instead of a named `format`. Takes precedence over `format`. |
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
   has one, is dropped. It holds the note type's paper type declaration (set
   through the note-type editor's fields) and never reaches the generated
   note.
4. **Strip markers** — every `%% zon … %%` / `%% /zon %%` line and every
   `%% ann:KEY %%` anchor is removed, byte-identically preserving everything
   else.
5. **Title** — the generic heading `# Summary: <item title>` is prepended
   automatically (Zotero titles a note from its first line, so every generated
   note is instantly recognizable). **Don't start a template with your own
   `# H1`** — you'd get two.
6. **Markdown → HTML** — the stripped markdown is converted with a fixed,
   explicit rule set (headings, lists, blockquotes, links, emphasis, code,
   tables, strikethrough, hard breaks; raw HTML is escaped, never passed
   through) and saved as the Summary Note's content.
7. **Create** — a new Zotero child note carrying the Marker Tag
   (`zps:summary-note`) is created, or (with your explicit confirmation) the
   newest existing Summary Note is overwritten. No other note is ever touched.
   The note also gets a Note Type Tag naming the template's paper type, e.g.
   `zps:summary-note:inferential`; a template that declares no paper type
   gets the Marker Tag alone, and an overwrite swaps the old type tag out.

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

## The shipped note types (one per paper type)

Whole-note scaffolds that fill each section from the paper's full text with
`{% llm context="fulltext" %}` blocks. Pick the one that fits the paper in the
Composer, click **Run LLM**, then **Generate**. They need a configured model
(Settings → LLM) and a PDF with extractable text — like all `fulltext` blocks
they fail loudly (ADR-0001) rather than guess. Each also keeps a `## Notes`
scratch area and a `## Annotations` block for your highlights.

- **`note-quantitative.md`** — declares the **`inferential`** paper type:
  research questions, hypotheses, theoretical framework, study design, a
  key-variables table, main findings, limitations. The file keeps its original
  name; rename it in the Template Builder if you want the two to match, which
  also moves your Settings default across.
- **`note-descriptive.md`** — aim & research questions, data and measures,
  analytic approach, main patterns, interpretation & caveats. For quantitative
  papers that describe or explore rather than test hypotheses.
- **`note-qualitative.md`** — research questions, theoretical framing, methods
  & data, key themes, interpretation & contribution, trustworthiness & limits.
- **`note-theoretical.md`** — motivating problem, constructs & definitions
  table, propositions, model/mechanism, scope conditions, contribution & critique.
- **`note-review.md`** — scope & questions, corpus & method, organizing
  framework, key findings/debates, identified gaps, future research agenda.

Each of these five opens with the frontmatter block described at the top of
this document, declaring its paper type. That declaration is what makes it a
note type at all: it's how it reaches the Composer picker, the Settings
default, and the bulk dialog, and how bulk auto-detection picks a candidate
for a paper (`paperTypeDescription` helps the model choose). Detection reads
the item's abstract; for an item without one, "Detect types" first extracts
the paper's own abstract from its indexed PDF text and saves it to the item.

A copy of one of the five starters that keeps the starter's file name and has
no declaration of its own (for example, a Templates-folder copy seeded before
these keys existed) is treated as that starter's paper type. If you copy a
starter under a new name to make your own variant, carry the
`paperType`/`paperTypeDescription` keys over (and adjust them) — a renamed
copy with no declaration is not offered for generation until it has one.

Copy any of these on disk to start a variant, or use New / Duplicate in the
note-type editor. Save is refused, with the reason shown, while the name,
paper type label, or description is empty, or the label is already used by
another note type. The built-in formats `list`, `quote`, `callout`, `compact`
are always present even if the Templates folder is empty or unset.

---

## LLM-assisted templates (`{% llm %}` blocks)

Templates can include **LLM blocks** — prompt-marked regions resolved by an
LLM and replaced with static markdown. See
[docs/adr/0001-explicit-static-llm-interpreter.md](adr/0001-explicit-static-llm-interpreter.md)
for the design rationale: model calls are BYOK, explicit, and never part of
normal rendering — except the opt-in **Automatic mode** (README, ADR-0004),
off by default, which runs this same resolve step unattended on a periodic
sweep for items carrying its trigger tag.

**Requirements:**
- An LLM provider must be configured in Settings → Paper Summarizer → LLM
  Interpreter (base URL + model).
- A template containing an `{% llm %}` block is a note type's whole-note
  render — it runs once **per item**, never once per annotation.
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

- Blocks execute exactly once per click. By default they run one at a time in
  document order; the **Parallel requests** preference (1–8, default 1) lets
  hosted APIs run several block requests at once — outputs always land back in
  document order. Keep it at 1 for a local Ollama, which serves requests
  serially (the request timeout includes time spent queued on the server).
- Blocks that share a context spec send **byte-identical request prefixes**:
  the system prompt and the resolved context come first and only the short
  task text differs at the end. OpenAI-compatible providers with automatic
  prompt/prefix caching therefore process the (potentially very large) context
  once and reuse it across the remaining blocks instead of re-processing it
  per block.
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
