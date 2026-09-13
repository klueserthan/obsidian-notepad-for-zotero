import { describe, it, expect } from "vitest";
import {
  AUTO_SUMMARY_DEFAULTS,
  parseFirstSeenMap,
  updateFirstSeenMap,
  sanitizeWaitHours,
  planItemAction,
  chooseNoteType,
  classifyFailure,
  sanitizeTriggerTag,
  tagChangesForOutcome,
} from "../src/auto-summary.js";

const HOUR = 3600 * 1000;

describe("AUTO_SUMMARY_DEFAULTS", () => {
  it("carries the documented default tags and wait time", () => {
    expect(AUTO_SUMMARY_DEFAULTS).toEqual({
      TRIGGER_TAG: "zps:summarize",
      FAILURE_TAG: "zps:summarize-failed",
      NO_FULLTEXT_TAG: "zps:summarize-no-fulltext",
      WAIT_HOURS: 24,
    });
  });
});

describe("parseFirstSeenMap", () => {
  it("parses a valid JSON object", () => {
    expect(parseFirstSeenMap('{"L1/K1":123}')).toEqual({ "L1/K1": 123 });
  });

  it("returns {} for corrupt JSON", () => {
    expect(parseFirstSeenMap("not json")).toEqual({});
  });

  it("returns {} for non-object JSON (array, string, number, null)", () => {
    expect(parseFirstSeenMap("[1,2,3]")).toEqual({});
    expect(parseFirstSeenMap('"hello"')).toEqual({});
    expect(parseFirstSeenMap("42")).toEqual({});
    expect(parseFirstSeenMap("null")).toEqual({});
  });

  it("returns {} for missing/empty input", () => {
    expect(parseFirstSeenMap(undefined)).toEqual({});
    expect(parseFirstSeenMap("")).toEqual({});
  });
});

describe("updateFirstSeenMap (KTD4)", () => {
  it("gives a newly tagged key `now`", () => {
    expect(updateFirstSeenMap({}, ["L1/A"], 1000)).toEqual({ "L1/A": 1000 });
  });

  it("drops a key whose item is no longer tagged", () => {
    expect(updateFirstSeenMap({ "L1/A": 500, "L1/B": 600 }, ["L1/A"], 1000)).toEqual({ "L1/A": 500 });
  });

  it("keeps an existing entry's original time", () => {
    expect(updateFirstSeenMap({ "L1/A": 500 }, ["L1/A"], 1000)).toEqual({ "L1/A": 500 });
  });

  it("handles new, kept, and dropped keys together", () => {
    const stored = { "L1/A": 100, "L1/B": 200 };
    expect(updateFirstSeenMap(stored, ["L1/A", "L1/C"], 900)).toEqual({ "L1/A": 100, "L1/C": 900 });
  });

  it("is defensive against a non-object stored map and non-array tagged keys", () => {
    expect(updateFirstSeenMap(null, ["L1/A"], 1)).toEqual({ "L1/A": 1 });
    expect(updateFirstSeenMap({ "L1/A": 1 }, null, 1)).toEqual({});
  });
});

describe("sanitizeWaitHours", () => {
  it("passes through a positive number", () => {
    expect(sanitizeWaitHours(48)).toBe(48);
  });

  it("defaults non-numeric, zero, and negative values to 24", () => {
    expect(sanitizeWaitHours("abc")).toBe(24);
    expect(sanitizeWaitHours(0)).toBe(24);
    expect(sanitizeWaitHours(-5)).toBe(24);
    expect(sanitizeWaitHours(undefined)).toBe(24);
    expect(sanitizeWaitHours(null)).toBe(24);
  });

  it("accepts a numeric string", () => {
    expect(sanitizeWaitHours("12")).toBe(12);
  });
});

