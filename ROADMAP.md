# Roadmap

This is a personal hard fork — see [README.md](README.md) for what it is and
[CONTEXT.md](CONTEXT.md) / [docs/adr/](docs/adr/) for the decisions behind it.
It doesn't carry upstream's roadmap; upstream's own is at
[Acatechnic/obsidian-notepad-for-zotero](https://github.com/Acatechnic/obsidian-notepad-for-zotero#readme)
and doesn't apply here (this fork has no vault/file/sync layer left to build on).

## Shipped in this fork

- **Identity break** — own plugin name, addon ID, and update feed, so an
  upstream release can never overwrite this build.
- **Generate Summary Note** — render a template into a native Zotero child
  note; strip live-block/frontmatter markup; convert to Zotero-note-safe HTML.
- **Composer pane** — template picker, live preview, Generate — replacing the
  old file-backed note editor in the item pane.
- **LLM in the Composer (ADR-0001)** — explicit Run LLM step, Generate refuses
  while any `{% llm %}` block is unresolved.
- **Note awareness + Stale Indicator** — list an item's existing Summary Notes
  (by Marker Tag), a read-only freshness badge, and a confirmed-overwrite path.
- **Template Builder rewired** to be template-authoring-only (no note I/O).
- **Teardown** — the entire Obsidian vault/file/sync/merge machinery deleted.

## What's next

Tracked as issues, not a roadmap doc — see the
[issue tracker](https://github.com/klueserthan/obsidian-notepad-for-zotero/issues).
