import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Covers U2: itemAbstractState,
// the shared per-item write helper (extractAbstractForItem, KTD3), and the
// "Extract abstracts" item-menu flow (extractAbstractForItem's caller,
// extractAbstractsForItems, KTD6). The pure decision logic (containment,
// reason codes) is already covered by test/abstract-extract.spec.js (U1) —
// this spec only exercises the Zotero-facing read/write/menu plumbing.
//
// Testing the actual XUL popup is impractical headless, so the menu-hidden
// scenario calls updateItemMenu directly with plain-object stand-ins for the
// XUL menuitems, and the "runs the flow" scenarios call extractAbstractsForItems
// itself (with selectedRegularItems and the progress popup stubbed) rather than
// simulating a real click.
//
// LOGGING CONTRACT (KTD7): nothing here asserts on a logged message body.

const Z = () => Zotero.ZON;

describe("abstract extraction: helper, guard, and menu flow (U2)", function () {
  let win, C, item;
  let prevBaseURL, prevModel;
  const PATCHED = ["getPrimaryPDFFulltext", "makeLLMFetchFn", "autoSummaryLive", "selectedRegularItems", "progress", "finishProgress"];
  let real = {};
  let created = [];

  const answer = (content) => JSON.stringify({ choices: [{ message: { content } }] });
  // Short enough that the module never truncates the slice, so the
  // truncation guard (KTD2.5) never interferes with these scenarios.
  const GOOD_ABSTRACT = "This study examines how verbatim abstract extraction can be verified " +
    "against a paper's own indexed text without ever fabricating new content for the scholarly record itself.";
  const fulltext = (abstractText) =>
    "Journal of Testing\n\nAbstract: " + abstractText +
    "\n\n1. Introduction\nFiller text follows the abstract so the source resembles a real article " +
    "opening section, with content that is not itself part of the abstract.";
  const readyText = (abstractText) => async () => ({ ok: true, attachmentTitle: "PDF", text: fulltext(abstractText) });
  const fakeEl = () => ({ hidden: false, setAttribute() {} });

  async function makeItem(title, { abstract = "" } = {}) {
    let it = new Zotero.Item("journalArticle");
    it.setField("title", title);
    if (abstract) it.setField("abstractNote", abstract);
    await it.saveTx();
    created.push(it);
    return it;
  }

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    C = win.ZONCore;
    prevBaseURL = Zotero.Prefs.get(Z().PREF_LLM_BASE_URL, true);
    prevModel = Zotero.Prefs.get(Z().PREF_LLM_MODEL, true);
    for (let m of PATCHED) real[m] = Z()[m];
  });

  beforeEach(async function () {
    created = [];
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "http://localhost:11434/v1", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, "test-model", true);
    // No real UI during tests: a bare object stands in for the progress
    // window, and finishProgress is overridden per-test to capture its text.
    Z().progress = () => ({});
    Z().finishProgress = () => {};
  });

  afterEach(async function () {
    for (let m of PATCHED) Z()[m] = real[m];
    for (let it of created) { try { await it.eraseTx(); } catch (e) {} }
  });

  after(function () {
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, prevBaseURL || "", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, prevModel || "", true);
  });

  describe("itemAbstractState", function () {
    it("reads 'has' for a non-empty abstract, 'missing' for an empty one", async function () {
      const has = await makeItem("Has fixture", { abstract: "Already there." });
      const missing = await makeItem("Missing fixture");
      assert.equal(Z().itemAbstractState(has), "has");
      assert.equal(Z().itemAbstractState(missing), "missing");
    });
  });

  describe("extractAbstractForItem (the shared write helper)", function () {
    it("an item whose PDF text contains the abstract gets it written plus the marker tag", async function () {
      const it = await makeItem("Good fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => answer(GOOD_ABSTRACT);
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "extracted");
      assert.equal(it.getField("abstractNote"), GOOD_ABSTRACT);
      assert.include(it.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
    });

    it("covers AE2: a paraphrasing reply writes nothing and adds no tag", async function () {
      const it = await makeItem("Paraphrase fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => answer(
        "A completely different paraphrased sentence that never actually appears anywhere in the source text at all.");
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "not-found");
      assert.equal(it.getField("abstractNote"), "");
      assert.notInclude(it.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
    });

    it("a rejected request reports http-failed with its status and writes nothing", async function () {
      const it = await makeItem("Throttled fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => { throw Object.assign(new Error("too many requests"), { status: 429 }); };
      const res = await Z().extractAbstractForItem(win, it);
      assert.deepEqual(res, { outcome: "http-failed", status: 429 });
      assert.equal(it.getField("abstractNote"), "");
      assert.notInclude(it.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
    });

    it("a save that fails leaves no unsaved abstract or marker tag on the item", async function () {
      const it = await makeItem("Save rollback fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => answer(GOOD_ABSTRACT);
      const realSave = it.saveTx;
      it.saveTx = async () => { throw new Error("save failed"); };
      let threw = false;
      try { await Z().extractAbstractForItem(win, it); } catch (e) { threw = true; }
      it.saveTx = realSave;
      assert.isTrue(threw);
      assert.equal(it.getField("abstractNote"), "");
      assert.notInclude(it.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
    });

    it("a caller stop signal before the request sends nothing, and one raised during the request writes nothing", async function () {
      const it = await makeItem("Cancelled fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      let calls = 0;
      Z().makeLLMFetchFn = () => async () => { calls++; return answer(GOOD_ABSTRACT); };
      let res = await Z().extractAbstractForItem(win, it, { shouldStop: () => true });
      assert.equal(res.outcome, "skipped");
      assert.equal(calls, 0);
      let stopped = false;
      Z().makeLLMFetchFn = () => async () => { calls++; stopped = true; return answer(GOOD_ABSTRACT); };
      res = await Z().extractAbstractForItem(win, it, { shouldStop: () => stopped });
      assert.equal(res.outcome, "skipped");
      assert.equal(calls, 1);
      assert.equal(it.getField("abstractNote"), "");
    });

    it("an abstract set while the full text was being read sends no request", async function () {
      const it = await makeItem("Queued race fixture");
      Z().getPrimaryPDFFulltext = async (item, C2) => {
        it.setField("abstractNote", "Set by someone else before the request.");
        await it.saveTx();
        return readyText(GOOD_ABSTRACT)(item, C2);
      };
      let calls = 0;
      Z().makeLLMFetchFn = () => async () => { calls++; return answer(GOOD_ABSTRACT); };
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "skipped");
      assert.equal(calls, 0);
    });

    it("an item trashed while the full text was being read sends no request", async function () {
      const it = await makeItem("Queued trash fixture");
      Z().getPrimaryPDFFulltext = async (item, C2) => {
        it.deleted = true;
        await it.saveTx();
        return readyText(GOOD_ABSTRACT)(item, C2);
      };
      let calls = 0;
      Z().makeLLMFetchFn = () => async () => { calls++; return answer(GOOD_ABSTRACT); };
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "skipped");
      assert.equal(calls, 0);
    });

    it("an item with no PDF, or with unindexed text, is counted as no full text", async function () {
      const it = await makeItem("No fulltext fixture");
      Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noPrimaryPDF" });
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "no-fulltext");
    });

    it("an abstract set by another write while the call was in flight is not overwritten", async function () {
      const it = await makeItem("Race fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => {
        it.setField("abstractNote", "Set by someone else while the call was in flight.");
        await it.saveTx();
        return answer(GOOD_ABSTRACT);
      };
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "skipped");
      assert.equal(it.getField("abstractNote"), "Set by someone else while the call was in flight.");
      assert.notInclude(it.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
    });

    it("an item trashed while the call was in flight gets nothing written", async function () {
      const it = await makeItem("Trashed fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      Z().makeLLMFetchFn = () => async () => {
        it.deleted = true;
        await it.saveTx();
        return answer(GOOD_ABSTRACT);
      };
      const res = await Z().extractAbstractForItem(win, it);
      assert.equal(res.outcome, "skipped");
      assert.equal(it.getField("abstractNote"), "");
    });
  });

  describe("extractAbstractsForItems (the menu flow)", function () {
    it("covers AE1: an item with an abstract is skipped with no fetch call, and its abstract is unchanged", async function () {
      const hasAbstract = await makeItem("Has abstract fixture", { abstract: "Already has a publisher abstract right here." });
      const missing = await makeItem("Needs extraction fixture");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      let calls = 0;
      Z().makeLLMFetchFn = () => async () => { calls++; return answer(GOOD_ABSTRACT); };
      Z().selectedRegularItems = () => [hasAbstract, missing];
      let summary = null;
      Z().finishProgress = (pw, text) => { summary = text; };

      await Z().extractAbstractsForItems(win);

      assert.equal(calls, 1, "only the missing item triggers a fetch");
      assert.equal(hasAbstract.getField("abstractNote"), "Already has a publisher abstract right here.");
      assert.notInclude(hasAbstract.getTags().map((t) => t.tag), C.ABSTRACT_TAG);
      assert.equal(missing.getField("abstractNote"), GOOD_ABSTRACT);
      assert.equal(summary, "Abstracts — extracted 1, not found 0, no full text 0, failed 0, skipped 1.");
    });

    it("with no LLM configured and one item missing an abstract, the action shows the not-configured message and makes no call", async function () {
      const missing = await makeItem("Unconfigured fixture");
      Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "", true);
      let called = false;
      Z().makeLLMFetchFn = () => async () => { called = true; return answer(GOOD_ABSTRACT); };
      Z().selectedRegularItems = () => [missing];
      let summary = null;
      Z().finishProgress = (pw, text) => { summary = text; };

      await Z().extractAbstractsForItems(win);

      assert.isFalse(called);
      assert.equal(summary, Z().t("err.llmNotConfigured"));
      assert.equal(missing.getField("abstractNote"), "");
    });

    it("a stop signal (the instance no longer live) during a multi-item run stops further calls under runBounded", async function () {
      const a = await makeItem("Stop fixture A");
      const b = await makeItem("Stop fixture B");
      const c = await makeItem("Stop fixture C");
      Z().getPrimaryPDFFulltext = readyText(GOOD_ABSTRACT);
      let calls = 0;
      Z().makeLLMFetchFn = () => async () => {
        calls++;
        if (calls === 1) Z().autoSummaryLive = () => false; // simulates the window/instance going away mid-run
        return answer(GOOD_ABSTRACT);
      };
      Z().selectedRegularItems = () => [a, b, c];

      await Z().extractAbstractsForItems(win);

      assert.equal(calls, 1, "runBounded's shouldStop stops further claims once the instance is no longer live");
    });
  });

  describe("the menu entry's visibility (updateItemMenu)", function () {
    it("is hidden when every selected item already has an abstract, shown and labeled otherwise", async function () {
      const hasAbstract = await makeItem("Has abstract fixture 2", { abstract: "Something." });
      const missing = await makeItem("Missing fixture 2");

      Z().selectedRegularItems = () => [hasAbstract];
      let els = { sep: fakeEl(), miSummary: fakeEl(), miDOI: fakeEl(), miAbstract: fakeEl() };
      Z().updateItemMenu(win, els);
      assert.isTrue(els.miAbstract.hidden);

      Z().selectedRegularItems = () => [hasAbstract, missing];
      els = { sep: fakeEl(), miSummary: fakeEl(), miDOI: fakeEl(), miAbstract: fakeEl() };
      let label = null;
      els.miAbstract.setAttribute = (name, value) => { if (name === "label") label = value; };
      Z().updateItemMenu(win, els);
      assert.isFalse(els.miAbstract.hidden);
      assert.equal(label, Z().t("menu.extractAbstract"));
    });
  });
});
