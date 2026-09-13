import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Covers U3 (headless pipeline
// hooks): the detection candidate helper extracted from openBulkDialog, the
// machine-readable failure codes resolveSummaryMdForItem now returns, and the
// single-item detection helper the automatic sweep will call with no dialog
// (R2, R10, R11, R13; KTD6, KTD7, KTD8). Later units (the sweep, the timer,
// new prefs) add sibling `describe` blocks alongside this one rather than
// editing it.
//
// LOGGING CONTRACT (KTD11): nothing here asserts on or reproduces a detection
// row's `detail` field or a provider error body — only reason/code/status.

const Z = () => Zotero.ZON;

describe("auto summary: headless pipeline hooks (U3)", function () {
  let win, item, dir, prevDir, prevBaseURL, prevModel, realMakeLLMFetchFn;

  // context="abstract" (a context attribute is required by validateLLMBlocks):
  // the fixture item's abstract satisfies it, so resolveSummaryMdForItem never
  // needs full text or annotations and the item stays a plain journalArticle
  // with no PDF attachment.
  const LLM_TEMPLATE = "# {{ title }}\n{% llm context=\"abstract\" %}Say hi{% endllm %}\n";
  // Missing {% endllm %}: validateLLMBlocks reports `llm.unclosed`, so
  // renderTemplateAsNote throws a plain Error (never UnknownNoteTypeError) —
  // the "render throws" scenario, distinct from an unknown note type.
  const BROKEN_TEMPLATE = "# {{ title }}\n{% llm %}unterminated block\n";

  const file = (name) => PathUtils.join(dir, name + ".md");
  const write = (name, text) => IOUtils.writeUTF8(file(name), text);

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    prevDir = Zotero.Prefs.get(Z().PREF_TEMPLATES_DIR, true);
    prevBaseURL = Zotero.Prefs.get(Z().PREF_LLM_BASE_URL, true);
    prevModel = Zotero.Prefs.get(Z().PREF_LLM_MODEL, true);
    realMakeLLMFetchFn = Z().makeLLMFetchFn;
    item = new Zotero.Item("journalArticle");
    item.setField("title", "Auto summary fixture");
    item.setField("abstractNote", "An abstract about something worth summarizing.");
    await item.saveTx();
  });

  beforeEach(async function () {
    dir = PathUtils.join(PathUtils.tempDir, "zon-auto-summary-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, dir, true);
    // A configured-but-fake endpoint by default; individual tests override
    // makeLLMFetchFn (or the base URL, for the not-configured scenario).
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "http://localhost:11434/v1", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, "test-model", true);
  });

  afterEach(async function () {
    Z().makeLLMFetchFn = realMakeLLMFetchFn;
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });

  after(async function () {
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, prevDir || "", true);
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, prevBaseURL || "", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, prevModel || "", true);
    if (item) await item.eraseTx();
    await Z().loadTemplates();
  });

  it("detectionCandidates() returns the four shipped note types with their labels on a fresh profile", async function () {
    for (const n of Object.keys(Z().BUILTIN_TEMPLATES)) await write(n, Z().BUILTIN_TEMPLATES[n]);
    await Z().loadTemplates();
    const candidates = Z().detectionCandidates();
    assert.lengthOf(candidates, 4);
    const byName = new Map(candidates.map((c) => [c.name, c.label]));
    assert.equal(byName.get("note-quantitative"), "quantitative");
    assert.equal(byName.get("note-qualitative"), "qualitative");
    assert.equal(byName.get("note-theoretical"), "theoretical");
    assert.equal(byName.get("note-review"), "review");
  });

  it("a resolve call whose fake fetch throws status 401 returns ok:false, code llm.run.httpFailed, status 401", async function () {
    await write("note-llm", LLM_TEMPLATE);
    await Z().loadTemplates();
    Z().makeLLMFetchFn = () => async () => {
      let e = new Error("unauthorized");
      e.status = 401;
      throw e;
    };
    const r = await Z().resolveSummaryMdForItem(win, item, "note-llm");
    assert.isFalse(r.ok);
    assert.equal(r.code, "llm.run.httpFailed", r.failure);
    assert.equal(r.status, 401);
    assert.isString(r.failure);
  });

  it("a resolve call whose fake fetch returns an empty completion returns code llm.run.emptyResponse", async function () {
    await write("note-llm", LLM_TEMPLATE);
    await Z().loadTemplates();
    Z().makeLLMFetchFn = () => async () => JSON.stringify({ choices: [{ message: { content: "" } }] });
    const r = await Z().resolveSummaryMdForItem(win, item, "note-llm");
    assert.isFalse(r.ok);
    assert.equal(r.code, "llm.run.emptyResponse", r.failure);
    assert.isNull(r.status);
  });

  it("a resolve call with an empty base URL returns the not-configured code instead of only a message", async function () {
    await write("note-llm", LLM_TEMPLATE);
    await Z().loadTemplates();
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "", true);
    const r = await Z().resolveSummaryMdForItem(win, item, "note-llm");
    assert.isFalse(r.ok);
    assert.equal(r.code, "resolve.notConfigured", r.failure);
    assert.isNull(r.status);
    assert.isString(r.failure);
    assert.isAbove(r.failure.length, 0);
  });

  it("a resolve call for a note type whose render throws returns a render failure code instead of throwing", async function () {
    await write("note-broken", BROKEN_TEMPLATE);
    await Z().loadTemplates();
    const r = await Z().resolveSummaryMdForItem(win, item, "note-broken");
    assert.isFalse(r.ok);
    assert.equal(r.code, "resolve.renderFailed");
    assert.isNull(r.status);
  });

  it("the single-item detection helper returns no-abstract for an item with an empty abstract without calling the fake fetch", async function () {
    for (const n of Object.keys(Z().BUILTIN_TEMPLATES)) await write(n, Z().BUILTIN_TEMPLATES[n]);
    await Z().loadTemplates();
    let called = false;
    Z().makeLLMFetchFn = () => async () => {
      called = true;
      return JSON.stringify({ choices: [{ message: { content: "1" } }] });
    };
    let blankItem = new Zotero.Item("journalArticle");
    blankItem.setField("title", "No abstract here");
    await blankItem.saveTx();
    try {
      const res = await Z().detectPaperTypeForItem(win, blankItem);
      assert.isFalse(called, "the fetch never runs for an empty abstract");
      assert.equal(res.reason, "no-abstract");
    } finally {
      await blankItem.eraseTx();
    }
  });
});
