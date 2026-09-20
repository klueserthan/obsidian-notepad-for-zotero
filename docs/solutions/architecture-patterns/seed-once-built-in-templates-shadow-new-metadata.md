---
title: Seed-once built-in templates silently shadow new metadata on shipped starters
date: 2026-09-10
last_updated: 2026-09-20
category: architecture-patterns
module: templates
problem_type: architecture_pattern
component: service_layer
severity: high
applies_when:
  - "Adding text or frontmatter metadata to a shipped built-in template in ZON.BUILTIN_TEMPLATES"
  - "A feature reads template content or metadata from the loaded template set rather than from the built-in source"
  - "A seeded Templates-folder file shares a shipped note type's name, so the loader inherits the built-in's paper-type declaration but keeps the file's own body"
  - "A plan assumes a shipped note type deleted or renamed before an upgrade behaves like a fresh install"
  - "Shipping a built-in note type whose declared paper-type label is new, or changing a shipped label, so seeding introduces that label into folders that already hold the researcher's own note types"
symptoms:
  - "A template-driven feature works on a fresh install but finds nothing, or stale text, on an upgraded install"
  - "A body-text change to a built-in (a marker, a block, a variable) never reaches users whose folder already holds the old file"
  - "Detect types in the bulk dialog stayed disabled after upgrading, before shipped-name inheritance existed (PR #48)"
root_cause: missing_workflow_step
resolution_type: code_fix
tags: [templates, seeding, upgrade, built-in-templates, paper-type, note-types, state-file, reset-to-built-in, duplicate-labels, detection]
---

# Seed-once built-in templates silently shadow new metadata on shipped starters

## Context

The addon seeds its Templates folder from `ZON.BUILTIN_TEMPLATES` and never overwrites a seeded file (`addon/bootstrap.js:68-72`). So a later edit to a built-in, whether new frontmatter or changed body text, does not reach any install whose folder was seeded before the edit shipped. A fresh install sees the new text. An upgraded install keeps the file written by an earlier build.

PR #48 hit this first. It added `paperType` and `paperTypeDescription` frontmatter to the four whole-note starters (`note-quantitative`, `note-qualitative`, `note-theoretical`, `note-review`) so the bulk dialog's "Detect types" could classify items against them. Existing installs held seeded copies without those keys, so detection found zero declared templates and the button stayed disabled. PR #48 fixed it in one place: inside `openBulkDialog`, a same-named template without a declaration borrowed the built-in's text for candidate selection only.

PR #54 (note types replace building-block templates) replaced that local fix with loader-level rules:

- **The loader reads the Templates folder only.** `loadTemplates` (`addon/bootstrap.js:726-746`) never adds `BUILTIN_TEMPLATES` to the loaded set; the old `addBuiltins` overlay is gone. A shipped note type whose file leaves the folder disappears from every picker, while its built-in text stays readable for seeding, inheritance, and Reset (`test/integration/note-types.spec.js:104`).
- **Shipped-name inheritance applies to every consumer.** `loadTemplates` sets each entry's `paperType` from the file's own declaration, or else from the same-named built-in's (`addon/bootstrap.js:737-738`). The Composer picker, the Settings default, the note-type editor, and the bulk dialog's candidates (`addon/bootstrap.js:2333-2334`) all read that one value. The `openBulkDialog` substitution from PR #48 no longer exists.
- **Seeding and archiving remember what they did, per folder**, so the folder-only loader does not bring back files the user removed (details under Guidance).

## Guidance

A feature that reads built-in template content or metadata has to account for four mechanisms.

**1. The loader inherits the declaration by name, never the body.** A Templates-folder file named after a shipped note type, with no `paperType` of its own, takes that built-in's label and description (`addon/bootstrap.js:737-738`, `docs/TEMPLATES.md:24-26`). Inheritance changes only the in-memory `paperType`; the file on disk is not rewritten. `loadTemplates` still returns the on-disk `text` (`addon/bootstrap.js:740`), so a body change to a built-in (a new section, a fixed prompt, a renamed marker) stays invisible to a seeded copy. `noteTypeList()` marks this case as `inherited: !!t.paperType && !this.paperTypeDeclarationOf(t.text)` (`addon/bootstrap.js:3288`).

**2. Only "Reset to built-in" puts a built-in's body back onto an existing file.** The editor offers it only for a shipped name present in the folder (`addon/bootstrap.js:3416-3431`). It refuses while another note type holds the built-in's label (`labelClash`, `addon/bootstrap.js:3313-3316`), asks for confirmation, then overwrites the file with `safeWrite(all[name].path, this.BUILTIN_TEMPLATES[name])`. Nothing re-syncs body text automatically.

