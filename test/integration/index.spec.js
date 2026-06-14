import { assert } from "chai";

// buildIndex + resolvePath against a real Zotero item and a note file on disk —
// the link-resolution that the pane relies on, previously only hand-verified.

const PREF_NOTES = "extensions.zotero-obsidian-notes.notesDir";

describe("note indexing + resolvePath", function () {
  let dir, item, notePath, prevNotes;

  before(async function () {
    prevNotes = Zotero.Prefs.get(PREF_NOTES, true);
    dir = PathUtils.join(Zotero.getTempDirectory().path, "zon-itest-notes-" + Zotero.Utilities.randomString(6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });

    item = new Zotero.Item("journalArticle");
    item.setField("title", "Integration Test Item");
    await item.saveTx();

    notePath = PathUtils.join(dir, "@itest.md");
    await IOUtils.writeUTF8(
      notePath,
      '---\nZoteroLink: "zotero://select/library/items/' + item.key + '"\n---\n\nbody\n',
    );

    Zotero.Prefs.set(PREF_NOTES, dir, true);
    await Zotero.ZON.buildIndex();
  });

  after(async function () {
    try { Zotero.Prefs.set(PREF_NOTES, prevNotes == null ? "" : prevNotes, true); } catch (e) {}
    try { await item.eraseTx(); } catch (e) {}
    try { await IOUtils.remove(dir, { recursive: true }); } catch (e) {}
    try { await Zotero.ZON.buildIndex(); } catch (e) {}
  });

  it("resolves a note by its ZoteroLink item key", async function () {
    const p = await Zotero.ZON.resolvePath(item);
    assert.equal(p, notePath);
  });
});
