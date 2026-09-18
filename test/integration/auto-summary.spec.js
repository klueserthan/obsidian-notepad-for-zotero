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

// Covers U2 (settings and prefs, R1/R3/R8, KTD4): the four PREF_*/DEFAULT_*
// pairs, their getters (which delegate validation to src/auto-summary.js via
// C = win.ZONCore), and the first-seen-map setter. No sweep/timer/tag-writing
// logic lives here — that's U4.
describe("auto summary: settings and prefs (U2)", function () {
  let win, C;
  let prevEnabled, prevTag, prevWait, prevFirstSeen;

  before(async function () {
    win = Zotero.getMainWindow();
    await Zotero.ZON.injectCore(win);
    C = win.ZONCore;
    prevEnabled = Zotero.Prefs.get(Z().PREF_AUTO_SUMMARY_ENABLED, true);
    prevTag = Zotero.Prefs.get(Z().PREF_AUTO_SUMMARY_TRIGGER_TAG, true);
    prevWait = Zotero.Prefs.get(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, true);
    prevFirstSeen = Zotero.Prefs.get(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, true);
  });

  beforeEach(function () {
    // Unset all four prefs before every scenario so each starts from an
    // undefined ("fresh profile") value; each test then sets only what it needs.
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_ENABLED, true); } catch (e) {}
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_TRIGGER_TAG, true); } catch (e) {}
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, true); } catch (e) {}
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, true); } catch (e) {}
  });

  after(function () {
    let restore = (pref, value) => {
      try {
        if (value === undefined) Zotero.Prefs.clear(pref, true);
        else Zotero.Prefs.set(pref, value, true);
      } catch (e) {}
    };
    restore(Z().PREF_AUTO_SUMMARY_ENABLED, prevEnabled);
    restore(Z().PREF_AUTO_SUMMARY_TRIGGER_TAG, prevTag);
    restore(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, prevWait);
    restore(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, prevFirstSeen);
  });

  it("a fresh profile (no stored prefs) reads the mode off, the trigger tag as the default, and the wait as 24 hours", function () {
    assert.isFalse(Z().autoSummaryEnabled());
    assert.equal(Z().autoSummaryTriggerTag(C), C.AUTO_SUMMARY_DEFAULTS.TRIGGER_TAG);
    assert.equal(Z().autoSummaryWaitHours(C), 24);
  });

  it("a non-numeric wait pref reads as 24 hours", function () {
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, "not-a-number", true);
    assert.equal(Z().autoSummaryWaitHours(C), 24);
  });

  it("a negative wait pref reads as 24 hours", function () {
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, -5, true);
    assert.equal(Z().autoSummaryWaitHours(C), 24);
  });

  it("a trigger-tag pref equal to the Summary Note marker tag (zps:summary-note) reads as invalid", function () {
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_TRIGGER_TAG, "zps:summary-note", true);
    assert.equal(Z().autoSummaryTriggerTag(C), "");
  });

  it("a corrupt first-seen pref reads as an empty map", function () {
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, "{not json", true);
    assert.deepEqual(Z().autoSummaryFirstSeenMap(C), {});
  });

  it("setAutoSummaryFirstSeenMap round-trips a map through autoSummaryFirstSeenMap", function () {
    let map = { "1/ABCD1234": 1700000000000 };
    Z().setAutoSummaryFirstSeenMap(map);
    assert.deepEqual(Z().autoSummaryFirstSeenMap(C), map);
  });
});