**3. Seeding and archiving record progress in a state file inside each Templates folder.** The file is `.zon-templates-state.json` (`TEMPLATES_STATE_FILE`, `addon/bootstrap.js:66`), read and merged by `templatesState` / `saveTemplatesState` (`addon/bootstrap.js:551-559`).
- `seedTemplatesFolder` (`addon/bootstrap.js:607-623`) writes a shipped file only when the file is missing and its name is not in `seeded`, then records the names it handled. A deleted or renamed shipped note type is not re-created, and a newly chosen folder is seeded once.
- `archiveRetiredTemplates` (`addon/bootstrap.js:561-578`) moves files named in `RETIRED_TEMPLATES` into an `archive` subfolder of the Templates folder and records `archived: true` only after every move succeeded. A failed move retries on the next start; a hand-restored file is not archived again.
- `renameNoteType` and `deleteNoteType` call `rememberSeeded` (`addon/bootstrap.js:3317-3325`), so a shipped note type removed through the editor is not seeded again.

**4. Renaming a note type with an inherited declaration writes the declaration into the file first** (`addon/bootstrap.js:3377-3380`). After the rename the filename no longer matches a built-in, so inheritance would stop applying and the note type would drop out of every picker.

**5. Seeding a built-in with a *new* label can silently disable detection for two note types.** `seedTemplatesFolder` decides what to write by file name alone (`if (seeded.includes(name)) continue;`, `addon/bootstrap.js:741`) and never checks whether the built-in's declared label is already taken. That was harmless while seeding only ever ran against a never-seeded folder; it stops being harmless the moment a release adds a built-in carrying a label a researcher may already have chosen for their own template.

The consequence is silent and it costs the researcher their own work, not just the new built-in. Labels collide **case-insensitively**: `duplicateLabels` keys on `decl.label.trim().toLowerCase()` (`src/templates.js:133`) and `noteTypeList` normalises the same way (`addon/bootstrap.js:3711`). `detectionCandidates` then drops *every* member of a duplicated label (`addon/bootstrap.js:915`), so a clash removes both the researcher's working note type and the shipped one from the bulk dialog's "Detect types" and from Automatic Mode. Nothing announces it; the only surfacing is a `Duplicate label:` badge in the Template Builder list (`addon/content/builder-app.js:173`), which nobody opens unless already suspicious.

Two rules follow for any code that writes a declared label:

- **Compare labels with `trim().toLowerCase()`, never `===`.** The `quantitative` → `inferential` relabel shipped its clash guard with a raw `===` and had to be fixed before merge: a researcher whose own note type declared `Inferential` passed the guard and would have been relabelled into exactly this silent clash. `findLabelClash` (`src/templates.js:146`) and the Builder's own checks already normalise; a new guard that does not is weaker than the rule it thinks it enforces.
- **A step that can create a clash should stand down rather than write.** The relabel does this (`relabelQuantitativeNoteType`, `addon/bootstrap.js`): on a clash it makes no change and records nothing, so the next start retries once the researcher resolves it. `seedTemplatesFolder` has no equivalent and is the remaining exposure — known and unfixed as of the descriptive-note-type work.

**Rejected remedies:**

