# AGENTS.md — Obsidian Notepad for Zotero

Zotero 7+ plugin (AGPL-3.0, public beta). Lets a user open and edit each item's
Obsidian vault markdown note inside the Zotero item pane, and sync PDF
highlights into it. Built with [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold).

## Quick start

```bash
npm install
npm test            # Vitest unit tests — pure logic, no Zotero needed
npm run build       # packages the .xpi into .scaffold/build/
npm start           # launches a Zotero with the plugin (hot reload)
```

`npm start` and `npm run test:zotero` need a `.env` — see `.env.example`. The
`ZOTERO_PLUGIN_PROFILE_PATH` must be a **dedicated dev profile**; never point
this at the user's everyday Zotero profile.

## Commands

| Command                  | What it does                                                              |
| ------------------------ | ------------------------------------------------------------------------- |
| `npm test`               | Vitest — `test/*.spec.js`, imports `src/` directly. No Zotero.            |
| `npm run test:zotero`    | Mocha inside a throwaway Zotero — `test/integration/*.spec.js`.           |
| `npm run build`          | Build the `.xpi` to `.scaffold/build/`.                                   |
| `npm start`              | Launch Zotero with the plugin loaded (hot reload via scaffold).           |
| `npm run sync-version`   | Rewrite the version-pinned `.xpi` link in README.                        |
| `npm run release:build`  | `sync-version` + `build` (single npm script = one shell).                 |
| `npm run release`        | Cut a GitHub release locally (`enable: "local"`). Needs `GITHUB_TOKEN`.   |

**Run order in CI** (`.github/workflows/ci.yml`): `npm test` → `npm run build`
→ upload `.xpi` → `npm run test:zotero`. If you touch the build config or shared
contracts, escalate to the broader verification.

**Single-test focus:**
- Vitest: `npx vitest run test/blocks.spec.js` (or whatever file).
- Mocha integration: run `npm run test:zotero`; files are picked up automatically.

## Source layout

```
addon/         bootstrap.js (2661 lines — UI + lifecycle monolith, intentional)
               manifest.json (with __token__ placeholders — see below)
               content/preferences.{xhtml,js}   Zotero preferences pane
               locale/en-US/*.ftl               Fluent strings (UI chrome only)
editor/        editor.js   CodeMirror 6 wrapper → bundled as ZOSEditorLib (IIFE)
core/          core.js     Re-exports from src/ → bundled as ZONCore (IIFE)
src/           Pure logic modules (annotations, blocks, merge, manifest, paths,
               templates, render, preview, markers, tagsync, formats, colors,
               item-data, crossref). ES modules, no DOM, no Zotero globals —
               the only code that vitest exercises directly.
test/          *.spec.js           Vitest unit tests (import from ../src)
               integration/*.spec.js   Mocha + chai, run inside Zotero
               fixtures/           sample templates + note data
scripts/       sync-readme-version.mjs   one-shot README rewriter
```

The two IIFE bundles are injected into the Zotero main window as globals:
- `ZOSEditorLib` — CodeMirror editor; loaded **inside each note's iframe** (not
  the main window) so the editor gets a real HTML document with a working
  `Selection`.
- `ZONCore` — nunjucks + dayjs template/merge engine, plus all of `src/`.
  Loaded into the main window.

`zotero-plugin.config.ts` controls which dirs the scaffold scans:
`source: ["addon", "editor", "core", "src"]`.

## Strings (UI text)

Two places, two different rules:

1. **JS strings** — `STRINGS` object in `addon/bootstrap.js` (around line 338).
   Look up via `t(key, args)` with `{name}` placeholders. This is the bulk of
   the user-facing copy (buttons, banners, statuses, errors, menu items).
2. **Fluent strings** — `addon/locale/en-US/zotero-obsidian-notes.ftl`. ~12
   messages, all UI chrome (item-pane header, sidenav, two toolbar buttons).
   The item-pane section header / sidenav must use Zotero's `l10nID` mechanism,
   so this is the only file that gets read by Fluent.

Both files reference ids/keys **verbatim** (`zon-*` in FTL, `btn.*` / `status.*`
/ etc. in `STRINGS`) — see the `fluent` config note below.

## Build config gotchas (`zotero-plugin.config.ts`)

These are easy to break silently. Each has a comment in the file explaining
why, but the agent-friendly version is:

- **`fluent.prefixLocaleFiles: false` and `prefixFluentMessages: false`** —
  keeps `zotero-obsidian-notes.ftl` filename and `zon-*` message ids verbatim
  (JS references them by exact name). **Do not turn these on** without also
  updating every reference in `bootstrap.js` and the FTL file.
