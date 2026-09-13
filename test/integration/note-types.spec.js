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
