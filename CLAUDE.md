# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Zotero 7 plugin (XPI), **Paper Summarizer for Zotero**, that renders a
Nunjucks template for a Zotero item — its metadata, tags, related items, PDF
annotations, and optional LLM-resolved blocks — into a **Summary Note**: a
native Zotero child note (HTML), created once and never modified again. The
item pane's **Composer** section is the whole workflow: pick a template, see a
live preview, optionally run the LLM, click Generate. Built with
[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).
This is a hard fork of Acatechnic/obsidian-notepad-for-zotero with the entire
Obsidian vault/file/sync layer torn out — see `CONTEXT.md` for the domain
vocabulary and `docs/adr/` for the decisions (0001: LLM gating, 0002: the
Zotero-native note model, 0003: the fork itself).

## Commands

```bash
npm test                      # Vitest unit tests (Node) — test/*.spec.js
npm run test:watch
npx vitest run test/blocks.spec.js         # a single file
npx vitest run -t "idempotent"             # a single test by name
npm run test:zotero           # Mocha-in-Zotero integration tests — test/integration/
npm run build                 # build the .xpi into .scaffold/build/
npm start                     # launch Zotero with the plugin, hot reload
```

`npm start` and `npm run test:zotero` need a `.env` (copy `.env.example`) with a
Zotero binary path and a **dedicated dev profile**. `npm test` and `npm run build`
don't. CI runs unit tests + build, then integration tests.

## Architecture: three realms

The single biggest thing to internalise. Code lives in one of three places, and
which one it is dictates what it may import and how it's tested.

1. **`addon/bootstrap.js`** (~2.6k lines) — the privileged Zotero scope. A plain
   script, **not** a module: no `import`s, everything hangs off the `var ZON`
   object. This is the only place that touches Zotero APIs (`Zotero.Prefs`,
   `Zotero.Notifier`, `Zotero.Items`, item-pane registration). `startup()` sets
   `Zotero.ZON` as the dev/test handle. It builds the Composer pane, runs the
   render → strip → HTML pipeline, drives the LLM runner, and hosts the
   Template Builder overlay.
2. **`core/core.js` → `content/core.bundle.js`** (esbuild IIFE, global `ZONCore`) —
   re-exports the pure logic in `src/` plus its nunjucks/dayjs/markdown-it
   dependencies. Injected into the Zotero window by `ZON.injectCore()`.
3. **`editor/editor.js` → `content/editor.bundle.js`** (esbuild IIFE, global
   `ZOSEditorLib`) — a CodeMirror 6 markdown editor. It no longer backs the item
   pane (the Composer replaced it); it survives only **inside the Template
   Builder** overlay, loaded in the builder iframe's realm and driven through a
   small imperative API (`create`/`getDoc`/`setDoc`/`destroy`).

`src/*.js` is **pure ESM logic with no Zotero globals** — that's what makes it
unit-testable in Node. Two consequences:

- Anything needing a Zotero API belongs in `bootstrap.js`; anything that doesn't
  belongs in `src/` so it can be tested.
- **A new `src/` export is invisible to the plugin until it's re-exported from
  `core/core.js`.** bootstrap reaches it as `win.ZONCore.yourFn`.

Both bundles are declared in `esbuildOptions` in `zotero-plugin.config.ts`.

## Testing: two suites that must not mix

- `test/*.spec.js` — **Vitest**, plain Node, imports from `src/`. The default
  `npm test`.
- `test/integration/*.spec.js` — **Mocha inside a real headless Zotero**, uses
  `chai` and Zotero globals (`Zotero.ZON`, `IOUtils`, `PathUtils`). Run by
  `zotero-plugin test`.

`vitest.config.js` explicitly excludes `test/integration/**` — integration specs
can't run under Vitest and vice versa. Put a test in the suite matching the realm
of the code it covers.

## The core invariant: one-way render, create-once (ADR-0002)

A Summary Note is produced by a strict pipeline and is never touched again
after it's created — see `CONTEXT.md` for the vocabulary (Summary Note,
Composer, Create-once, Marker Tag, Stale Indicator) and
`docs/adr/0002-zotero-child-notes-one-way-create-once.md` for the decision.
The pipeline, run identically by the Composer's live preview and by Generate:

1. **Render** — the Nunjucks template (`src/render.js`) fills item data, then
   `%% zon kind=annotations … %%` blocks are filled from current annotations
   (colour/type/tag-filtered, per-block `format`) — this is the *authoring*
   model inherited from the file-based upstream plugin; `src/blocks.js` still
   owns it, but only as a render-side concern now (there is no
   read-back-and-reconcile "Update" — no `src/merge.js`, which was deleted in
   the teardown).
