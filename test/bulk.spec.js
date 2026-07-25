import { describe, it, expect } from "vitest";
import { planBulk } from "../src/bulk.js";

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
