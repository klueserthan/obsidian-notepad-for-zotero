import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Covers the privileged loader,
// pickers, default resolution, and render guard (KTD1, KTD2, KTD5, KTD6)
// against a throwaway Templates folder, restoring the prefs afterwards.

describe("note types: loader, pickers, default, render guard", function () {
  const Z = () => Zotero.ZON;
  let dir, prevDir, prevDefault, win, item;

  const file = (name) => PathUtils.join(dir, name + ".md");
  const write = (name, text) => IOUtils.writeUTF8(file(name), text);
  const builtin = (name) => Z().BUILTIN_TEMPLATES[name];
  const withoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");

  async function rejection(promise) {
    try { await promise; } catch (e) { return e; }
    assert.fail("expected a rejection");
  }

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    prevDir = Zotero.Prefs.get(Z().PREF_TEMPLATES_DIR, true);
    prevDefault = Zotero.Prefs.get(Z().PREF_DEFAULT_NOTE, true);
    item = new Zotero.Item("journalArticle");
    item.setField("title", "Note types integration fixture");
    await item.saveTx();
  });

  beforeEach(async function () {
    dir = PathUtils.join(PathUtils.tempDir, "zon-note-types-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, dir, true);
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "", true);
  });

  afterEach(async function () {
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });

  after(async function () {
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, prevDir || "", true);
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, prevDefault || "", true);
    if (item) await item.eraseTx();
    await Z().loadTemplates();
  });

  it("with zero declared note types, pickers and default are empty and Generate refuses", async function () {
    await Z().loadTemplates();
    assert.deepEqual(Object.keys(Z()._templates), [], "built-ins are not merged into the loaded set (KTD1)");
    assert.deepEqual(Z().orderedTemplateNames(), []);
    assert.deepEqual(Z().prefsTemplateNames(), []);
    assert.equal(Z().defaultNoteTemplate(), "");
    const err = await rejection(Z().generateSummaryNote(win, item));
    assert.equal(err.name, "UnknownNoteTypeError");
    assert.lengthOf(item.getNotes(), 0, "no note is created");
  });

  it("a shipped-name copy without a declaration inherits the built-in's, without rewriting the file (AE1, KTD2)", async function () {
    const text = withoutFrontmatter(builtin("note-qualitative"));
    await write("note-qualitative", text);
    await Z().loadTemplates();
    assert.include(Z().orderedTemplateNames(), "note-qualitative");
    assert.equal(Z()._templates["note-qualitative"].paperType.label, "qualitative");
    assert.equal(await IOUtils.readUTF8(file("note-qualitative")), text, "file untouched");
  });

  it("an undeclared file is loaded and flagged but never listed in a picker (R3)", async function () {
    await write("note-review", builtin("note-review"));
    await write("my-notes", withoutFrontmatter(builtin("note-review")));
    await write("archive", builtin("note-theoretical")); // reserved name, never a template
    await Z().loadTemplates();
    const t = Z()._templates["my-notes"];
    assert.ok(t, "my-notes is in the full loaded list");
    assert.isNull(t.paperType, "flagged as needing a paper type");
    assert.equal(t.path, file("my-notes"));
    assert.notInclude(Z().orderedTemplateNames(), "my-notes");
    assert.notInclude(Z().prefsTemplateNames(), "my-notes");
    assert.notProperty(Z()._templates, "archive");
    assert.deepEqual(Z().prefsTemplateNames(), ["note-review"]);
  });

  it("a missing stored default falls back to the first declared note type alphabetically (AE4, KTD6)", async function () {
    await write("note-review", builtin("note-review"));
    await write("note-quantitative", builtin("note-quantitative"));
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "note", true);
    await Z().loadTemplates();
    assert.equal(Z().defaultNoteTemplate(), "note-quantitative");
    assert.equal(Z().orderedTemplateNames()[0], "note-quantitative");
    assert.equal(Zotero.Prefs.get(Z().PREF_DEFAULT_NOTE, true), "note", "resolution never rewrites the pref");
  });

  it("a declared stored default is returned unchanged", async function () {
    await write("note-review", builtin("note-review"));
    await write("note-quantitative", builtin("note-quantitative"));
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "note-review", true);
    await Z().loadTemplates();
    assert.equal(Z().defaultNoteTemplate(), "note-review");
    assert.deepEqual(Z().orderedTemplateNames(), ["note-review", "note-quantitative"]);
  });

  it("a shipped note type whose file leaves the folder is no longer loaded, but its built-in text stays readable (AE6)", async function () {
    for (const name of Object.keys(Z().BUILTIN_TEMPLATES)) await write(name, builtin(name));
    await Z().loadTemplates();
    assert.include(Z().orderedTemplateNames(), "note-review");
    await IOUtils.remove(file("note-review"));
    await Z().loadTemplates();
    assert.notProperty(Z()._templates, "note-review");
    assert.notInclude(Z().orderedTemplateNames(), "note-review");
    assert.include(builtin("note-review"), "paperType: review");
  });

  it("rendering a name that is not loaded throws the named error and creates no note (KTD5)", async function () {
    await write("note-review", builtin("note-review"));
    await Z().loadTemplates();
    const renderErr = await rejection(Z().renderTemplateAsNote(win, item, "no-such-type", { preview: true }));
    assert.equal(renderErr.name, "UnknownNoteTypeError");
    const genErr = await rejection(Z().generateSummaryNote(win, item, "no-such-type"));
    assert.equal(genErr.name, "UnknownNoteTypeError");
    assert.lengthOf(item.getNotes(), 0, "no note is created");
  });
});

