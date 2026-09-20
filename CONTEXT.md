# Zotero Paper Summarizer (fork context)

A personal Zotero 7 plugin, forked from obsidian-notepad-for-zotero, that generates
LLM-assisted summary notes for Zotero items. Notes are stored in the Zotero library
itself (read/adapted via Better Notes), not in an Obsidian vault.

## Language

**Summary Note**:
A native Zotero child note created by rendering a template for an item.
_Avoid_: vault note, linked note, markdown file

**One-way render**:
The plugin renders a Summary Note once and never modifies it afterwards; there is no
sync-back or merge into an existing note.
_Avoid_: sync, update, refresh (for notes)

**Create-once**:
Regenerating produces a new Summary Note (or requires explicit confirmed overwrite);
hand edits made in Better Notes are never silently touched.

**Template**:
A Nunjucks template (with optional `{% llm %}` blocks) that defines a Summary Note's
content. Authored/previewed via the Template Builder, now a note-type editor.

**Note Type**:
A template that declares one unique paper type (a short label plus a one-line
description) — the only kind of template offered for generating a Summary Note. A
template without a paper type stays editor-only until it declares one.
_Avoid_: block template, general template

**Composer**:
The plugin's item-pane section: template picker, live rendered preview for the
selected item, LLM-block execution, and a Generate action that creates the Summary Note.
_Avoid_: editor, notepad (the pane no longer edits notes)

**Marker Tag**:
The Zotero tag stamped on every generated Summary Note; the only way the plugin
recognizes its own notes (for the Stale Indicator and already-has-one checks).
Body edits in Better Notes never affect it.

**Stale Indicator**:
A read-only signal in the Composer that an item has annotations newer than its
newest Summary Note (compared via the note's dateAdded). It never triggers a write.
_Avoid_: auto-sync, refresh

**Automatic Mode**:
An opt-in Settings toggle (off by default) that runs the same render →
resolve → create pipeline as Generate on a periodic sweep, with no click,
for personal-library items carrying the **Trigger Tag**. The one exception
to ADR-0001's user-triggered rule; see ADR-0004.
_Avoid_: auto-sync, background sync

**Trigger Tag**:
The Zotero tag (default `zps:summarize`) that selects an item for
**Automatic Mode**. Removed on success; re-adding it after a **Failure Tag**
retries the item.

**Failure Tag**:
The tag **Automatic Mode** swaps the **Trigger Tag** for when it can't
produce a Summary Note — one tag for "no full text after the wait," a
different one for every other failure — so the outcome is visible on the
iPad, where the plugin doesn't run.

**Abstract Marker Tag**:
The tag (`zps:abstract-extracted`) the plugin adds to an item whose empty
Abstract field it filled with the paper's own abstract, copied verbatim from
the indexed PDF text. It marks the abstract as extracted rather than
publisher metadata; removing it changes nothing else. See ADR-0005.
_Avoid_: generated abstract, AI abstract

**Upstream**:
Acatechnic/obsidian-notepad-for-zotero — the Obsidian-vault-based origin of this fork.

## Relationships

- A **Template** renders to exactly one **Summary Note** per invocation
- A **Summary Note** belongs to exactly one Zotero item (as a child note) and carries the **Marker Tag**
- An item may accumulate several **Summary Notes** over time; the **Stale Indicator** compares the newest one against the item's annotations
- **Create-once** is the regeneration policy of **One-way render**
- All item data (metadata, annotations, colour routing, tags, fulltext, LLM output) enters a **Summary Note** only at generate time, through the **Template** — there is no event-driven sync; **Automatic Mode**'s periodic sweep (ADR-0004) polls on a timer rather than reacting to Zotero events, so this still holds
- The **Composer** preview never executes `{% llm %}` blocks (placeholder shown); an explicit Run-LLM action resolves them, and Generate refuses while any block is unresolved (ADR-0001)
- Live-block syntax (`%% zon %%`, `%% ann:KEY %%`) survives only as the **Template**/Builder authoring model; the generate/preview pipeline strips all delimiters before markdown→HTML, so a **Summary Note** never contains them
- Old Obsidian vault notes are not migrated by the plugin; anything worth keeping is imported manually (e.g. via Better Notes)

## Example dialogue

> **Dev:** "New annotations were added to the PDF — do we update the item's **Summary Note**?"
> **Domain expert:** "Never. Notes are **create-once**: the user can generate a fresh
> **Summary Note** that includes them, but the old one — and any edits made to it in
> Better Notes — is left byte-identical."

## Flagged ambiguities

- "notes in my Zotero library" could have meant markdown attachments, a plain folder,
  or native notes — resolved: native Zotero child notes (HTML), because Better Notes
  is the reading/adaptation surface.
- "sync" used to mean event-driven writes into the note; after the break it survives
  only as the read-only **Stale Indicator** — never call note generation "sync".
- The `ZON` global, `zon-` fluent ids, and `extensions.zotero-obsidian-notes` prefs
  prefix are retained as internal legacy identifiers after the user-facing rename
  (new addonName/addonID/updateURL) — deliberate, to avoid churn across bootstrap.
