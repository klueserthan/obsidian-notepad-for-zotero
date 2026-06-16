import { describe, it, expect } from "vitest";
import { frontmatterList, cleanTag, tagSyncPlan } from "../src/tagsync.js";
import { getTagField, setTagField, applyManifest } from "../src/manifest.js";

const NOTE = `---
Title: "A Thing"
Tags:
  - Reference
  - journalArticle
Topics:

- "[[Human rights]]"

- "[[prison]]"
- "#monitoring"
ZoteroLink: "zotero://x"
---

Body here.
`;

describe("frontmatterList", () => {
  it("reads a flush-left block list with blank lines, stopping at the next key", () => {
    expect(frontmatterList(NOTE, "Topics")).toEqual(['"[[Human rights]]"', '"[[prison]]"', '"#monitoring"']);
  });
  it("reads an indented block list", () => {
    expect(frontmatterList(NOTE, "Tags")).toEqual(["Reference", "journalArticle"]);
  });
  it("reads a flow list and a comma scalar", () => {
    expect(frontmatterList('---\nT: ["a", "b"]\n---\n', "T")).toEqual(['"a"', '"b"']);
    expect(frontmatterList("---\nT: a, b, c\n---\n", "T")).toEqual(["a", "b", "c"]);
  });
  it("returns [] for an absent field or no frontmatter", () => {
    expect(frontmatterList(NOTE, "Nope")).toEqual([]);
    expect(frontmatterList("no frontmatter", "Topics")).toEqual([]);
  });
});

describe("cleanTag", () => {
  it("strips quotes, [[wikilinks]] (target before |alias), and leading #", () => {
    expect(cleanTag('"[[Human rights]]"')).toBe("Human rights");
    expect(cleanTag("[[target|alias]]")).toBe("target");
    expect(cleanTag('"#monitoring"')).toBe("monitoring");
    expect(cleanTag("plain")).toBe("plain");
  });
});

describe("tagSyncPlan", () => {
  it("adds note-only tags and removes removable item-only tags", () => {
    const plan = tagSyncPlan(["a", "b", "c"], ["b", "x"], ["b", "x"]);
    expect(plan.add).toEqual(["a", "c"]);
    expect(plan.remove).toEqual(["x"]);
    expect(plan.changed).toBe(true);
  });
  it("never removes a non-removable (e.g. automatic) item tag", () => {
    const plan = tagSyncPlan(["a"], ["a", "auto"], []); // removable = [] → auto kept
    expect(plan.remove).toEqual([]);
  });
  it("reports no change when sets match", () => {
    expect(tagSyncPlan(["a", "b"], ["b", "a"]).changed).toBe(false);
  });
});

describe("note-specific tag field-map (zon: tags:)", () => {
  it("round-trips through setTagField / getTagField", () => {
    expect(getTagField(NOTE)).toBe(null);
    const mapped = setTagField(NOTE, "Topics");
    expect(getTagField(mapped)).toBe("Topics");
  });
  it("the tags map is NOT applied as a forward field expression", () => {
    const mapped = setTagField("---\nTitle: \"X\"\nzon:\n  Title: \"\\\"{{title}}\\\"\"\n---\nbody\n", "Topics");
    // applyManifest must ignore the reserved `tags` key (no `tags` field rendered)
    const out = applyManifest(mapped, { title: "New" });
    expect(out).toContain('Title: "New"');
    expect(out).not.toContain("tags: Topics"); // stays quoted in the manifest, never a field
    expect(getTagField(out)).toBe("Topics");
  });
});
