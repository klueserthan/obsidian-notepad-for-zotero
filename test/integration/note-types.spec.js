import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Covers the privileged loader,
// pickers, default resolution, and render guard (KTD1, KTD2, KTD5, KTD6)
// against a throwaway Templates folder, restoring the prefs afterwards.

const Z = () => Zotero.ZON;
const withoutFrontmatter = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

describe("note types: loader, pickers, default, render guard", function () {
  let dir, prevDir, prevDefault, win, item;

  const file = (name) => PathUtils.join(dir, name + ".md");
  const write = (name, text) => IOUtils.writeUTF8(file(name), text);
  const builtin = (name) => Z().BUILTIN_TEMPLATES[name];

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
  const SHIPPED = ["note-quantitative", "note-qualitative", "note-theoretical", "note-review", "note-descriptive"];
  let root, dir, prevDir;

  const at = (...parts) => PathUtils.join(dir, ...parts);
  const write = (path, text) => IOUtils.writeUTF8(path, text);
  const read = (path) => IOUtils.readUTF8(path);
  const exists = (path) => IOUtils.exists(path);
  const names = async (folder) => (await IOUtils.getChildren(folder)).map((p) => PathUtils.filename(p)).sort();
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

  // The quantitative -> inferential relabel (R8-R12, KTD2, KTD6, KTD7). The
  // fixture is the template as it shipped BEFORE the rename: same body, old
  // declaration. Everything here runs the real startup chain.
  describe("relabelling the shipped quantitative declaration", function () {
    const NAME = "note-quantitative";
    const prevShipped = () => Z().BUILTIN_TEMPLATES[NAME].replace(
      /^---\n[\s\S]*?\n---\n/,
      "---\npaperType: " + Z().PREV_QUANTITATIVE_DECLARATION.label +
      "\npaperTypeDescription: " + Z().PREV_QUANTITATIVE_DECLARATION.description + "\n---\n");
    const declOf = async (n) => Z().paperTypeDeclarationOf(await read(at(n + ".md")));

    it("relabels an untouched copy and leaves every byte below the frontmatter (AE1)", async function () {
      const before = prevShipped();
      await write(at(NAME + ".md"), before);
      await runStartupChain();
      const after = await read(at(NAME + ".md"));
      assert.equal(Z().paperTypeDeclarationOf(after).label, "inferential");
      assert.match(Z().paperTypeDeclarationOf(after).description, /hypothes/i);
      assert.equal(withoutFrontmatter(after), withoutFrontmatter(before), "body byte-identical");
    });

    it("keeps the researcher's own edits to the body (AE1)", async function () {
      const edited = prevShipped().replace("## Notes", "## Notes\nmy own scratch heading");
      await write(at(NAME + ".md"), edited);
      await runStartupChain();
      const after = await read(at(NAME + ".md"));
      assert.equal(Z().paperTypeDeclarationOf(after).label, "inferential");
      assert.include(after, "my own scratch heading");
      assert.equal(withoutFrontmatter(after), withoutFrontmatter(edited));
    });

    it("leaves a declaration the researcher reworded, and still seeds the descriptive type (AE2, R9)", async function () {
      const mine = prevShipped().replace(/^paperTypeDescription: .*$/m, "paperTypeDescription: My own wording");
      await write(at(NAME + ".md"), mine);
      await runStartupChain();
      assert.equal(await read(at(NAME + ".md")), mine, "untouched");
      assert.equal((await declOf(NAME)).label, "quantitative");
      assert.isTrue(await exists(at("note-descriptive.md")), "seeding is unaffected");
    });

    it("leaves a copy with no declaration of its own, which inherits the new label (R9, KTD7)", async function () {
      const bare = withoutFrontmatter(prevShipped());
      await write(at(NAME + ".md"), bare);
      await runStartupChain();
      assert.equal(await read(at(NAME + ".md")), bare, "never written to");
      assert.include(Z().noteTypeNames(), NAME);
      assert.equal(Z()._templates[NAME].paperType.label, "inferential", "inherited from the built-in");
    });

    it("does not recreate a shipped copy the researcher deleted (AE3, R9)", async function () {
      await Z().saveTemplatesState(dir, { seeded: SHIPPED.slice() });
      await runStartupChain();
      assert.isFalse(await exists(at(NAME + ".md")));
      await runStartupChain();
      assert.isFalse(await exists(at(NAME + ".md")), "still gone on the next start");
    });

    it("writes nothing on a second start (AE4, R11)", async function () {
      await write(at(NAME + ".md"), prevShipped());
      await runStartupChain();
      const after = await read(at(NAME + ".md"));
      const stamp = (await IOUtils.stat(at(NAME + ".md"))).lastModified;
      await runStartupChain();
      assert.equal(await read(at(NAME + ".md")), after, "unchanged");
      assert.equal((await IOUtils.stat(at(NAME + ".md"))).lastModified, stamp, "not rewritten");
    });

    it("seeds a fresh folder with all five types and relabels none (AE5, R12)", async function () {
      await runStartupChain();
      for (const n of SHIPPED) assert.equal(await read(at(n + ".md")), Z().BUILTIN_TEMPLATES[n]);
      assert.sameMembers((await state()).seeded, SHIPPED);
      assert.equal((await declOf(NAME)).label, "inferential");
    });

    it("leaves the default-template preference resolving to the same template (AE8, R10)", async function () {
      await write(at(NAME + ".md"), prevShipped());
      const prev = Zotero.Prefs.get(Z().PREF_DEFAULT_NOTE, true);
      Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, NAME, true);
      try {
        await runStartupChain();
        assert.equal(Z().defaultNoteTemplate(), NAME);
      } finally {
        Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, prev || "", true);
      }
    });

    // Labels clash case-insensitively, so the guard has to as well: relabelling
    // into a clash drops both note types from detection entirely.
    for (const label of ["inferential", "Inferential"]) {
      it(`stands down when another template already declares ${label} (R9, KTD6)`, async function () {
        await write(at(NAME + ".md"), prevShipped());
        await write(at("mine.md"), "---\npaperType: " + label + "\npaperTypeDescription: mine\n---\n## Notes\n");
        await runStartupChain();
        assert.equal((await declOf(NAME)).label, "quantitative", "not relabelled into a clash");
        assert.equal((await declOf("mine")).label, label);
      });
    }

    it("relabels a copy saved with CRLF line endings (KTD2)", async function () {
      await write(at(NAME + ".md"), prevShipped().replace(/\n/g, "\r\n"));
      await runStartupChain();
      assert.equal((await declOf(NAME)).label, "inferential");
    });
  });
});

