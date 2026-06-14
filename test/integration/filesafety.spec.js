import { assert } from "chai";

// The data-safety primitives against the REAL filesystem (Phase 3). These are
// the behaviours that previously could only be hand-verified via computer-use.

const ZON = () => Zotero.ZON;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

describe("file safety", function () {
  let dir, file;

  before(async function () {
    dir = PathUtils.join(Zotero.getTempDirectory().path, "zon-itest-" + Zotero.Utilities.randomString(6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    file = PathUtils.join(dir, "note.md");
  });

  after(async function () {
    try { await IOUtils.remove(dir, { recursive: true }); } catch (e) {}
  });

  it("safeWrite is atomic and leaves no temp file behind", async function () {
    await ZON().safeWrite(file, "hello atomic");
    assert.equal(await IOUtils.readUTF8(file), "hello atomic");
    assert.isFalse(await IOUtils.exists(file + ".zon.tmp"), "temp file should be gone");
  });

  it("noteMtime returns a number for a file, null for a missing one", async function () {
    assert.isNumber(await ZON().noteMtime(file));
    assert.isNull(await ZON().noteMtime(file + ".does-not-exist"));
  });

  it("externallyChanged detects on-disk changes since the baseline", async function () {
    const rec = { path: file, diskMtime: await ZON().noteMtime(file) };
    assert.isFalse(await ZON().externallyChanged(rec), "no change yet");
    await delay(1100); // ensure mtime advances past 1s filesystem resolution
    await IOUtils.writeUTF8(file, "changed outside Zotero");
    assert.isTrue(await ZON().externallyChanged(rec), "should detect the external change");
  });
});