2. **Resolve `{% llm %}` blocks**, if any (see below) — never during preview.
3. **Strip** — `src/strip-markers.js` drops YAML frontmatter and every
   `%% zon %%` / `%% /zon %%` / `%% ann:KEY %%` delimiter, byte-identically
   preserving everything else.
4. **Convert** — `src/md-html.js` turns the stripped markdown into
   Zotero-note-safe HTML with a fixed, explicit markdown-it rule set.
5. **Create** — a new child note stamped with `ZON.MARKER_TAG`
   (`zps:summary-note`) is saved, or — only with explicit user confirmation —
   the newest existing Summary Note (found *solely* by that tag) is
   overwritten. No other note is ever read or modified.

`src/compose-gating.js` is the state machine that makes step 2 mandatory:
Generate throws (naming the offending blocks) if any `{% llm %}` block hasn't
been resolved via the Composer's explicit **Run LLM** action. `src/staleness.js`
computes the read-only Stale Indicator (newest Summary Note's `dateAdded` vs.
the item's annotations) — it never triggers a write.

## Other conventions worth knowing

- **`safeWrite` (atomic temp-file-rename) is now template-authoring-only.**
  The Template Builder's Save-as-default path writes into the Templates folder
  through `bootstrap.js`'s `safeWrite`. There is no longer a note-file write
  path at all — no mtime tracking, no conflict dialog, no note file on disk to
  conflict with. Don't reintroduce one; a Summary Note is written exactly once,
  through `Zotero.Items` (native notes), by the pipeline above.
- **Presentation logic is pure too.** `src/markers.js` and `src/preview.js`
  compute *character ranges* (marker hiding, reading view) with no CodeMirror
  dependency, still used by the Template Builder's editor and its
  `stripForPreview` preview path (`src/builder.js`). Keep new range-finding in
  `src/`.
- **Prefs** are declared in `bootstrap.js` as paired `PREF_*` / `DEFAULT_*`
  constants under the `extensions.zotero-obsidian-notes.` prefix (kept as a
  legacy identifier, ADR-0003), and surfaced in
  `addon/content/preferences.xhtml`. Only prefs something actually reads belong
  here — the vault/notes-folder/filename-pattern/auto-sync/tag-sync/experimental
  prefs from the file-sync era were removed in the #31 sweep, and the legacy
  templatePath/formatsDir fallbacks plus the image-annotation-folder pref in a
  later cleanup (the addon-owned, seeded templates folder made the fallbacks
  redundant, and image embeds are vestigial text in a Zotero note); the
  templates-folder, default-template, and all LLM prefs remain live.
- **Templates are Nunjucks.** Starter templates ship inline as
  `ZON.BUILTIN_TEMPLATES` in `bootstrap.js` (they double as a zero-config
  fallback). User docs: `docs/TEMPLATES.md`.
- **UI strings** are centralised in `STRINGS` in `bootstrap.js`. Fluent ids in
  `addon/locale/` are already namespaced `zon-*`, and scaffold is configured
  *not* to re-prefix them (`fluent.prefixLocaleFiles/prefixFluentMessages: false`).
- **`__key__` tokens** (e.g. `__addonID__`) in non-script addon files are replaced
  at build time from `pkg.config` (see `build.define`).
- **LLM features are BYOK, explicit, and static** — see
  `docs/adr/0001-explicit-static-llm-interpreter.md`. Model calls happen only via
  the Composer's explicit **Run LLM** action on `{% llm context="..." %}`
  blocks, get replaced with static markdown, and must **fail loudly** rather
  than fall back to weaker context. Never wire an LLM call into rendering,
  preview, template switching, or item switching.
- **Changelog**: add entries under `## [Unreleased]` (Keep a Changelog format);
  `scripts/stamp-changelog.mjs` dates and stamps them at release.
- **Release** is cut locally (`npm run release`), not from CI. `bumpp`'s `execute`
  must stay a **single** npm script — it runs without a shell, so a chained
  `"a && b"` string silently skips the build (this shipped a stale xpi once).

## Agent-facing docs

`docs/agents/` holds conventions the skills consume: `domain.md` (read
`CONTEXT.md` / `docs/adr/` before exploring), `issue-tracker.md` (issues live
on GitHub, use `gh`), and `triage-labels.md`. `.opencode/AGENTS.md` describes
the OpenCode agent setup and is not binding on Claude Code.
