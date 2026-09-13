# Paper Summarizer for Zotero

A Zotero 7 plugin that generates **LLM-assisted Summary Notes** for your items —
native Zotero child notes, built from a template, read and adapted with
[Better Notes](https://github.com/windingwind/zotero-better-notes). There is no
Obsidian vault, no markdown file on disk, and nothing syncs after a note is
created.

> Status: **personal fork, unreleased**. Zotero 7+, [AGPL-3.0](LICENSE). Not
> published to any plugin directory or release feed — build it yourself (see
> [Install](#install)).

## Why

[Acatechnic/obsidian-notepad-for-zotero](https://github.com/Acatechnic/obsidian-notepad-for-zotero)
(this plugin's upstream) puts an Obsidian vault note in the Zotero item pane and
syncs PDF highlights into it. This fork throws that model out: **if you don't use
Obsidian**, but you do want an LLM to turn a paper's abstract, annotations, or
full text into a structured note you keep in Zotero, this is that instead.

**If you use Obsidian, use the upstream plugin** — this fork has no vault
support, no file editor, and no annotation sync; none of that is coming back.

## What it does

- **Composer** — an item-pane section replacing the old note editor. Pick a
  **template**, see a live preview of the Summary Note it would generate for the
  selected item, then **Generate**.
- **Summary Notes** are native Zotero child notes (HTML), created **once** per
  Generate. The plugin never touches a Summary Note behind your back — the only
  way one changes after creation is you choosing Overwrite and confirming it, so
  hand edits you make in Better Notes are always safe. Regenerating otherwise
  creates an additional note.
- **Marker Tag** — every Summary Note is stamped with a Zotero tag
  (`zps:summary-note`) so the plugin can recognize its own notes. That's the only
  thing that identifies one; title and body content are never inspected.
- **Stale Indicator** — a read-only badge in the Composer showing whether an
  item's newest Summary Note is `fresh`, `stale` (an annotation changed after it
  was created), or missing. It never writes anything; it's a hint to regenerate.
- **LLM-assisted templates (BYOK).** A template can include `{% llm
  context="..." %}` blocks. The Composer preview never calls a model — each
  block shows as an inert placeholder — until you click **Run LLM**, which
  resolves every block once via your own OpenAI-compatible endpoint (local
  Ollama, OpenAI, LM Studio, …) and substitutes static markdown. **Generate
  refuses while any block is unresolved**, so a Summary Note can never be
  created with a hole. See [docs/adr/0001-explicit-static-llm-interpreter.md](docs/adr/0001-explicit-static-llm-interpreter.md).
- **Template Builder** — a note-type editor: markdown source beside a live
  preview against a real item, with required name/paper-type fields and
  Save, Duplicate, Rename, Delete, and Reset to built-in. It authors and
  saves note types only; it no longer reads or writes an item's note.
- **Find DOI (Crossref)** — a small item-menu action to look up a missing DOI
  for one or more selected items.
- **Automatic mode (opt-in)** — a Settings toggle, off by default, that runs
  the same pipeline as Generate unattended on a periodic sweep for items
  carrying a trigger tag. See [Automatic mode](#automatic-mode-opt-in) below.

## How a Summary Note is made

1. The selected **template** (Nunjucks, with the same block syntax the upstream
   plugin uses for colour/type/tag-filtered annotation blocks) is rendered
   against the item's metadata, tags, related items, and PDF annotations.
2. Any `{% llm %}` blocks are resolved (if you ran them) or shown as
   placeholders (if you didn't — Generate will refuse).
3. YAML frontmatter and all `%% zon … %%` / `%% ann:KEY %%` block delimiters are
   stripped — they're an authoring artifact of the template, not something a
   Zotero note should show.
4. The stripped markdown is converted to Zotero-note-safe HTML and saved as a
   new child note carrying the Marker Tag.

This is strictly **one-way**: nothing is ever synced back, and no existing note
is read or modified except through the explicit overwrite confirmation. See
[docs/adr/0002-zotero-child-notes-one-way-create-once.md](docs/adr/0002-zotero-child-notes-one-way-create-once.md).

## Requirements

- Zotero 7 or later.
- An OpenAI-compatible LLM endpoint if you want to use `{% llm %}` blocks
  (optional — templates without them work with no LLM configured). Bring your
  own key/endpoint; the plugin doesn't ship a model.
- [Better Notes](https://github.com/windingwind/zotero-better-notes) is
  recommended for reading and hand-editing Summary Notes afterward (not a hard
  dependency — they're plain Zotero notes).

## Install

There's no packaged release yet. Build the `.xpi` yourself:

```bash
git clone https://github.com/klueserthan/obsidian-notepad-for-zotero.git
cd obsidian-notepad-for-zotero
npm install
npm run build
```

The built `.xpi` lands in `.scaffold/build/`. In Zotero: **Tools → Plugins →
gear icon → Install Plugin From File…** and choose it.

## Using it

1. Select an item in Zotero. Open the **Composer** section in the item pane.
2. Pick a **template** from the dropdown (defaults to your configured default
   note template).
3. Read the live preview. If the template has `{% llm %}` blocks, click **Run
   LLM** to resolve them (requires a configured base URL + model in
   Preferences).
4. Click **Generate**. If the item already has a Summary Note, you'll be asked
   whether to overwrite the newest one or create an additional one.
5. Open the created note in **Better Notes** to read or hand-edit it — the
   plugin will never touch it again.

## Automatic mode (opt-in)

Settings → Paper Summarizer has an **Automatic Summary Notes** toggle, off
by default. Switch it on and, while desktop Zotero is running, a sweep at
startup and every few minutes finds personal-library items carrying the
**trigger tag** (default `zps:summarize`) and runs them through the same
pipeline as Generate — no click, no review — using paper-type detection to
pick a note type (falling back to your default note template when it can't
decide).

**This sends the full text of every tagged paper to your configured LLM
unattended**, including the whole backlog of already-tagged items the
moment you switch the mode on. Treat the trigger tag like your API key:
anyone who can write tags to your library (a Web API key with write scope,
another signed-in device) can trigger a paid run by adding it, in any
number — this mode adds no cap. The resulting notes are unreviewed model
output over an unvetted PDF; nothing checks them before they sync to the
iPad, the same trust boundary as clicking Generate yourself.

An item without full text yet keeps waiting. Zotero only gets full text for
a PDF it downloaded and indexed itself, so this relies on the default sync
setting (download files at sync time) staying on — with on-demand download
instead, an agent-added PDF never gets indexed and every tagged item times
out. Once the **full-text wait** (default 24 hours, also in Settings) passes
with still no full text, the trigger tag is replaced by a "no full text"
failure tag; any other failure gets a different failure tag. Re-adding the
trigger tag retries. A paper whose full text is larger than your configured
max-context setting fails and stays failed until you raise that limit —
re-tagging alone won't fix it.

The mode runs only while desktop Zotero's main window is open on this
machine; it does nothing while Zotero is closed, and only one desktop
should run it per synced library, or two machines can each create a note
for the same tag before either syncs. See
[docs/adr/0004-opt-in-automatic-summary-notes.md](docs/adr/0004-opt-in-automatic-summary-notes.md).

## Templates

Every template you can pick in the Composer is a **note type**: a whole-note
Nunjucks template declaring a paper type (a short label plus a one-line
description) so it can be chosen automatically for a batch of items. Note
types are authored in **Nunjucks** and use the same block syntax the upstream
plugin uses for organizing annotations — colour routing
(`highlights(colour="yellow")`), built-in per-annotation formats
(`list`/`quote`/`callout`/`compact`), and tag filters (`tag=method`) all still
work as authoring input. What's different: the `%% zon %%` delimiters and any
YAML frontmatter are **stripped before the note is created** — a Summary Note
never contains them. Author and preview note types with the **Template
Builder** (opened from the Composer), or hand-edit files in your Templates
folder. See [docs/TEMPLATES.md](docs/TEMPLATES.md) for the full reference,
including `{% llm %}` block syntax and supported contexts (`abstract`,
`annotations`, `fulltext`).

## Development

```bash
npm install
npm test            # unit tests (Vitest) — pure logic in src/
npm run test:zotero # integration tests (Mocha inside a throwaway Zotero)
npm run build       # build the .xpi into .scaffold/build/
npm start           # launch Zotero with the plugin (hot reload)
```

Built with [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).
`npm start` / `npm run test:zotero` need a `.env` (copy `.env.example`) pointing
at a Zotero binary and a dedicated dev profile. See [CLAUDE.md](CLAUDE.md) for
the architecture and [CONTEXT.md](CONTEXT.md) / [docs/adr/](docs/adr/) for the
domain vocabulary and the decisions behind this fork.

## About this fork

This is a personal hard fork of
[Acatechnic/obsidian-notepad-for-zotero](https://github.com/Acatechnic/obsidian-notepad-for-zotero) —
all credit for the original plugin, the Nunjucks template engine, and the
Template Builder goes to them. This fork removed the entire Obsidian
vault/file/sync layer and replaced it with Zotero-native, LLM-assisted Summary
Notes; it no longer tracks upstream (see
[docs/adr/0003-final-upstream-merge-hard-fork.md](docs/adr/0003-final-upstream-merge-hard-fork.md)).
**If you want an Obsidian vault note in your Zotero item pane, use the upstream
plugin instead** — this fork can't do that anymore.

## License

[AGPL-3.0](LICENSE), inherited from upstream.