- *Telling users to update their copies by hand* (recorded in the first version of this learning, with PR #48): every existing user hits the silent failure before reading the instructions.
- *An automatic startup migration that rewrites seeded files, unguarded* (recorded in the first version of this learning, with PR #48; PR #54 added no automatic rewrite): it can overwrite a user's in-place edits to a starter, which the never-overwrite rule protects. Reset to built-in is the per-file, confirmed, user-initiated alternative.
- *A fingerprint-guarded declaration swap* — **accepted** for the `quantitative` → `inferential` rename (`relabelQuantitativeNoteType`, `addon/bootstrap.js`). It is narrower than the unguarded rewrite above in three ways, and each one is what makes it safe: it reads the file's parsed declaration and acts only when both values still equal what shipped, so a declaration the user touched is never overwritten; it rewrites those two frontmatter keys and nothing else, so a body the user rewrote survives intact; and a copy with no declaration of its own is skipped entirely, because inheritance already carries the new label to it. It needs no completion flag: once rewritten the fingerprint stops matching, so a failed write retries and a later start is a no-op. Reach for this shape only when a *shipped label itself* changes — that is the one case inheritance and Reset to built-in cannot reach, because the stale text is the user's own file content.
- *Hiding every file without a declaration from pickers, applied literally* (PR #54's R3): the four copies seeded before PR #48 carry no declaration, so upgraded installs would list zero note types (`docs/plans/2026-09-13-0845-feat-note-types-editor-plan.md:160`). Inheritance keeps R3 for every other file.
- *Listing undeclared files in pickers with a mark, or auto-archiving them* (PR #54): rejected in favor of inheritance, which keeps the affected files usable and fixable in the editor (same plan line).

## Why This Matters

Upgraded installs are the common case: every existing user has a folder seeded by an earlier build. A feature that reads only the loaded template set passes on a fresh profile and does nothing, or reads stale text, on those installs, with no error pointing at the cause.

Inheritance is deliberately narrow. It applies only when a file's name matches a built-in and the file declares no paper type. A customized template with its own declaration is used as-is, a renamed copy without a declaration stays unlisted, and the body is never substituted.

The state file has its own upgrade gap. A folder from before PR #54 has no state file, so a shipped note type the user deleted before upgrading is seeded once more on the first start (`docs/plans/2026-09-13-0845-feat-note-types-editor-plan.md:216`).

## When to Apply

- Adding or changing a frontmatter key on a built-in that a picker, detector, or renderer reads: check what a same-named on-disk file without the key produces.
- Changing a built-in's body in a way a feature depends on (a marker, a block, a variable, a heading): seeded copies keep the old body until the user runs Reset to built-in.
- Adding anything that enumerates, classifies, or defaults from templates: build on the loaded set's `paperType` (via `noteTypeList` and the pickers), not on a new read of `BUILTIN_TEMPLATES` at another call site.
- Reviewing a plan that assumes a shipped note type deleted or renamed before an upgrade stays gone: folders without a state file re-seed it once.
- Reviewing a plan that says "users who copied a starter must update their copy": seeded copies are the default population, not the exception.

## Examples

Folder-only load with declaration inheritance (`addon/bootstrap.js:726-746`, abridged):

```js
for (let p of children) {
  let name = PathUtils.filename(p).replace(/\.(njk|md|txt)$/i, "");
  let text = await IOUtils.readUTF8(p);
  let paperType = this.paperTypeDeclarationOf(text)
    || (Object.hasOwn(this.BUILTIN_TEMPLATES, name) ? this.paperTypeDeclarationOf(this.BUILTIN_TEMPLATES[name]) : null);
  out[name] = { kind: "document", path: p, paperType, text }; // text is always the on-disk body
}
```

Seeding memory (`addon/bootstrap.js:607-623`, abridged):

```js
let seeded = (await this.templatesState(dir)).seeded || [];
for (let name of Object.keys(this.BUILTIN_TEMPLATES)) {
  if (seeded.includes(name)) continue;
  let p = PathUtils.join(dir, name + ".md");
  if (!(await IOUtils.exists(p))) await this.safeWrite(p, this.BUILTIN_TEMPLATES[name]);
  added.push(name); // a failed write stays unrecorded, so the next start retries
}
if (added.length) await this.saveTemplatesState(dir, { seeded: seeded.concat(added) });
```

**Test guards.** The seeded-folder behavior needs real `IOUtils` in the privileged bootstrap realm, so only the headless-Zotero integration suite covers it:

- `test/integration/note-types.spec.js:61`: a shipped-name copy without a declaration inherits the built-in's, without rewriting the file.
- `test/integration/note-types.spec.js:104`: a shipped note type whose file leaves the folder is no longer loaded.
- `test/integration/note-types.spec.js:260`: a fresh folder is seeded and recorded, and a deleted `note-review` is not re-seeded.
- `test/integration/note-types.spec.js:270`: an existing folder without a state file seeds a missing shipped file once.
- `test/integration/note-types.spec.js:406`: renaming an upgraded `note-quantitative` copy without its own declaration keeps it listed.
- `test/integration/note-types.spec.js:455`: Reset restores an edited `note-qualitative` and is refused while another note type holds its label.

`test/builtin-templates.spec.js` (Vitest) checks the `BUILTIN_TEMPLATES` literal itself against the render pipeline; it cannot see a stale on-disk copy. The pure declaration helpers in `src/templates.js` are Vitest-tested in `test/templates.spec.js` against hand-built fixtures.

## Related

- PR #48: per-item paper-type detection in the bulk dialog; introduced the declaration and the first, bulk-dialog-only fallback (superseded by PR #54).
- PR #54: note types replace building-block templates; folder-only loader, shipped-name inheritance, per-folder state file, archive of retired templates, and Reset to built-in.
- Issue #41: introduced the addon-owned seeded Templates folder.
- `docs/plans/2026-09-13-0845-feat-note-types-editor-plan.md`: KTD1-KTD4 and KTD8, the rejected alternatives, and the pre-state-file deletion assumption.
- `docs/TEMPLATES.md`: user-facing description of inheritance, seeding memory, and the archive.