// Editor bridge actions and Composer propagation (KTD3, KTD6, KTD8, KTD10):
// drives the privileged actions directly against a throwaway Templates folder,
// with the confirmation helper stubbed to record and accept.
describe("note types: editor bridge actions and Composer propagation", function () {
  const XHTML = "http://www.w3.org/1999/xhtml";
  let dir, prevDir, prevDefault, win, realConfirm, confirms, pane;

  const file = (name, ext = ".md") => PathUtils.join(dir, name + ext);
  const write = (name, text, ext) => IOUtils.writeUTF8(file(name, ext), text);
  const read = (name, ext) => IOUtils.readUTF8(file(name, ext));
  const exists = (path) => IOUtils.exists(path);
  const builtin = (name) => Z().BUILTIN_TEMPLATES[name];
  const declared = (label, body = "## Notes\n") => `---\npaperType: ${label}\npaperTypeDescription: ${label} papers\n---\n${body}`;
  const entry = (res, name) => res.templates.find((t) => t.name === name);
  const archived = async () => (await IOUtils.getChildren(PathUtils.join(dir, "archive"))).map((p) => PathUtils.filename(p)).sort();
  const folder = async () => (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p)).filter((f) => !f.startsWith(".")).sort();
  const setDefault = (name) => Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, name, true);
  const getDefault = () => Zotero.Prefs.get(Z().PREF_DEFAULT_NOTE, true);
  const settle = () => new Promise((resolve) => win.setTimeout(resolve, 150)); // let the 30 ms preview timer run

  // A minimal open Composer pane: openRecs() finds any `.zon-content` wrap
  // carrying a rec, so propagation runs through the real picker/preview code.
  async function openPane(selected) {
    const doc = win.document;
    const wrap = doc.createElementNS(XHTML, "div");
    wrap.className = "zon-content";
    const rec = {
      wrap, templateSel: doc.createElementNS(XHTML, "select"), host: doc.createElementNS(XHTML, "div"),
      statusEl: doc.createElementNS(XHTML, "span"), item: null, previewTimer: null, previewSeq: 0, composeMd: "", composeState: null,
    };
    wrap.append(rec.templateSel, rec.host, rec.statusEl);
    wrap._zon = rec;
    doc.documentElement.appendChild(wrap);
    pane = wrap;
    await Z().populateComposerTemplates(rec);
    rec.templateSel.value = selected;
    assert.equal(rec.templateSel.value, selected);
    await settle();
    return rec;
  }

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    prevDir = Zotero.Prefs.get(Z().PREF_TEMPLATES_DIR, true);
    prevDefault = Zotero.Prefs.get(Z().PREF_DEFAULT_NOTE, true);
    realConfirm = Z().confirmNoteTypeAction;
  });

  beforeEach(async function () {
    dir = PathUtils.join(PathUtils.tempDir, "zon-editor-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, dir, true);
    setDefault("");
    confirms = [];
    Z().confirmNoteTypeAction = (w, message) => { confirms.push(message); return true; };
  });

  afterEach(async function () {
    Z().confirmNoteTypeAction = realConfirm;
    if (pane) { pane.remove(); pane = null; }
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });

  after(async function () {
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, prevDir || "", true);
    setDefault(prevDefault || "");
    await Z().loadTemplates();
  });

  it("a new note type with a taken label is refused naming the holder; a free label writes both keys and lists it (AE3)", async function () {
    await write("note-qualitative", builtin("note-qualitative"));
    const body = win.ZONCore.splitDeclaration(builtin("note-qualitative")).body; // Duplicate
    let res = await Z().saveNoteType(win, { isNew: true, name: "mixed", label: "Qualitative ", description: "Both kinds", body });
    assert.isFalse(res.ok);
    assert.include(res.message, "note-qualitative");
    assert.isFalse(await exists(file("mixed")));
    res = await Z().saveNoteType(win, { isNew: true, name: "mixed", label: "mixed-methods", description: "", body });
    assert.isFalse(res.ok, "description is required (R11)");
    res = await Z().saveNoteType(win, { isNew: true, name: "NOTE-QUALITATIVE", label: "mixed-methods", description: "Both kinds", body });
    assert.isFalse(res.ok, "New refuses an existing name in any case (KTD9)");
    assert.equal(await read("note-qualitative"), builtin("note-qualitative"));

    res = await Z().saveNoteType(win, { isNew: true, name: "mixed", label: "mixed-methods", description: "Qualitative and quantitative together", body });
    assert.isTrue(res.ok, res.message);
    assert.equal(res.name, "mixed");
    const decl = Z().paperTypeDeclarationOf(await read("mixed"));
    assert.deepEqual(decl, { label: "mixed-methods", description: "Qualitative and quantitative together" });
    assert.include(Z().orderedTemplateNames(), "mixed");
    assert.include(entry(res, "mixed"), { label: "mixed-methods", needsPaperType: false, inherited: false, shipped: false });
  });

  it("renaming the default note-quantitative moves the file, the default follows, and seeding doesn't recreate it (AE4)", async function () {
    await write("note-quantitative", builtin("note-quantitative"));
    await write("note-review", builtin("note-review"));
    setDefault("note-quantitative");
    const res = await Z().renameNoteType(win, "note-quantitative", "note-quant");
    assert.isTrue(res.ok, res.message);
    assert.equal(res.name, "note-quant");
    assert.isFalse(await exists(file("note-quantitative")));
    assert.equal(await read("note-quant"), builtin("note-quantitative"));
    assert.equal(getDefault(), "note-quant");
    assert.equal(Z().defaultNoteTemplate(), "note-quant");
    await Z().seedTemplatesFolder();
    assert.isFalse(await exists(file("note-quantitative")), "a renamed shipped note type is not re-seeded (KTD3)");
  });

  it("renaming onto an existing name in any letter case is refused and moves nothing; a case-only rename works", async function () {
    await write("note-review", builtin("note-review"));
    await write("mine", declared("mine"));
    for (const target of ["note-review", "Note-Review", "NOTE-REVIEW"]) {
      const res = await Z().renameNoteType(win, "mine", target);
      assert.isFalse(res.ok, target);
      assert.include(res.message, "note-review");
    }
    assert.deepEqual(await folder(), ["mine.md", "note-review.md"]);
    assert.equal(await read("note-review"), builtin("note-review"));
    const res = await Z().renameNoteType(win, "mine", "Mine");
    assert.isTrue(res.ok, res.message);
    assert.deepEqual(await folder(), ["Mine.md", "note-review.md"]);
    assert.include(Z().noteTypeNames(), "Mine");
  });

  it("renaming an upgraded note-quantitative copy without its own declaration keeps it listed under inferential", async function () {
    const text = withoutFrontmatter(builtin("note-quantitative"));
    await write("note-quantitative", text);
    await write("note-review", builtin("note-review"));
    setDefault("note-quantitative");
    await Z().loadTemplates();
    assert.isTrue(entry({ templates: Z().noteTypeList() }, "note-quantitative").inherited);
    const res = await Z().renameNoteType(win, "note-quantitative", "note-quant");
    assert.isTrue(res.ok, res.message);
    assert.include(entry(res, "note-quant"), { label: "inferential", inherited: false, needsPaperType: false });
    assert.include(Z().noteTypeNames(), "note-quant");
    const written = await read("note-quant");
    assert.equal(Z().paperTypeDeclarationOf(written).label, "inferential");
    assert.include(written, text.replace(/^\n+/, ""), "the body is kept");
    assert.equal(getDefault(), "note-quant");
  });

  it("Delete refuses the last declared note type, archives one of two after confirmation, and always allows an undeclared file (AE6)", async function () {
    await write("note-review", builtin("note-review"));
    await write("my-notes", "## Mine\n");
    let res = await Z().deleteNoteType(win, "note-review");
    assert.isFalse(res.ok);
    assert.include(res.message, "note-review");
    assert.lengthOf(confirms, 0, "refused before asking");
    assert.isTrue(await exists(file("note-review")));

    res = await Z().deleteNoteType(win, "my-notes");
    assert.isTrue(res.ok, res.message);
    assert.deepEqual(await archived(), ["my-notes.md"]);

    await write("note-theoretical", builtin("note-theoretical"));
    Z().confirmNoteTypeAction = () => false;
    res = await Z().deleteNoteType(win, "note-theoretical");
    assert.isFalse(res.ok, "cancelled");
    assert.isTrue(await exists(file("note-theoretical")));
    Z().confirmNoteTypeAction = (w, message) => { confirms.push(message); return true; };

    setDefault("note-theoretical");
    res = await Z().deleteNoteType(win, "note-theoretical");
    assert.isTrue(res.ok, res.message);
    assert.lengthOf(confirms, 2);
    assert.deepEqual(await archived(), ["my-notes.md", "note-theoretical.md"]);
    assert.notInclude(Z().orderedTemplateNames(), "note-theoretical");
    assert.isUndefined(entry(res, "note-theoretical"));
    assert.equal(getDefault(), "note-review", "a default pointing at the deleted type falls back (KTD6)");
    await Z().seedTemplatesFolder();
    assert.isFalse(await exists(file("note-theoretical")), "a deleted shipped note type is not re-seeded (R16)");
  });

  it("Reset restores an edited note-qualitative to the built-in text, and is refused while another note type holds its label (AE5)", async function () {
    await write("note-qualitative", "---\npaperType: qualitative\npaperTypeDescription: edited\n---\n## Mine\n");
    await write("interviews", declared("interviews"));
    let res = await Z().resetNoteType(win, "interviews");
    assert.isFalse(res.ok, "only shipped names");
    res = await Z().resetNoteType(win, "note-review");
    assert.isFalse(res.ok, "only shipped names present in the folder");
    res = await Z().resetNoteType(win, "note-qualitative");
    assert.isTrue(res.ok, res.message);
    assert.lengthOf(confirms, 1);
    assert.equal(await read("note-qualitative"), builtin("note-qualitative"));

    await write("note-qualitative", declared("qual-edited"));
    await write("ethnography", declared("Qualitative"));
    res = await Z().resetNoteType(win, "note-qualitative");
    assert.isFalse(res.ok);
    assert.include(res.message, "ethnography");
    assert.lengthOf(confirms, 1, "refused before asking");
    assert.equal(await read("note-qualitative"), declared("qual-edited"));
  });

  it("saving a label and description onto undeclared my-notes.md lists it in the pickers and detection candidates (AE2)", async function () {
    await write("note-review", builtin("note-review"));
    const body = "## My notes\n\n{{ title }}\n";
    await write("my-notes", body);
    await Z().loadTemplates();
    assert.include(entry({ templates: Z().noteTypeList() }, "my-notes"), { needsPaperType: true, label: "" });
    assert.notInclude(Z().orderedTemplateNames(), "my-notes");
    let res = await Z().saveNoteType(win, { name: "my-notes", label: "", description: "One case in depth", body });
    assert.isFalse(res.ok, "label is required (R11)");
    res = await Z().saveNoteType(win, { name: "missing", label: "x", description: "y", body });
    assert.isFalse(res.ok, "updating an unknown note type is refused");

    res = await Z().saveNoteType(win, { name: "my-notes", label: "case-study", description: "One case in depth", body });
    assert.isTrue(res.ok, res.message);
    assert.include(entry(res, "my-notes"), { needsPaperType: false, label: "case-study" });
    assert.include(Z().orderedTemplateNames(), "my-notes");
    const loaded = Z()._templates;
    const candidates = win.ZONCore.paperTypeCandidates(Object.keys(loaded).map((name) => ({ name, text: loaded[name].text })));
    assert.include(candidates.map((c) => c.name), "my-notes");
    assert.include(await read("my-notes"), body);
    assert.deepEqual(await folder(), ["my-notes.md", "note-review.md"]);
  });

  it("saving an existing .njk note type updates that file and creates no .md sibling; rename keeps the extension", async function () {
    await write("lab", declared("experiment"), ".njk");
    let res = await Z().saveNoteType(win, { name: "lab", label: "experiment", description: "Lab studies", body: "## Changed\n" });
    assert.isTrue(res.ok, res.message);
    assert.include(await read("lab", ".njk"), "## Changed");
    assert.isFalse(await exists(file("lab")));
    assert.equal(entry(res, "lab").path, file("lab", ".njk"));
    res = await Z().renameNoteType(win, "lab", "lab-work");
    assert.isTrue(res.ok, res.message);
    assert.deepEqual(await folder(), ["lab-work.njk"]);
  });

  it("an open Composer pane follows a rename, re-renders on a content change, and falls back per KTD6 after a delete (KTD10)", async function () {
    for (const n of ["note-review", "note-quantitative", "note-qualitative"]) await write(n, builtin(n));
    await Z().loadTemplates();
    const rec = await openPane("note-quantitative");

    let res = await Z().renameNoteType(win, "note-quantitative", "note-quant");
    assert.isTrue(res.ok, res.message);
    assert.equal(rec.templateSel.value, "note-quant");
    await settle();
    assert.include(rec.statusEl.textContent, "note-quant");

    let seq = rec.previewSeq;
    await Z().refreshTemplates();
    await settle();
    assert.equal(rec.previewSeq, seq, "nothing changed → no re-render");
    res = await Z().saveNoteType(win, { name: "note-quant", label: "quantitative", description: "Numbers", body: "## Edited\n" });
    assert.isTrue(res.ok, res.message);
    await settle();
    assert.isAbove(rec.previewSeq, seq, "a changed note type re-renders");

    res = await Z().deleteNoteType(win, "note-quant");
    assert.isTrue(res.ok, res.message);
    assert.equal(rec.templateSel.value, Z().defaultNoteTemplate());
    assert.equal(rec.templateSel.value, "note-qualitative");
    await settle();
    assert.include(rec.statusEl.textContent, "note-quant", "the pane says its note type is gone");
  });
});
