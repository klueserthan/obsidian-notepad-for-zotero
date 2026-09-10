import { describe, it, expect } from "vitest";
import { planBulk, bulkGate } from "../src/bulk.js";

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

  it("carries templateName through, and plans an excluded row as skip under every policy", () => {
    const row = { key: "A", hasExistingNote: false, templateName: "quantitative", included: true };
    for (const policy of ["skip", "additional", "overwrite"]) {
      expect(planBulk([row], policy)).toEqual([
        { key: "A", action: "create", templateName: "quantitative" },
      ]);
    }
    const excluded = { key: "B", hasExistingNote: true, templateName: "review", included: false };
    for (const policy of ["skip", "additional", "overwrite"]) {
      expect(planBulk([excluded], policy)).toEqual([
        { key: "B", action: "skip", templateName: "review" },
      ]);
    }
  });
});

describe("bulkGate", () => {
  it("AE10: skip policy, one row with an existing note and no template, all others assigned — canGenerate true, unassigned 0", () => {
    const rows = [
      { key: "A", hasExistingNote: true, templateName: null, included: true },
      { key: "B", hasExistingNote: false, templateName: "quantitative", included: true },
      { key: "C", hasExistingNote: false, templateName: "qualitative", included: true },
    ];
    expect(bulkGate(rows, "skip")).toEqual({ canGenerate: true, unassigned: 0, included: 3 });
  });

  it("same rows under policy additional — canGenerate false, unassigned 1", () => {
    const rows = [
      { key: "A", hasExistingNote: true, templateName: null, included: true },
      { key: "B", hasExistingNote: false, templateName: "quantitative", included: true },
      { key: "C", hasExistingNote: false, templateName: "qualitative", included: true },
    ];
    expect(bulkGate(rows, "additional")).toEqual({ canGenerate: false, unassigned: 1, included: 3 });
  });

  it("AE11: every row excluded — canGenerate false, unassigned 0, included 0", () => {
    const rows = [
      { key: "A", hasExistingNote: false, templateName: null, included: false },
      { key: "B", hasExistingNote: true, templateName: null, included: false },
    ];
    expect(bulkGate(rows, "skip")).toEqual({ canGenerate: false, unassigned: 0, included: 0 });
  });

  it("AE6: all rows assigned the same template — canGenerate true", () => {
    const rows = [
      { key: "A", hasExistingNote: false, templateName: "review", included: true },
      { key: "B", hasExistingNote: false, templateName: "review", included: true },
      { key: "C", hasExistingNote: true, templateName: "review", included: true },
    ];
    expect(bulkGate(rows, "overwrite")).toEqual({ canGenerate: true, unassigned: 0, included: 3 });
  });
});
