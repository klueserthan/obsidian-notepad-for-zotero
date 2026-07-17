import { describe, it, expect } from "vitest";
import {
  composeKey,
  blocksFingerprint,
  createComposeState,
  reconcileComposeState,
  hasLLMBlocks,
  isResolved,
  unresolvedBlocks,
  canGenerate,
  resolveAll,
  setResolution,
  clearResolutions,
  orderedOutputs,
  placeholderInfo,
  generateBlockedReason,
} from "../src/compose-gating.js";

const oneBlock =
  "## Summary\n\n" +
  '{% llm context="abstract" %}\n' +
  "Summarise the abstract.\n" +
  "{% endllm %}\n\n" +
  "After.\n";

const twoBlocks =
  '{% llm context="abstract" %}\nOne.\n{% endllm %}\n\n' +
  '{% llm context="annotations,fulltext" %}\nTwo.\n{% endllm %}\n';

describe("composeKey", () => {
  it("is stable and distinguishes item and template", () => {
    expect(composeKey("ITEM", "T")).toBe(composeKey("ITEM", "T"));
    expect(composeKey("ITEM", "T")).not.toBe(composeKey("ITEM", "U"));
    expect(composeKey("ITEM", "T")).not.toBe(composeKey("JTEM", "T"));
  });
  it("treats null/undefined as empty", () => {
    expect(composeKey(null, null)).toBe(composeKey(undefined, undefined));
  });
});

describe("createComposeState", () => {
  it("no LLM blocks → generate immediately permitted", () => {
    const s = createComposeState("# Just prose\n\nNo blocks here.\n", { itemKey: "A", templateName: "T" });
    expect(hasLLMBlocks(s)).toBe(false);
    expect(unresolvedBlocks(s)).toEqual([]);
    expect(canGenerate(s)).toBe(true);
    expect(generateBlockedReason(s)).toBe("");
  });

  it("unresolved blocks → cannot generate", () => {
    const s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    expect(hasLLMBlocks(s)).toBe(true);
    expect(unresolvedBlocks(s)).toHaveLength(1);
    expect(canGenerate(s)).toBe(false);
    expect(isResolved(s, 0)).toBe(false);
  });

  it("parse errors → no blocks captured and generate refused", () => {
    // Unclosed block → parse error.
    const bad = '{% llm context="abstract" %}\nno close tag\n';
    const s = createComposeState(bad, { itemKey: "A", templateName: "T" });
    expect(s.parseErrors.length).toBeGreaterThan(0);
    expect(s.blocks).toEqual([]);
    expect(canGenerate(s)).toBe(false);
    expect(generateBlockedReason(s)).toMatch(/invalid/i);
  });
});

describe("resolving blocks", () => {
  it("resolving all blocks flips canGenerate to true", () => {
    let s = createComposeState(twoBlocks, { itemKey: "A", templateName: "T" });
    expect(canGenerate(s)).toBe(false);
    expect(unresolvedBlocks(s)).toHaveLength(2);

    s = setResolution(s, 0, "out one");
    expect(canGenerate(s)).toBe(false); // one still unresolved
    expect(unresolvedBlocks(s)).toHaveLength(1);

    s = setResolution(s, 1, "out two");
    expect(canGenerate(s)).toBe(true);
    expect(unresolvedBlocks(s)).toEqual([]);
    expect(generateBlockedReason(s)).toBe("");
  });

  it("resolveAll resolves every block at once", () => {
    let s = createComposeState(twoBlocks, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["A", "B"]);
    expect(canGenerate(s)).toBe(true);
    expect(orderedOutputs(s)).toEqual(["A", "B"]);
    expect(isResolved(s, 0)).toBe(true);
    expect(isResolved(s, 1)).toBe(true);
  });

  it("resolveAll coerces missing/nullish outputs to empty strings", () => {
    let s = createComposeState(twoBlocks, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["only-one"]);
    expect(orderedOutputs(s)).toEqual(["only-one", ""]);
    expect(canGenerate(s)).toBe(true); // both indices are now present
  });

  it("resolveAll / setResolution do not mutate the prior state", () => {
    const s0 = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    const s1 = setResolution(s0, 0, "x");
    expect(isResolved(s0, 0)).toBe(false);
    expect(isResolved(s1, 0)).toBe(true);
    expect(canGenerate(s0)).toBe(false);
    expect(canGenerate(s1)).toBe(true);
  });

  it("clearResolutions drops the cache but keeps blocks", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["done"]);
    expect(canGenerate(s)).toBe(true);
    s = clearResolutions(s);
    expect(canGenerate(s)).toBe(false);
    expect(hasLLMBlocks(s)).toBe(true);
  });
});

