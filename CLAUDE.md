# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Zotero 7 plugin (XPI) that opens each Zotero item's linked Obsidian vault
markdown note in the item pane, and syncs PDF annotations into it. Built with
[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).
The note is a plain `.md` file in the user's vault — there is no hidden database.

## Commands

```bash
npm test                      # Vitest unit tests (Node) — test/*.spec.js
npm run test:watch
npx vitest run test/merge.spec.js          # a single file
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

1. **`addon/bootstrap.js`** (~3.3k lines) — the privileged Zotero scope. A plain
   script, **not** a module: no `import`s, everything hangs off the `var ZON`
   object. This is the only place that touches Zotero APIs (`Zotero.Prefs`,
   `Zotero.Notifier`, `IOUtils`, item-pane registration). `startup()` sets
   `Zotero.ZON` as the dev/test handle.
2. **`core/core.js` → `content/core.bundle.js`** (esbuild IIFE, global `ZONCore`) —
   re-exports the pure logic in `src/` plus its nunjucks/dayjs dependencies.
   Injected into the Zotero window by `ZON.injectCore()`.
3. **`editor/editor.js` → `content/editor.bundle.js`** (esbuild IIFE, global
   `ZOSEditorLib`) — a CodeMirror 6 markdown editor, loaded inside the pane's
   **iframe realm** (not the host div) and driven through a small imperative API
   (`create`/`getDoc`/`setDoc`/`destroy`).

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

## Live blocks: the core invariant

Annotation content lives in "managed blocks" delimited by invisible Obsidian
comments, with each annotation anchored by its stable Zotero key:

```
%% zon kind=annotations colour=yellow type=highlight sync=on format=quote %%
> ...rendered annotations...   %% ann:ABCD1234 %%
%% /zon %%
```

**Update/sync must be idempotent**: it regenerates only blocks whose `sync` is not
`off`, and leaves prose, frozen blocks and frontmatter byte-identical.
`merge(merge(e,f), f) === merge(e,f)`. `src/blocks.js` (block engine) and
`src/merge.js` (anchor-based structural merge) own this; changes there need
idempotency coverage.

Related: frontmatter keys are split into Zotero-owned (refreshed on render) and
user-owned (never clobbered), and a reserved `zon:` frontmatter block holds
per-note manifest overrides (`src/manifest.js`).

## Other conventions worth knowing

- **Writes are atomic and conflict-checked.** Every write goes to a temp file and
  is renamed over the target; each open note's mtime is tracked so an
  externally-edited note is never silently overwritten. Don't add a plain write
  path — see the "data safety" section of `bootstrap.js`.
- **Presentation logic is pure too.** `src/markers.js` and `src/preview.js`
  compute *character ranges* (marker hiding, reading view) with no CodeMirror
  dependency; `editor/editor.js` turns them into Decorations. Keep new
  range-finding in `src/`.
- **Prefs** are declared in `bootstrap.js` as paired `PREF_*` / `DEFAULT_*`
  constants under the `extensions.zotero-obsidian-notes.` prefix, and surfaced in
  `addon/content/preferences.xhtml`.
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
  user-triggered actions on explicit `{% llm context="..." %}` blocks, get replaced
  with static markdown, and must **fail loudly** rather than fall back to weaker
  context. Never wire an LLM call into normal refresh or auto-sync.
- **Changelog**: add entries under `## [Unreleased]` (Keep a Changelog format);
  `scripts/stamp-changelog.mjs` dates and stamps them at release.
- **Release** is cut locally (`npm run release`), not from CI. `bumpp`'s `execute`
  must stay a **single** npm script — it runs without a shell, so a chained
  `"a && b"` string silently skips the build (this shipped a stale xpi once).

## Agent-facing docs

`docs/agents/` holds conventions the skills consume: `domain.md` (read
`CONTEXT.md` / `docs/adr/` before exploring — proceed silently if absent, and they
are currently absent), `issue-tracker.md` (issues live on GitHub, use `gh`), and
`triage-labels.md`. `.opencode/AGENTS.md` describes the OpenCode agent setup and
is not binding on Claude Code.
