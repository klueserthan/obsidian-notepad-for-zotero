# Summary Notes are native Zotero child notes — one-way, create-once

The plugin's output moves from markdown files in an Obsidian vault to native Zotero
child notes (HTML), because Better Notes is now the reading/adaptation surface and
notes should live and sync inside the Zotero library. Rendering is strictly one-way:
Generate converts template output (markdown, live-block delimiters stripped) to HTML
via a converter bundled in core and creates a new child note stamped with a marker
tag. A note is never modified after creation — regenerating produces a new note (or
requires explicit confirmed overwrite) — so hand edits made in Better Notes are always
safe. The only sync remnant is a read-only stale indicator (newest Summary Note's
dateAdded vs. the item's annotations).

## Considered Options

- **Markdown attachment on the item** — would have kept the entire block/merge/editor
  machinery working unchanged, but the notes would not be readable/adaptable in Better
  Notes, which is the point.
- **Managed blocks inside the Zotero note (two-way)** — preserving the adapt-and-update
  workflow would require rebuilding the idempotent merge engine against Zotero's
  sanitized HTML; markdown↔HTML round-tripping is lossy, so the core invariant
  (`merge(merge(e,f), f) === merge(e,f)`) cannot be guaranteed. Rejected for v1.
- **Hidden HTML markers for note identity** — rejected as fragile under Zotero's
  sanitizer and Better Notes editing; a Zotero tag on the note is the identity marker.

## Consequences

- The file pipeline dies: vault detection, `obsidian://` links, atomic conflict-checked
  writes, mtime tracking, tag sync, annotation Notifier writes, and the merge/blocks
  engine as a write path are all deleted, along with their idempotency test burden.
- The item pane becomes the Composer (template picker + live preview + Run-LLM +
  Generate); the CodeMirror editor survives only inside the Template Builder.
- New annotations never flow into an existing note; the user generates a fresh note
  when the stale indicator says it is worth it.