describe("reconcileComposeState — cache invalidation", () => {
  it("same item + template + blocks → resolutions carried forward", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["cached output"]);
    expect(canGenerate(s)).toBe(true);

    // Re-render of the SAME compose (e.g. a debounced preview refresh).
    const s2 = reconcileComposeState(s, oneBlock, { itemKey: "A", templateName: "T" });
    expect(canGenerate(s2)).toBe(true);
    expect(orderedOutputs(s2)).toEqual(["cached output"]);
  });

  it("switching item invalidates the cache", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["cached"]);
    const s2 = reconcileComposeState(s, oneBlock, { itemKey: "B", templateName: "T" });
    expect(canGenerate(s2)).toBe(false);
    expect(unresolvedBlocks(s2)).toHaveLength(1);
  });

  it("switching template invalidates the cache", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["cached"]);
    const s2 = reconcileComposeState(s, oneBlock, { itemKey: "A", templateName: "U" });
    expect(canGenerate(s2)).toBe(false);
  });

  it("changing a block's prompt (same key) invalidates the cache", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["cached"]);
    const edited = oneBlock.replace("Summarise the abstract.", "Rewrite the abstract.");
    const s2 = reconcileComposeState(s, edited, { itemKey: "A", templateName: "T" });
    expect(canGenerate(s2)).toBe(false);
    expect(blocksFingerprint(s.blocks)).not.toBe(blocksFingerprint(s2.blocks));
  });

  it("first reconcile with null prev yields a fresh unresolved state", () => {
    const s = reconcileComposeState(null, oneBlock, { itemKey: "A", templateName: "T" });
    expect(canGenerate(s)).toBe(false);
    expect(unresolvedBlocks(s)).toHaveLength(1);
  });
});

describe("placeholderInfo", () => {
  it("surfaces model, context spec and prompt body per block", () => {
    const s = createComposeState(twoBlocks, { itemKey: "A", templateName: "T" });
    const info = placeholderInfo(s, { model: "gpt-4o-mini" });
    expect(info).toHaveLength(2);
    expect(info[0]).toMatchObject({
      index: 0,
      model: "gpt-4o-mini",
      contextLabel: "abstract",
      resolved: false,
      output: null,
    });
    expect(info[0].contexts).toEqual(["abstract"]);
    expect(info[0].body).toContain("One.");
    expect(info[1].contexts).toEqual(["annotations", "fulltext"]);
    expect(info[1].contextLabel).toBe("annotations, fulltext");
  });

  it("reflects resolution state and output", () => {
    let s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    s = resolveAll(s, ["RESOLVED TEXT"]);
    const info = placeholderInfo(s);
    expect(info[0].resolved).toBe(true);
    expect(info[0].output).toBe("RESOLVED TEXT");
  });

  it("no blocks → empty info", () => {
    const s = createComposeState("# prose only\n", { itemKey: "A", templateName: "T" });
    expect(placeholderInfo(s)).toEqual([]);
  });
});

describe("generateBlockedReason", () => {
  it("names the unresolved blocks with line and context", () => {
    const s = createComposeState(twoBlocks, { itemKey: "A", templateName: "T" });
    const reason = generateBlockedReason(s);
    expect(reason).toMatch(/2 unresolved/);
    expect(reason).toContain("abstract");
    expect(reason).toContain("annotations, fulltext");
    expect(reason).toMatch(/line \d+/);
  });

  it("singular wording for one block", () => {
    const s = createComposeState(oneBlock, { itemKey: "A", templateName: "T" });
    expect(generateBlockedReason(s)).toMatch(/1 unresolved \{% llm %\} block /);
  });
});