describe("planItemAction", () => {
  it("AE3: has-Summary-Note returns skip-existing whether or not full text is ready", () => {
    expect(planItemAction({
      hasSummaryNote: true, fulltextReady: false, firstSeen: 0, now: 0, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("skip-existing");
    expect(planItemAction({
      hasSummaryNote: true, fulltextReady: true, firstSeen: 0, now: 0, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("skip-existing");
  });

  it("AE1: no full text 2 hours after first-seen with a 24-hour wait returns wait", () => {
    expect(planItemAction({
      hasSummaryNote: false, fulltextReady: false, firstSeen: 0, now: 2 * HOUR, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("wait");
  });

  it("AE1: 25 hours after first-seen returns fail-no-fulltext", () => {
    expect(planItemAction({
      hasSummaryNote: false, fulltextReady: false, firstSeen: 0, now: 25 * HOUR, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("fail-no-fulltext");
  });

  it("AE2: no full text, wait passed, timeout not allowed (grace/sync in progress) returns wait", () => {
    expect(planItemAction({
      hasSummaryNote: false, fulltextReady: false, firstSeen: 0, now: 25 * HOUR, waitMs: 24 * HOUR, timeoutAllowed: false,
    })).toBe("wait");
  });

  it("full text ready returns process even when the wait already passed", () => {
    expect(planItemAction({
      hasSummaryNote: false, fulltextReady: true, firstSeen: 0, now: 25 * HOUR, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("process");
  });

  it("full text ready returns process well within the wait", () => {
    expect(planItemAction({
      hasSummaryNote: false, fulltextReady: true, firstSeen: 0, now: 1 * HOUR, waitMs: 24 * HOUR, timeoutAllowed: true,
    })).toBe("process");
  });
});

describe("chooseNoteType (KTD8)", () => {
  it("AE4: no-abstract falls back to the default name", () => {
    expect(chooseNoteType({ reason: "no-abstract" }, "default-note")).toEqual({ templateName: "default-note" });
  });

  it("no-candidate falls back to the default name", () => {
    expect(chooseNoteType({ reason: "no-candidate" }, "default-note")).toEqual({ templateName: "default-note" });
  });

  it("invalid-answer falls back to the default name", () => {
    expect(chooseNoteType({ reason: "invalid-answer" }, "default-note")).toEqual({ templateName: "default-note" });
  });

  it("a detected label returns its template", () => {
    expect(chooseNoteType({ templateName: "qualitative", label: "Qualitative" }, "default-note"))
      .toEqual({ templateName: "qualitative" });
  });

  it("http-failed returns a provider failure", () => {
    expect(chooseNoteType({ reason: "http-failed" }, "default-note")).toEqual({ providerFailure: true });
  });
});

describe("classifyFailure (KTD7)", () => {
  it("llm.run.httpFailed with no status classifies as provider", () => {
    expect(classifyFailure({ code: "llm.run.httpFailed", status: null })).toBe("provider");
    expect(classifyFailure({ code: "llm.run.httpFailed" })).toBe("provider");
  });

  it("llm.run.httpFailed with 401, 403, 404, 429, or 5xx classifies as provider", () => {
    for (const status of [401, 403, 404, 429, 500, 503, 599]) {
      expect(classifyFailure({ code: "llm.run.httpFailed", status })).toBe("provider");
    }
  });

  it("llm.run.httpFailed with 400 or 413 classifies as item", () => {
    expect(classifyFailure({ code: "llm.run.httpFailed", status: 400 })).toBe("item");
    expect(classifyFailure({ code: "llm.run.httpFailed", status: 413 })).toBe("item");
  });

  it("llm.run.emptyResponse, llm.run.contextTooLarge, and resolve.renderFailed classify as item", () => {
    expect(classifyFailure({ code: "llm.run.emptyResponse" })).toBe("item");
    expect(classifyFailure({ code: "llm.run.contextTooLarge" })).toBe("item");
    expect(classifyFailure({ code: "resolve.renderFailed" })).toBe("item");
  });

  it("every other llm.run.* code classifies as item", () => {
    expect(classifyFailure({ code: "llm.run.contextMissing" })).toBe("item");
    expect(classifyFailure({ code: "llm.run.contextUnsupported" })).toBe("item");
    expect(classifyFailure({ code: "llm.run.renderFailed" })).toBe("item");
    expect(classifyFailure({ code: "llm.run.parseErrors" })).toBe("item");
  });

  it("resolve.notConfigured, resolve.coreMissing, and resolve.unknownNoteType classify as abort", () => {
    expect(classifyFailure({ code: "resolve.notConfigured" })).toBe("abort");
    expect(classifyFailure({ code: "resolve.coreMissing" })).toBe("abort");
    expect(classifyFailure({ code: "resolve.unknownNoteType" })).toBe("abort");
  });
});

describe("sanitizeTriggerTag", () => {
  const opts = { failureTags: ["zps:summarize-failed", "zps:summarize-no-fulltext"], markerTag: "zps:summary-note" };

  it("trims surrounding whitespace", () => {
    expect(sanitizeTriggerTag("  zps:summarize  ", opts)).toBe("zps:summarize");
  });

  it("rejects blank and whitespace-only values", () => {
    expect(sanitizeTriggerTag("", opts)).toBe("");
    expect(sanitizeTriggerTag("   ", opts)).toBe("");
  });

  it("rejects a value equal to either failure tag", () => {
    expect(sanitizeTriggerTag("zps:summarize-failed", opts)).toBe("");
    expect(sanitizeTriggerTag("zps:summarize-no-fulltext", opts)).toBe("");
  });

  it("rejects the marker tag", () => {
    expect(sanitizeTriggerTag("zps:summary-note", opts)).toBe("");
  });

  it("accepts a valid distinct tag", () => {
    expect(sanitizeTriggerTag("my-custom-tag", opts)).toBe("my-custom-tag");
  });
});

describe("tagChangesForOutcome", () => {
  const tags = { triggerTag: "zps:summarize", failureTag: "zps:summarize-failed", noFulltextTag: "zps:summarize-no-fulltext" };

  it("AE5 / success: removes the trigger tag and both failure tags", () => {
    expect(tagChangesForOutcome("success", tags)).toEqual({
      add: [],
      remove: ["zps:summarize", "zps:summarize-failed", "zps:summarize-no-fulltext"],
    });
  });

  it("AE3 / skip-existing: removes the trigger tag and both failure tags", () => {
    expect(tagChangesForOutcome("skip-existing", tags)).toEqual({
      add: [],
      remove: ["zps:summarize", "zps:summarize-failed", "zps:summarize-no-fulltext"],
    });
  });

  it("fail: removes the trigger tag, adds the failure tag", () => {
    expect(tagChangesForOutcome("fail", tags)).toEqual({
      add: ["zps:summarize-failed"],
      remove: ["zps:summarize"],
    });
  });

  it("AE1 / fail-no-fulltext: removes the trigger tag, adds the no-full-text tag", () => {
    expect(tagChangesForOutcome("fail-no-fulltext", tags)).toEqual({
      add: ["zps:summarize-no-fulltext"],
      remove: ["zps:summarize"],
    });
  });

  it("AE5 / pickup: removes both failure tags, keeps the trigger tag", () => {
    expect(tagChangesForOutcome("pickup", tags)).toEqual({
      add: [],
      remove: ["zps:summarize-failed", "zps:summarize-no-fulltext"],
    });
  });

  it("an unrecognised outcome changes nothing", () => {
    expect(tagChangesForOutcome("bogus", tags)).toEqual({ add: [], remove: [] });
  });
});
