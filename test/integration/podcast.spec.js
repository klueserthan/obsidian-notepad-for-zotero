import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Covers the Zotero-facing half of
// the Podcast Script (ADR-0007): the saved attachment, its tag and reader type,
// and replace-after-confirm. Prompt building, markdown cleanup and the failure
// codes are covered by test/podcast.spec.js.
//
// The full text, the LLM transport, the confirm dialog and the reader are
// stubbed: headless Zotero has no indexed PDFs, and a real reader tab or
// modal dialog would hang the run.

const Z = () => Zotero.ZON;

describe("podcast script: attachment, tag and replace (ADR-0007)", function () {
  let win;
  let prevBaseURL, prevModel;
  const PATCHED = ["getPrimaryPDFFulltext", "makeLLMFetchFn", "confirmNoteTypeAction"];
  let real = {};
  let realReaderOpen;
  let created = [];
  let opened, fetches, confirms;

  const reply = (content, finishReason = "stop") =>
    JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] });

  async function makeItem(title) {
    let it = new Zotero.Item("journalArticle");
    it.setField("title", title);
    await it.saveTx();
    created.push(it);
    return it;
  }

  const scripts = (item) => Z().existingPodcastScripts(item);

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    prevBaseURL = Zotero.Prefs.get(Z().PREF_LLM_BASE_URL, true);
    prevModel = Zotero.Prefs.get(Z().PREF_LLM_MODEL, true);
    for (let m of PATCHED) real[m] = Z()[m];
    realReaderOpen = Zotero.Reader.open;
  });

  beforeEach(function () {
    created = [];
    opened = [];
    fetches = 0;
    confirms = 0;
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "http://localhost:11434/v1", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, "test-model", true);
    Z().getPrimaryPDFFulltext = async () => ({ ok: true, attachmentTitle: "PDF", text: "The paper's full text." });
    Z().makeLLMFetchFn = () => async () => { fetches++; return reply("Welcome to the episode.\n\nToday: **turnout**."); };
    Z().confirmNoteTypeAction = () => { confirms++; return true; };
    Zotero.Reader.open = async (id) => { opened.push(id); };
  });

  afterEach(async function () {
    for (let m of PATCHED) Z()[m] = real[m];
    Zotero.Reader.open = realReaderOpen;
    for (let it of created) { try { await it.eraseTx(); } catch (e) {} }
  });

  after(function () {
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, prevBaseURL || "", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, prevModel || "", true);
  });

  it("saves a tagged HTML attachment that opens as a snapshot, and opens it in the reader", async function () {
    const item = await makeItem("Podcast fixture");
    const res = await Z().makePodcastScript(win, item);
    assert.deepEqual(res, { ok: true });
    const [att] = scripts(item);
    assert.ok(att, "a tagged attachment exists");
    assert.equal(att.attachmentContentType, "text/html");
    assert.equal(att.attachmentReaderType, "snapshot");
    assert.equal(att.getField("title"), "Podcast: Podcast fixture");
    const html = await IOUtils.readUTF8(await att.getFilePathAsync());
    assert.include(html, '<html lang="en">');
    assert.include(html, "<p>Welcome to the episode.</p>\n<p>Today: turnout.</p>");
    assert.deepEqual(opened, [att.id]);
    assert.equal(confirms, 0, "no question when there is nothing to replace");
  });

  it("after a yes, replaces the existing script and moves the old one to the trash", async function () {
    const item = await makeItem("Replace fixture");
    await Z().makePodcastScript(win, item);
    const [old] = scripts(item);
    await Z().makePodcastScript(win, item);
    assert.equal(confirms, 1);
    assert.isTrue(Zotero.Items.get(old.id).deleted, "old script is in the trash");
    const now = scripts(item);
    assert.lengthOf(now, 1);
    assert.notEqual(now[0].id, old.id);
  });

  it("after a no, sends no request and leaves the existing script alone", async function () {
    const item = await makeItem("Cancel fixture");
    await Z().makePodcastScript(win, item);
    const [old] = scripts(item);
    Z().confirmNoteTypeAction = () => false;
    const res = await Z().makePodcastScript(win, item);
    assert.deepEqual(res, { ok: false, cancelled: true });
    assert.equal(fetches, 1, "only the first run called the LLM");
    assert.deepEqual(scripts(item).map((a) => a.id), [old.id]);
  });

  it("a reply cut off at the token limit saves nothing and names the limit", async function () {
    const item = await makeItem("Truncated fixture");
    Z().makeLLMFetchFn = () => async () => reply("Welcome to the", "length");
    const res = await Z().makePodcastScript(win, item);
    assert.isFalse(res.ok);
    assert.include(res.error, "Podcast Max Tokens (4096)");
    assert.lengthOf(scripts(item), 0);
    assert.lengthOf(opened, 0);
  });
});