// Covers U4 (the sweep engine, F1/F2, AE1–AE7, KTD1–KTD11). Calls the sweep
// directly with the timer stopped, so no tick races a test. Fakes: full text
// (getPrimaryPDFFulltext), the LLM transport (makeLLMFetchFn — one fake answers
// both detection and {% llm %} blocks), Zotero.Fulltext.indexItems, and the
// sync/liveness/grace probes; every pref, patch, and item is restored.
describe("auto summary: sweep engine (U4)", function () {
  this.timeout(30000);

  const TRIGGER = "zps:summarize";
  const FAILED = "zps:summarize-failed";
  const NO_FT = "zps:summarize-no-fulltext";
  const HOUR = 3600 * 1000;
  const PATCHED = ["getPrimaryPDFFulltext", "makeLLMFetchFn", "autoSummaryLive", "autoSummarySyncing",
    "generateSummaryNote", "applyAutoSummaryTags", "resolveSummaryMdForItem", "logAutoSummaryFailure"];
  const answer = (content) => JSON.stringify({ choices: [{ message: { content } }] });

  let win, C, dir, created, fetchCalls, fetchExtras, reply;
  let prefs, saved = {}, real = {}, realIndexItems, realStartedAt;

  const tagsOf = (item) => item.getTags().map((t) => t.tag).sort();
  const notesOf = (item) => Z().existingSummaryNotes(item);
  const keyOf = (item) => item.libraryID + "/" + item.key;
  const firstSeen = () => Z().autoSummaryFirstSeenMap(C);
  const sweep = () => Z().runAutoSummarySweep();
  // The item title rides along in both the detection prompt and the full-text
  // context, so a fake fetch can tell items apart.
  const readyText = async (item) => ({ ok: true, attachmentTitle: "PDF", text: "Full text of " + item.getField("title") });

  async function makeItem(title, { abstract = "An abstract about something worth summarizing.", tags = [TRIGGER] } = {}) {
    let item = new Zotero.Item("journalArticle");
    item.setField("title", title);
    if (abstract) item.setField("abstractNote", abstract);
    for (let t of tags) item.addTag(t);
    await item.saveTx();
    created.push(item);
    return item;
  }

  async function addPdfAttachment(item) {
    let att = new Zotero.Item("attachment");
    att.parentID = item.id;
    att.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
    att.attachmentContentType = "application/pdf";
    att.attachmentPath = "storage:paper.pdf";
    await att.saveTx();
    return att;
  }

  before(async function () {
    win = Zotero.getMainWindow();
    await Z().injectCore(win);
    C = win.ZONCore;
    Z().stopAutoSummaryTimer();
    prefs = [Z().PREF_TEMPLATES_DIR, Z().PREF_DEFAULT_NOTE, Z().PREF_LLM_BASE_URL, Z().PREF_LLM_MODEL,
      Z().PREF_LLM_API_KEY, Z().PREF_AUTO_SUMMARY_ENABLED, Z().PREF_AUTO_SUMMARY_TRIGGER_TAG,
      Z().PREF_AUTO_SUMMARY_WAIT_HOURS, Z().PREF_AUTO_SUMMARY_FIRST_SEEN];
    for (let p of prefs) saved[p] = Zotero.Prefs.get(p, true);
    for (let m of PATCHED) real[m] = Z()[m];
    realIndexItems = Zotero.Fulltext.indexItems;
    realStartedAt = Z()._startedAt;
  });

  beforeEach(async function () {
    created = [];
    fetchCalls = 0;
    fetchExtras = [];
    reply = () => answer("1");
    dir = PathUtils.join(PathUtils.tempDir, "zon-auto-sweep-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    for (let n of Object.keys(Z().BUILTIN_TEMPLATES)) {
      await IOUtils.writeUTF8(PathUtils.join(dir, n + ".md"), Z().BUILTIN_TEMPLATES[n]);
    }
    Zotero.Prefs.set(Z().PREF_TEMPLATES_DIR, dir, true);
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "", true);
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "http://localhost:11434/v1", true);
    Zotero.Prefs.set(Z().PREF_LLM_MODEL, "test-model", true);
    Zotero.Prefs.set(Z().PREF_LLM_API_KEY, "", true);
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_ENABLED, true, true);
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, "{}", true);
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_TRIGGER_TAG, true); } catch (e) {}
    try { Zotero.Prefs.clear(Z().PREF_AUTO_SUMMARY_WAIT_HOURS, true); } catch (e) {}
    await Z().loadTemplates();
    Z().makeLLMFetchFn = (extra) => {
      fetchExtras.push(extra);
      return async (url, headers, payload) => { fetchCalls++; return reply(payload); };
    };
    Z().getPrimaryPDFFulltext = readyText;
    Z().autoSummarySyncing = () => false;
    Z()._startedAt = 0; // the KTD5 startup grace is long over
    Z()._autoSummaryCooldown = null;
  });

  afterEach(async function () {
    for (let m of PATCHED) Z()[m] = real[m];
    Zotero.Fulltext.indexItems = realIndexItems;
    Z()._autoSummaryCooldown = null;
    for (let item of created) { try { await item.eraseTx(); } catch (e) {} }
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });

  after(async function () {
    for (let p of prefs) {
      try {
        if (saved[p] === undefined) Zotero.Prefs.clear(p, true);
        else Zotero.Prefs.set(p, saved[p], true);
      } catch (e) {}
    }
    Z()._startedAt = realStartedAt;
    await Z().loadTemplates();
    Z().startAutoSummaryTimer();
  });

  it("F1: a tagged item with an abstract and ready full text gets one Summary Note, loses its trigger tag, and has no first-seen entry", async function () {
    const item = await makeItem("F1 fixture");
    await sweep();
    const notes = notesOf(item);
    assert.lengthOf(notes, 1);
    assert.include(notes[0].getTags().map((t) => t.tag), Z().MARKER_TAG);
    assert.notInclude(tagsOf(item), TRIGGER);
    assert.notProperty(firstSeen(), keyOf(item));
    assert.isAbove(fetchCalls, 0);
    assert.isTrue(fetchExtras.every((e) => e && e.errorDelayMax === 0), "the automatic path disables Zotero's 5xx retry");
  });

  it("AE6: with the mode off, a tagged item keeps its tag, the fake fetch is never called, and the first-seen map is cleared", async function () {
    const item = await makeItem("AE6 fixture");
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, JSON.stringify({ [keyOf(item)]: Date.now() }), true);
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_ENABLED, false, true);
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(firstSeen(), {});
  });

  it("AE7: with the mode on and an empty base URL, a tagged item keeps its tag, gets no failure tag, and the fake fetch is never called", async function () {
    const item = await makeItem("AE7 fixture");
    Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "", true);
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
    assert.equal(fetchCalls, 0);
    assert.lengthOf(notesOf(item), 0);
  });

  it("AE3: a tagged item that already has a Summary Note gets no new note and loses its trigger tag", async function () {
    const item = await makeItem("AE3 fixture");
    let note = new Zotero.Item("note");
    note.parentID = item.id;
    note.setNote("<p>Mine</p>");
    note.addTag(Z().MARKER_TAG);
    await note.saveTx();
    const body = note.getNote();
    await sweep();
    assert.lengthOf(notesOf(item), 1);
    assert.equal(note.getNote(), body, "the existing note is untouched");
    assert.deepEqual(tagsOf(item), []);
    assert.equal(fetchCalls, 0);
  });

  it("AE1: an item without full text past its wait, grace over and no sync, gets the no-full-text tag in place of the trigger tag", async function () {
    const item = await makeItem("AE1 fixture");
    Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noPrimaryPDF" });
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, JSON.stringify({ [keyOf(item)]: Date.now() - 25 * HOUR }), true);
    await sweep();
    assert.deepEqual(tagsOf(item), [NO_FT]);
    assert.equal(fetchCalls, 0);
    assert.notProperty(firstSeen(), keyOf(item));
  });

  it("AE1: an item without full text inside its wait keeps its tags and its first-seen entry", async function () {
    const item = await makeItem("Waiting fixture");
    Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noPrimaryPDF" });
    const seen = Date.now() - 2 * HOUR;
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, JSON.stringify({ [keyOf(item)]: seen }), true);
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
    assert.equal(firstSeen()[keyOf(item)], seen);
  });

  it("a PDF with no full-text cache gets one index request and then a note", async function () {
    const item = await makeItem("Index fixture");
    const att = await addPdfAttachment(item);
    let indexed = false;
    const calls = [];
    Zotero.Fulltext.indexItems = async (ids, opts) => { calls.push({ ids, opts }); indexed = true; };
    Z().getPrimaryPDFFulltext = async (it) => (indexed ? readyText(it) : { ok: false, reason: "noExtractedText" });
    await sweep();
    assert.lengthOf(calls, 1);
    assert.deepEqual(calls[0].ids, [att.id]);
    assert.isTrue(calls[0].opts.ignoreErrors);
    assert.lengthOf(notesOf(item), 1);
    assert.notInclude(tagsOf(item), TRIGGER);
  });

  it("a second sweep in the same session makes no further index request for an attachment that still has no text", async function () {
    const item = await makeItem("Unindexable fixture");
    await addPdfAttachment(item);
    const calls = [];
    Zotero.Fulltext.indexItems = async (ids) => { calls.push(ids); };
    Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noExtractedText" });
    await sweep();
    await sweep();
    assert.lengthOf(calls, 1);
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("an item whose wait has passed while a sync is in progress keeps its trigger tag and gets no failure tag", async function () {
    const item = await makeItem("Syncing fixture");
    Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noPrimaryPDF" });
    Z().autoSummarySyncing = () => true;
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, JSON.stringify({ [keyOf(item)]: Date.now() - 25 * HOUR }), true);
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("an item whose wait has passed within 10 minutes of startup keeps its trigger tag and gets no failure tag", async function () {
    const item = await makeItem("Grace fixture");
    Z().getPrimaryPDFFulltext = async () => ({ ok: false, reason: "noPrimaryPDF" });
    Z()._startedAt = Date.now();
    Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_FIRST_SEEN, JSON.stringify({ [keyOf(item)]: Date.now() - 25 * HOUR }), true);
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("AE4: an item with an empty abstract gets a note built from the default note type", async function () {
    const item = await makeItem("AE4 fixture", { abstract: "" });
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "note-review", true);
    const names = [];
    Z().resolveSummaryMdForItem = function (w, it, name, opts) {
      names.push(name);
      return real.resolveSummaryMdForItem.call(this, w, it, name, opts);
    };
    await sweep();
    assert.deepEqual(names, ["note-review"]);
    assert.lengthOf(notesOf(item), 1);
    assert.notInclude(tagsOf(item), TRIGGER);
  });

  // U3: abstract extraction ahead of detection (KTD4, R9, R11, R12). Payloads
  // are told apart by their system prompt (C.EXTRACT_SYSTEM_PROMPT vs
  // C.DETECT_SYSTEM_PROMPT), never by call order, since a block-runner resolve
  // call may also hit `reply` for a template with {% llm %} blocks.
  it("an item without an abstract whose indexed text contains one gets it extracted with the marker tag, and detection runs on the extracted text", async function () {
    const item = await makeItem("Extraction happy path fixture", { abstract: "" });
    const ABSTRACT = "This paper studies how a verbatim abstract can be extracted from indexed " +
      "full text and verified against the source before it is ever written back to the record.";
    Z().getPrimaryPDFFulltext = async () => ({
      ok: true, attachmentTitle: "PDF",
      text: "Journal of Testing\n\nAbstract\n" + ABSTRACT +
        "\n\n1. Introduction\nFiller body text follows the abstract so the source resembles a real article.",
    });
    let detectPayload = null;
    reply = (payload) => {
      const system = payload.messages[0].content;
      if (system === C.EXTRACT_SYSTEM_PROMPT) return answer(ABSTRACT);
      if (system === C.DETECT_SYSTEM_PROMPT) { detectPayload = payload; return answer("2"); }
      return answer("block content"); // a resolve step's {% llm %} block, if any
    };
    await sweep();
    assert.equal(item.getField("abstractNote"), ABSTRACT);
    assert.include(JSON.stringify(detectPayload.messages), ABSTRACT, "detection ran on the extracted abstract");
    assert.deepEqual(tagsOf(item), [C.ABSTRACT_TAG]);
    assert.lengthOf(notesOf(item), 1);
  });

  it("covers the plan's AE3: a NONE extraction reply writes no abstract and yields a default-type note without the failure tag", async function () {
    const item = await makeItem("Plan AE3 fixture", { abstract: "" });
    Zotero.Prefs.set(Z().PREF_DEFAULT_NOTE, "note-review", true);
    Z().getPrimaryPDFFulltext = async () => ({
      ok: true, attachmentTitle: "PDF",
      text: "Journal of Testing\n\n1. Introduction\nThis commentary opens with no abstract of its own, " +
        "just body text discussing the topic at length.",
    });
    const names = [];
    Z().resolveSummaryMdForItem = function (w, it, name, opts) {
      names.push(name);
      return real.resolveSummaryMdForItem.call(this, w, it, name, opts);
    };
    reply = (payload) => (payload.messages[0].content === C.EXTRACT_SYSTEM_PROMPT ? answer("NONE") : answer("1"));
    await sweep();
    assert.equal(item.getField("abstractNote"), "");
    assert.deepEqual(names, ["note-review"]);
    assert.lengthOf(notesOf(item), 1);
    assert.notInclude(tagsOf(item), FAILED);
    assert.notInclude(tagsOf(item), C.ABSTRACT_TAG);
  });

  it("covers the plan's AE4: a rejected extraction request with status 429 logs extract.httpFailed, tags failure, creates no note, and pauses the mode", async function () {
    const item = await makeItem("Plan AE4 fixture", { abstract: "" });
    const logged = [];
    Z().logAutoSummaryFailure = (it, code, status) => logged.push([code, status]);
    reply = (payload) => {
      if (payload.messages[0].content === C.EXTRACT_SYSTEM_PROMPT) {
        throw Object.assign(new Error("too many requests"), { status: 429 });
      }
      return answer("1");
    };
    await sweep();
    assert.deepEqual(logged, [["extract.httpFailed", 429]]);
    assert.deepEqual(tagsOf(item), [FAILED]);
    assert.lengthOf(notesOf(item), 0);
    const calls = fetchCalls;
    await sweep();
    assert.equal(fetchCalls, calls, "no item is processed during the cooldown");
  });

  it("an item that already has an abstract makes no extraction call", async function () {
    const item = await makeItem("Already has abstract fixture"); // default non-empty abstract
    let sawExtract = false;
    reply = (payload) => {
      if (payload.messages[0].content === C.EXTRACT_SYSTEM_PROMPT) sawExtract = true;
      return answer("1");
    };
    await sweep();
    assert.isFalse(sawExtract);
    assert.lengthOf(notesOf(item), 1);
  });

  it("an empty completion puts the generic failure tag on that item, and the next tagged item in the same sweep still gets a note", async function () {
    const empty = await makeItem("Empty completion fixture");
    const healthy = await makeItem("Healthy fixture");
    reply = (payload) => answer(JSON.stringify(payload).includes("Empty completion fixture") ? "" : "1");
    await sweep();
    assert.deepEqual(tagsOf(empty), [FAILED]);
    assert.lengthOf(notesOf(empty), 0);
    assert.lengthOf(notesOf(healthy), 1);
    assert.deepEqual(tagsOf(healthy), []);
  });

  it("a network error tags the first item as failed, stops the sweep, pauses sweeps for 60 minutes, and a model change ends the pause", async function () {
    const a = await makeItem("Provider fixture A");
    const b = await makeItem("Provider fixture B");
    reply = () => { throw new Error("network down"); };
    await sweep();
    const failed = [a, b].filter((it) => tagsOf(it).includes(FAILED));
    const waiting = [a, b].filter((it) => tagsOf(it).includes(TRIGGER));
    assert.lengthOf(failed, 1);
    assert.lengthOf(waiting, 1);
    assert.deepEqual(tagsOf(failed[0]), [FAILED]);

    reply = () => answer("1");
    const calls = fetchCalls;
    await sweep();
    assert.equal(fetchCalls, calls, "no item is processed during the cooldown");
    assert.deepEqual(tagsOf(waiting[0]), [TRIGGER]);

    Zotero.Prefs.set(Z().PREF_LLM_MODEL, "other-model", true);
    await sweep();
    assert.lengthOf(notesOf(waiting[0]), 1);
    assert.deepEqual(tagsOf(waiting[0]), []);
  });

  it("a refused connection (HTTP status 0) at extraction on no-abstract items fails only the first item and pauses sweeps", async function () {
    // No abstract, so extraction runs before detection (KTD4) and this is the
    // request that fails, shaped like Zotero.HTTP's rejection for a refused connection.
    const a = await makeItem("Refused fixture A", { abstract: "" });
    const b = await makeItem("Refused fixture B", { abstract: "" });
    reply = () => { throw Object.assign(new Error("connection refused"), { status: 0 }); };
    try {
      await sweep();
      const failed = [a, b].filter((it) => tagsOf(it).includes(FAILED));
      const waiting = [a, b].filter((it) => tagsOf(it).includes(TRIGGER));
      assert.lengthOf(failed, 1, "a transport failure stops the sweep after one item");
      assert.lengthOf(waiting, 1);
      const calls = fetchCalls;
      await sweep();
      assert.equal(fetchCalls, calls, "no item is processed during the cooldown");
    } finally {
      Z()._autoSummaryCooldown = null;
    }
  });

  it("clearing the base URL during the first of two items adds no failure tag and leaves both trigger tags", async function () {
    const a = await makeItem("Unconfigured fixture A");
    const b = await makeItem("Unconfigured fixture B");
    reply = () => { Zotero.Prefs.set(Z().PREF_LLM_BASE_URL, "", true); return answer("1"); };
    await sweep();
    assert.deepEqual(tagsOf(a), [TRIGGER]);
    assert.deepEqual(tagsOf(b), [TRIGGER]);
    assert.lengthOf(notesOf(a), 0);
    assert.lengthOf(notesOf(b), 0);
  });

  it("a detected note type deleted before resolve leaves the trigger tag and adds no failure tag", async function () {
    const item = await makeItem("Deleted type fixture");
    reply = async () => {
      for (let n of Object.keys(Z().BUILTIN_TEMPLATES)) await IOUtils.remove(PathUtils.join(dir, n + ".md"), { ignoreAbsent: true });
      await Z().loadTemplates();
      return answer("1");
    };
    await sweep();
    assert.deepEqual(tagsOf(item), [TRIGGER]);
    assert.lengthOf(notesOf(item), 0);
  });

  it("AE5: an item carrying both the trigger tag and a failure tag loses the failure tag at pickup and gets a note", async function () {
    const item = await makeItem("AE5 fixture", { tags: [TRIGGER, FAILED] });
    await sweep();
    assert.lengthOf(notesOf(item), 1);
    assert.deepEqual(tagsOf(item), []);
  });

  it("a trashed tagged item is not processed", async function () {
    const item = await makeItem("Trashed fixture");
    item.deleted = true;
    await item.saveTx();
    await sweep();
    assert.equal(fetchCalls, 0);
    assert.lengthOf(notesOf(item), 0);
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("calling the sweep while a sweep is already running returns without processing any item", async function () {
    const item = await makeItem("Concurrent fixture");
    const first = sweep();
    await sweep();
    assert.equal(fetchCalls, 0);
    assert.lengthOf(notesOf(item), 0);
    await first;
    assert.lengthOf(notesOf(item), 1);
  });

  it("removing the trigger tag mid-resolve results in no note being created", async function () {
    const item = await makeItem("Untagged mid-run fixture");
    reply = async () => {
      if (fetchCalls === 2) { item.removeTag(TRIGGER); await item.saveTx(); }
      return answer("1");
    };
    await sweep();
    assert.lengthOf(notesOf(item), 0);
  });

  it("making the instance not live inside the fake fetch results in no note and no tag change", async function () {
    const item = await makeItem("Dead instance fixture");
    reply = () => { Z().autoSummaryLive = () => false; return answer("1"); };
    await sweep();
    assert.lengthOf(notesOf(item), 0);
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("deleting the created note before the success tag write leaves the trigger tag in place", async function () {
    const item = await makeItem("Vanished note fixture");
    Z().generateSummaryNote = async function (...args) {
      const note = await real.generateSummaryNote.apply(this, args);
      await note.eraseTx();
      return note;
    };
    await sweep();
    assert.lengthOf(notesOf(item), 0);
    assert.deepEqual(tagsOf(item), [TRIGGER]);
  });

  it("a note save that throws logs create.failed and puts the failure tag in place of the trigger tag", async function () {
    const item = await makeItem("Save failure fixture");
    const logged = [];
    Z().logAutoSummaryFailure = (it, code, status) => logged.push([code, status]);
    Z().generateSummaryNote = async () => { throw new Error("save failed"); };
    await sweep();
    assert.lengthOf(notesOf(item), 0);
    assert.deepEqual(tagsOf(item), [FAILED]);
    assert.deepEqual(logged, [["create.failed", null]]);
  });

  it("a detection request rejected with HTTP 429 logs detect.httpFailed with status 429", async function () {
    const item = await makeItem("Throttled detection fixture");
    const logged = [];
    Z().logAutoSummaryFailure = (it, code, status) => logged.push([code, status]);
    reply = () => { throw Object.assign(new Error("too many requests"), { status: 429 }); };
    await sweep();
    assert.deepEqual(logged, [["detect.httpFailed", 429]]);
    assert.deepEqual(tagsOf(item), [FAILED]);
  });

  it("a tag write that throws after the note is created lets the sweep continue, and the next sweep clears the tag via the R9 path", async function () {
    const a = await makeItem("Write failure fixture A");
    const b = await makeItem("Write failure fixture B");
    let thrown = false;
    Z().applyAutoSummaryTags = async function (core, item, outcome, tags) {
      if (outcome === "success" && !thrown) { thrown = true; throw new Error("write failed"); }
      return real.applyAutoSummaryTags.call(this, core, item, outcome, tags);
    };
    await sweep();
    assert.lengthOf(notesOf(a), 1);
    assert.lengthOf(notesOf(b), 1);
    assert.lengthOf([a, b].filter((it) => tagsOf(it).includes(TRIGGER)), 1);

    const calls = fetchCalls;
    await sweep();
    assert.equal(fetchCalls, calls, "the R9 path never calls the LLM");
    assert.deepEqual(tagsOf(a), []);
    assert.deepEqual(tagsOf(b), []);
    assert.lengthOf(notesOf(a), 1);
    assert.lengthOf(notesOf(b), 1);
  });

  it("switching the mode off inside the fake fetch leaves the first-seen pref cleared once the sweep ends", async function () {
    const item = await makeItem("Switched off fixture");
    reply = () => { Zotero.Prefs.set(Z().PREF_AUTO_SUMMARY_ENABLED, false, true); return answer("1"); };
    await sweep();
    assert.deepEqual(firstSeen(), {});
    assert.lengthOf(notesOf(item), 0);
  });
});

// KTD1: the sweep timer's lifecycle. Uses throwaway instances (Object.create
// over the live handle) with fake timers, so the real plugin keeps running.
describe("auto summary: sweep timer lifecycle (U4)", function () {
  before(function () { Z().stopAutoSummaryTimer(); });
  after(function () { Z().startAutoSummaryTimer(); });

  it("uninit cancels the sweep timer", function () {
    const handle = Zotero.ZON;
    const inst = Object.create(handle);
    inst._registeredPaneID = null;
    let cancelled = 0;
    inst._autoSummaryTimer = { cancel() { cancelled++; } };
    const realWindows = Zotero.getMainWindows;
    Zotero.getMainWindows = () => []; // keep uninit away from the real windows
    try { inst.uninit(); }
    finally { Zotero.getMainWindows = realWindows; Zotero.ZON = handle; }
    assert.equal(cancelled, 1);
    assert.isNull(inst._autoSummaryTimer);
  });

  it("starting a new instance cancels the previous Zotero.ZON's timer, so a single timer remains", function () {
    const prev = Z();
    let cancelled = 0;
    prev._autoSummaryTimer = { cancel() { cancelled++; } };
    const next = Object.create(prev);
    next._autoSummaryTimer = null;
    try {
      next.startAutoSummaryTimer();
      assert.equal(cancelled, 1);
      assert.isNull(prev._autoSummaryTimer);
      assert.isTrue(Object.hasOwn(next, "_autoSummaryTimer") && !!next._autoSummaryTimer, "the new instance holds the only timer");
    } finally {
      next.stopAutoSummaryTimer();
      prev._autoSummaryTimer = null;
    }
  });
});