- **`__key__` tokens in non-script addon files** (`manifest.json`, `.ftl`,
  preferences XHTML) get replaced at build time from the `build.define` map
  in the config, which spreads `package.json#config` (`addonName`, `addonID`,
  `addonRef`, `prefsPrefix`, `addonInstance`) + author/description/homepage/
  buildVersion. The source files contain literal `__addonID__` etc. — that's
  expected; do not hardcode real values.
- **`release.bumpp.execute` is a SINGLE command** (no shell). Do **not** put
  `"a && b"` in it; bumpp passes the string as literal argv and the second
  command silently never runs. The fix is the wrapper npm script
  `release:build` (which npm runs through a shell). This bug shipped a stale
  xpi as v1.0.0-beta.7 — see commit `692d4bb`.
- **Test layout** is split by *runtime*, not by file type: Vitest covers
  `test/*.spec.js` (imports from `../src/...`), Mocha covers
  `test/integration/*.spec.js` (uses chai + Zotero globals). `vitest.config.js`
  excludes `test/integration/**` explicitly — don't try to run those under
  Vitest.
- **Integration test bootstrap** waits on `() => !!Zotero.ZON` — `Zotero.ZON`
  is the dev handle that `bootstrap.js` sets in `init()` (line 176). Use it
  for ad-hoc console debugging in a running Zotero too.

## Release process

Releases are cut **locally** (`release.github.enable: "local"`), not from CI.

```bash
GITHUB_TOKEN=$(gh auth token) npm run release
```

That runs `bumpp` → `release:build` (sync README + build) → tags + pushes →
creates the GitHub release from the local `.scaffold/build/`.

**Why the README pins a version for the `.xpi` link:** GitHub's permanent
`/releases/latest/download/…` URL 404s for prereleases, and every published
version so far has been a `-beta.N` prerelease. `scripts/sync-readme-version.mjs`
rewrites the pinned `releases/download/v…/…xpi` link in README to match
`package.json#version` after every release. Once the first stable v1.0.0
ships, switch README to `/releases/latest/download/…` and the script becomes
a no-op (see the file's header comment).

## Bootstrap.js conventions (worth knowing before editing)

- `STRINGS` is the single source of UI text — never inline user-visible
  strings; use `this.t("key", { arg })`.
- `safeWrite` writes are **atomic** (temp file → rename). `noteMtime` and
  `externallyChanged` track on-disk edits so we never silently clobber
  out-of-Zotero changes. Don't bypass these.
- Theme detection is manual: `prefers-color-scheme` media query **and** a
  `MutationObserver` on the chrome root (because Zotero's explicit Light/Dark
  setting is an attribute, not the OS scheme). Editors live in iframes that
  don't inherit theme, so the observer is the only thing that re-themes an
  already-open editor.
- `removeWraps(win)` walks shadow roots and tears down CodeMirror instances.
  Called on both `uninit()` and at the top of `init()` so a hot-reinstall
  doesn't leave zombie editors (which corrupt the caret on typing).
- The item-pane section body handed to `onRender` is often **detached** —
  `body.closest("collapsible-section")` finds nothing, so the bootstrap uses
  the "find the CONNECTED collapsible-section" trick borrowed from
  citation-links. If you rework the pane render, preserve that.

## OpenCode configuration for this repo

- The repo ships a `.opencode/opencode.jsonc` and a project-specific
  `.opencode/agents/` (orchestrator, build, plan, code-executor, code-explorer,
  code-reviewer, etc.). The default agent is `orchestrator`, which delegates
  via the `Task` tool rather than reading the repo directly.
- Global OpenCode operating rules (delegation discipline, verification, git
  safety, response style) live in `.opencode/AGENTS.md` — that's the global
  file; **this** file is the project-specific companion it points to.
- For trivial one-file edits, switch the agent to `build` (the orchestrator
  delegates instead of reading).

## Agent skills

### Issue tracker

GitHub Issues at `github.com/klueserthan/obsidian-notepad-for-zotero` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles mapped verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, created lazily as terms and decisions are recorded. See `docs/agents/domain.md`.

## Things to avoid

- Do **not** put `&&` in any `zotero-plugin.config.ts` field that takes a
  single command (`release.bumpp.execute` etc.) — there's no shell. Use an
  npm script wrapper instead.
- Do **not** turn on `fluent.prefixLocaleFiles` / `prefixFluentMessages` —
  the FTL filename and message ids are referenced by exact name in JS.
- Do **not** point `ZOTERO_PLUGIN_PROFILE_PATH` at a real Zotero profile.
- Do **not** run `test/integration/*.spec.js` under Vitest — they import
  chai and use `Zotero.*` globals; vitest config excludes that folder.
- Do **not** use inline user-visible strings in `bootstrap.js` — add them to
  `STRINGS` and call `this.t(...)`.
- Do **not** hardcode values in `addon/manifest.json` or the FTL — use the
  `__token__` placeholders; they're substituted at build.
