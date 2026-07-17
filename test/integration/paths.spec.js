import { assert } from "chai";

// Exercises the ZONCore bundle (src/* compiled into content/core.bundle.js) in
// the real Zotero realm — catches bundling / cross-realm wiring problems that
// the Node unit tests can't (they import src/ directly).

describe("ZONCore helpers (in Zotero runtime)", function () {
  let C;

  before(async function () {
    const win = Zotero.getMainWindow();
    await Zotero.ZON.injectCore(win);
    C = win.ZONCore;
  });

  it("exposes the render + helper surface", function () {
    ["sanitizeFilename", "syncBlocks", "makeBlock", "parseBlocks", "render",
     "stripMarkers", "stripFrontmatter", "mdToHtml",
     "applyManifest", "setManifestEntry", "buildManifestFromScaffold"]
      .forEach((k) => assert.isFunction(C[k], k + " should be a function"));
  });

  it("sanitizes filenames (no path separators survive)", function () {
    assert.notMatch(C.sanitizeFilename("../../etc/passwd"), /[\\/]/);
    assert.equal(C.sanitizeFilename(""), "untitled");
  });

  it("runs the render-side block engine idempotently through the bundle", function () {
    const md = "---\ncitekey: x\n---\n\n"
      + "%% zon kind=annotations colour=all sync=on format=list %%\n%% /zon %%\n";
    const a = C.syncBlocks(md, [], { citekey: "x" });
    const b = C.syncBlocks(a, [], { citekey: "x" });
    assert.equal(a, b, "syncBlocks should be idempotent");
  });

  it("applies a frontmatter manifest idempotently through the bundle", function () {
    let md = "---\nTitle: \"old\"\n---\nbody\n";
    md = C.setManifestEntry(md, "Title", "\"{{title}}\"");
    const a = C.applyManifest(md, { title: "Fresh Title" });
    const b = C.applyManifest(a, { title: "Fresh Title" });
    assert.include(a, 'Title: "Fresh Title"', "manifest should refresh the key");
    assert.equal(a, b, "applyManifest should be idempotent");
  });

  it("finds marker ranges through the bundle", function () {
    const md = "%% zon kind=annotations sync=on format=list %%\n"
      + "- a %% ann:ABCD %%\n%% /zon %%\n";
    const ranges = C.findMarkerRanges(md);
    const types = ranges.map((r) => r.type);
    assert.include(types, "block-open");
    assert.include(types, "ann-anchor");
    assert.include(types, "block-close");
    const ann = ranges.find((r) => r.type === "ann-anchor");
    assert.equal(md.slice(ann.from, ann.to).trim(), "%% ann:ABCD %%");
  });
});
