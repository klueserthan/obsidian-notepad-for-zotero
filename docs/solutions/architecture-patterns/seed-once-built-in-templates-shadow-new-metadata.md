---
title: Seed-once built-in templates silently shadow new metadata on shipped starters
date: 2026-09-10
category: architecture-patterns
module: templates
problem_type: architecture_pattern
component: service_layer
severity: high
applies_when:
  - "Adding text or frontmatter metadata to a shipped built-in template in ZON.BUILTIN_TEMPLATES"
  - "A feature reads template content or metadata from the loaded template set rather than from the built-in source"
  - "Same-named files in the addon-owned Templates folder override built-ins at load time"
  - "No migration step re-syncs previously seeded template files"
symptoms:
  - "A template-driven feature works on a fresh install but finds nothing on any pre-existing install"
  - "Detect types in the bulk dialog stays disabled with the no-declared-template reason after upgrading"
  - "Hand-made copies were assumed to be the only undeclared templates; seeded copies have the same gap"
root_cause: missing_workflow_step
resolution_type: code_fix
tags: [templates, seeding, upgrade, built-in-templates, paper-type, bulk-dialog, frontmatter]
---

# Seed-once built-in templates silently shadow new metadata on shipped starters

## Context

The addon-owned Templates folder is seeded from `ZON.BUILTIN_TEMPLATES` once per install. `seedTemplatesFolder` writes a starter file only when it is missing (`addon/bootstrap.js:580-593`; the comment at `addon/bootstrap.js:60-62` says seeded files are never overwritten). `loadTemplates` then layers the on-disk folder over the in-memory built-ins, so a same-named on-disk file always wins (`addon/bootstrap.js:702-722`, with `addBuiltins` at `addon/bootstrap.js:728-734`).

The consequence: any later edit to a built-in template, whether body text or new frontmatter, is invisible to every install whose folder was seeded before that edit shipped.

PR #48 hit this. It gave the four whole-note starters (`note-quantitative`, `note-qualitative`, `note-theoretical`, `note-review`) a `paperType` and `paperTypeDescription` declaration (the four literals in `BUILTIN_TEMPLATES`, starting at `addon/bootstrap.js:132`) so the bulk dialog's "Detect types" could choose among them. `paperTypeDeclaration` returns `null` for text with no `paperType` key (`src/templates.js:99-101`), and `paperTypeCandidates` keeps only document-kind templates with a non-null declaration (`src/templates.js:107-115`). Every existing install therefore had four undeclared on-disk copies shadowing the declared built-ins, zero candidates, and a permanently disabled Detect button. The plan had assumed only hand-made copies would lack the declaration; the seeding path was found during code review and independently re-raised by the Codex review on the PR.

Two remedies were rejected: documenting "add the keys to your copy" (every existing user hits the silent failure first), and a one-shot startup migration that rewrites seeded files (it can clobber a user's in-place edits to a starter, which the never-overwrite guarantee exists to protect).

## Guidance

A feature keyed on built-in template content or metadata must not trust the loaded template set alone. Either:

- make the feature's read path fall back to `BUILTIN_TEMPLATES[name]` for a same-named loaded template that lacks the new signal, or
- ship an explicit one-shot migration for the specific seeded files, accepting that it may overwrite hand edits to those files.

The merged fix uses the first option, inside `openBulkDialog` where detection candidates are assembled (`addon/bootstrap.js:2313-2332`):

```js
candidates = C.paperTypeCandidates
  ? C.paperTypeCandidates(templateNames.map((n) => {
      let text = (all[n] && all[n].text) || "";
      if (!C.paperTypeDeclaration(text) && this.BUILTIN_TEMPLATES[n]) text = this.BUILTIN_TEMPLATES[n];
      return { name: n, text };
    }))
  : [];
```

The fallback is read-only: the on-disk file is untouched, and the substitution affects only candidate selection, not rendering. `docs/TEMPLATES.md:314-320` documents the user-facing rule: a same-named undeclared copy of a starter is treated as that starter's paper type; a renamed copy must carry the keys itself.

## Why This Matters

The fallback fires only when both conditions hold: the loaded text has no declaration and the name matches a built-in. A customized template that carries its own declaration is used as-is. A renamed template with no built-in match stays a non-candidate exactly as before. Only the case the upgrade creates, an old name-matching declaration-less copy, is redirected to the current built-in text. Without this, the feature ships green on fresh installs and every upgraded install loses it silently, with no error to point at the cause.

The same shadowing applies to any future built-in change, not only paper-type metadata. A change that is safe on a clean profile is not evidence it works after upgrade.

## When to Apply

- Adding or changing frontmatter keys on a built-in template that code will read.
- Changing a built-in template's body in a way a feature depends on (a marker, a block, a variable).
- Introducing any feature that enumerates or classifies templates from the loaded set.
- Reviewing a plan that says "users who copied a starter must update their copy": the seeded copies are the common case, not the exception.

## Examples

Seed and load behavior the fallback works around:

```js
// addon/bootstrap.js:580-593 — seed only what is missing
if (!(await IOUtils.exists(p))) await this.safeWrite(p, this.BUILTIN_TEMPLATES[name]);

// addon/bootstrap.js:720-721 — on-disk always wins
this.addBuiltins(out);             // shipped starters (lowest priority)
await load(this.templatesDir());   // templates folder (wins — user files override)
```

Test guard: `test/builtin-templates.spec.js` evaluates the `BUILTIN_TEMPLATES` literal straight from the bootstrap source (`extractBuiltins`, `test/builtin-templates.spec.js:17-29`) and asserts that the four paper-type starters (`PAPER_TYPE_TEMPLATES`, `test/builtin-templates.spec.js:11`) carry a non-null declaration, so an edit that drops the frontmatter fails CI. The seeded-folder shadowing itself runs only in the privileged bootstrap realm against real `IOUtils`, so it is reachable only from `test/integration/*.spec.js` (Mocha in headless Zotero), never from the Vitest suite.

## Related

- PR #48: Per-item paper-type detection in the bulk summary-note dialog (includes the fallback fix).
- Issue #41: introduced the addon-owned seeded Templates folder that creates the override pattern.
- `docs/TEMPLATES.md` documents the paper-type keys and the inheritance rule for same-named copies.
- `docs/adr/0003-final-upstream-merge-hard-fork.md` explains why the addon owns the seeded folder.