// Startup archive and seeding memory (KTD3, KTD4): runs the real startup chain
// (archive → seed → load) against throwaway folders under one temp root.
describe("note types: startup archive and seeding memory", function () {
  const Z = () => Zotero.ZON;
  const SHIPPED = ["note-quantitative", "note-qualitative", "note-theoretical", "note-review"];
  let root, dir, prevDir;

  const at = (...parts) => PathUtils.join(dir, ...parts);
  const write = (path, text) => IOUtils.writeUTF8(path, text);
  const read = (path) => IOUtils.readUTF8(path);
  const exists = (path) => IOUtils.exists(path);
  const names = async (folder) => (await IOUtils.getChildren(folder)).map((p) => PathUtils.filename(p)).sort();
  const withoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const runStartupChain = () => Z().prepareTemplatesFolder();

  async function state() {
    try { return JSON.parse(await read(at(Z().TEMPLATES_STATE_FILE))); } catch (e) { return {}; }
  }

  async function useFolder(name) {
    dir = PathUtils.join(root, name);
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, dir, true);
  }

  before(function () {
    prevDir = Zotero.Prefs.get(Z().PREF_TEMPLATES_DIR, true);
  });

  beforeEach(async function () {
    root = PathUtils.join(PathUtils.tempDir, "zon-startup-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
    await useFolder("a");
  });

  afterEach(async function () {
    await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
  });

  after(async function () {
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, prevDir || "", true);
    await Z().loadTemplates();
  });

  it("archives retired files and lists exactly the four shipped note types with inherited labels (AE1)", async function () {
    await write(at("research-questions.md"), "## Research Questions\n{% llm %}What does the paper ask?{% endllm %}\n");
    await write(at("note.md"), "---\ntitle: \"{{title}}\"\n---\n## Notes\n");
    for (const n of SHIPPED) await write(at(n + ".md"), withoutFrontmatter(Z().BUILTIN_TEMPLATES[n]));
    await runStartupChain();
    assert.deepEqual(await names(at("archive")), ["note.md", "research-questions.md"]);
    assert.isFalse(await exists(at("note.md")));
    assert.isFalse(await exists(at("research-questions.md")));
    assert.deepEqual(Z().noteTypeNames(), [...SHIPPED].sort());
    for (const n of SHIPPED) {
      assert.equal(Z()._templates[n].paperType.label, Z().paperTypeDeclarationOf(Z().BUILTIN_TEMPLATES[n]).label);
      assert.equal(await read(at(n + ".md")), withoutFrontmatter(Z().BUILTIN_TEMPLATES[n]), "existing copy never overwritten");
    }
    const recorded = await state();
    assert.isTrue(recorded.archived);
    assert.sameMembers(recorded.seeded, SHIPPED);
  });

  it("running the chain again changes nothing, and a note.md moved back by hand is not archived again (R7)", async function () {
    await write(at("note.md"), "mine");
    await runStartupChain();
    const folder = await names(dir), archived = await names(at("archive")), recorded = await state();
    await runStartupChain();
    assert.deepEqual(await names(dir), folder);
    assert.deepEqual(await names(at("archive")), archived);
    assert.deepEqual(await state(), recorded);
    await IOUtils.move(at("archive", "note.md"), at("note.md"));
    await runStartupChain();
    assert.equal(await read(at("note.md")), "mine");
    assert.deepEqual(await names(at("archive")), []);
    assert.isNull(Z()._templates.note.paperType, "restored file is undeclared (R3)");
    assert.notInclude(Z().noteTypeNames(), "note");
  });

  it("a name already taken in archive/ gets a timestamp suffix, then a further distinct name, and nothing is overwritten", async function () {
    await IOUtils.makeDirectory(at("archive"));
    await write(at("archive", "note.md"), "first");
    for (const text of ["second", "third"]) {
      await write(at("note.md"), text);
      await IOUtils.remove(at(Z().TEMPLATES_STATE_FILE), { ignoreAbsent: true }); // let the once-per-folder step run again
      await Z().archiveRetiredTemplates();
      assert.isFalse(await exists(at("note.md")));
    }
    const files = await names(at("archive"));
    assert.lengthOf(files, 3);
    assert.equal(await read(at("archive", "note.md")), "first");
    for (const f of files.filter((f) => f !== "note.md")) assert.match(f, /^note-\d{14}(-\d+)?\.md$/);
    assert.sameMembers(await Promise.all(files.map((f) => read(at("archive", f)))), ["first", "second", "third"]);
  });

  it("a failed move leaves the file in place and does not record the folder as archived; the next start retries", async function () {
    await write(at("note.md"), "keep me");
    // A plain file where the archive folder belongs makes the real IOUtils call
    // for this file throw inside the archive step.
    await write(at("archive"), "not a folder");
    await runStartupChain();
    assert.equal(await read(at("note.md")), "keep me");
    assert.notOk((await state()).archived);
    await IOUtils.remove(at("archive"));
    await runStartupChain();
    assert.isFalse(await exists(at("note.md")));
    assert.equal(await read(at("archive", "note.md")), "keep me");
    assert.isTrue((await state()).archived);
  });

  it("a newly chosen folder with retired files is archived once, and a newly chosen empty folder is seeded", async function () {
    await runStartupChain();
    await useFolder("b");
    await write(at("note-minimal.md"), "retired");
    await runStartupChain();
    assert.isTrue(await exists(at("archive", "note-minimal.md")));
    await IOUtils.move(at("archive", "note-minimal.md"), at("note-minimal.md"));
    await runStartupChain();
    assert.isTrue(await exists(at("note-minimal.md")), "archived once only");
    await useFolder("c");
    await runStartupChain();
    for (const n of SHIPPED) assert.equal(await read(at(n + ".md")), Z().BUILTIN_TEMPLATES[n]);
    assert.sameMembers((await state()).seeded, SHIPPED);
    assert.deepEqual(Z().noteTypeNames(), [...SHIPPED].sort());
  });

  it("switching back to an already-archived folder leaves a hand-restored note.md in place", async function () {
    await write(at("note.md"), "mine");
    await runStartupChain();
    await IOUtils.move(at("archive", "note.md"), at("note.md"));
    await useFolder("b");
    await runStartupChain();
    await useFolder("a");
    await runStartupChain();
    assert.equal(await read(at("note.md")), "mine");
    assert.isFalse(await exists(at("archive", "note.md")));
  });

  it("a fresh folder is seeded and recorded, and a deleted note-review is not re-seeded (R16)", async function () {
    await runStartupChain();
    for (const n of SHIPPED) assert.isTrue(await exists(at(n + ".md")));
    assert.sameMembers((await state()).seeded, SHIPPED);
    await IOUtils.remove(at("note-review.md"));
    await runStartupChain();
    assert.isFalse(await exists(at("note-review.md")));
    assert.notInclude(Z().noteTypeNames(), "note-review");
  });

  it("an existing folder without a state file seeds a missing shipped file once and records all four", async function () {
    const kept = SHIPPED.filter((n) => n !== "note-review");
    for (const n of kept) await write(at(n + ".md"), "edited " + n);
    await runStartupChain();
    for (const n of kept) assert.equal(await read(at(n + ".md")), "edited " + n, "never overwritten");
    assert.equal(await read(at("note-review.md")), Z().BUILTIN_TEMPLATES["note-review"]);
    assert.sameMembers((await state()).seeded, SHIPPED);
    await IOUtils.remove(at("note-review.md"));
    await runStartupChain();
    assert.isFalse(await exists(at("note-review.md")), "seeded once");
  });
});
