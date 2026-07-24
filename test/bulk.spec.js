import { describe, it, expect } from "vitest";
import { planBulk, summarizeBulkResults, formatBulkFailures } from "../src/bulk.js";

describe("planBulk", () => {
  const items = [
    { key: "A", hasExistingNote: false },
    { key: "B", hasExistingNote: true },
    { key: "C", hasExistingNote: false },
    { key: "D", hasExistingNote: true },
  ];

  it("skip policy: existing-note items are skipped, others created", () => {
    expect(planBulk(items, "skip")).toEqual([
      { key: "A", action: "create" },
      { key: "B", action: "skip" },
      { key: "C", action: "create" },
      { key: "D", action: "skip" },
    ]);
  });

  it("additional policy: every item is created regardless of existing notes", () => {
    expect(planBulk(items, "additional")).toEqual([
      { key: "A", action: "create" },
      { key: "B", action: "create" },
      { key: "C", action: "create" },
      { key: "D", action: "create" },
    ]);
  });

  it("overwrite policy: existing-note items overwrite, others create", () => {
    expect(planBulk(items, "overwrite")).toEqual([
      { key: "A", action: "create" },
      { key: "B", action: "overwrite" },
      { key: "C", action: "create" },
      { key: "D", action: "overwrite" },
    ]);
  });

  it("defaults an unrecognised policy to skip semantics (fail safe)", () => {
    expect(planBulk([{ key: "X", hasExistingNote: true }], "bogus"))
      .toEqual([{ key: "X", action: "skip" }]);
  });

  it("is defensive against a non-array items list", () => {
    expect(planBulk(null, "skip")).toEqual([]);
    expect(planBulk(undefined, "additional")).toEqual([]);
  });

  it("handles an empty items list", () => {
    expect(planBulk([], "overwrite")).toEqual([]);
  });

  it("coerces a missing key to an empty string", () => {
    expect(planBulk([{ hasExistingNote: false }], "skip"))
      .toEqual([{ key: "", action: "create" }]);
  });
});

describe("summarizeBulkResults", () => {
  it("formats all four counts", () => {
    expect(summarizeBulkResults({ created: 3, overwritten: 1, skipped: 2, failed: 0 }))
      .toBe("created 3, overwritten 1, skipped 2, failed 0");
  });

  it("defaults missing/non-numeric fields to 0", () => {
    expect(summarizeBulkResults({})).toBe("created 0, overwritten 0, skipped 0, failed 0");
    expect(summarizeBulkResults(null)).toBe("created 0, overwritten 0, skipped 0, failed 0");
    expect(summarizeBulkResults({ created: "x", failed: 2 }))
      .toBe("created 0, overwritten 0, skipped 0, failed 2");
  });
});

describe("formatBulkFailures", () => {
  it("returns an empty string for no failures", () => {
    expect(formatBulkFailures([])).toBe("");
    expect(formatBulkFailures(null)).toBe("");
    expect(formatBulkFailures(undefined)).toBe("");
  });

  it("formats one failure per line as 'title: reason'", () => {
    const failures = [
      { title: "Paper One", reason: "no extracted full text available" },
      { title: "Paper Two", reason: "HTTP 500" },
    ];
    expect(formatBulkFailures(failures)).toBe(
      "Paper One: no extracted full text available\nPaper Two: HTTP 500"
    );
  });

  it("falls back to '(untitled)' for a blank title and 'unknown error' for a missing reason", () => {
    // An empty-string reason is a real (empty) value, distinct from an absent
    // one; only absent/null reason falls back to "unknown error".
    expect(formatBulkFailures([{ title: "", reason: "" }])).toBe("(untitled): ");
    expect(formatBulkFailures([{}])).toBe("(untitled): unknown error");
  });

  it("passes the reason through verbatim (metadata-only by caller contract)", () => {
    const failures = [{ title: "T", reason: "context missing: no usable annotations" }];
    expect(formatBulkFailures(failures)).toBe("T: context missing: no usable annotations");
  });
});
