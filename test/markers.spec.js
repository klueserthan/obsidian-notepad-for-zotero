import { describe, it, expect } from "vitest";
import { findMarkerRanges, rangeRevealed } from "../src/markers.js";

// Every returned range must slice back to exactly the marker text — this is the
// contract editor.js relies on to place Decorations correctly.
function sliceOf(text, r) {
  return text.slice(r.from, r.to);
}

describe("findMarkerRanges", () => {
  const note = `---
Title: "x"
zon:
  Title: "\\"{{title}}\\""
  Year: "\\"{{date}}\\""
---

prose here

%% zon kind=annotations colour=all sync=on format=list %%
- [p.3](zotero://open-pdf/library/items/PDF?page=3) "a point" %% ann:ABCD %%
%% /zon %%

more prose
`;

  it("finds the open marker with parsed config, sliced exactly", () => {
    const ranges = findMarkerRanges(note);
    const open = ranges.find((r) => r.type === "block-open");
    expect(sliceOf(note, open)).toBe(
      "%% zon kind=annotations colour=all sync=on format=list %%"
    );
    expect(open.line).toBe(true);
    expect(open.config).toMatchObject({ kind: "annotations", colour: "all", sync: "on", format: "list" });
  });

  it("finds the close marker, sliced exactly", () => {
    const close = findMarkerRanges(note).find((r) => r.type === "block-close");
    expect(sliceOf(note, close)).toBe("%% /zon %%");
  });

  it("finds the inline annotation anchor with its key and a leading space", () => {
    const ann = findMarkerRanges(note).find((r) => r.type === "ann-anchor");
    expect(ann.key).toBe("ABCD");
    expect(sliceOf(note, ann)).toBe(" %% ann:ABCD %%"); // leading space included
  });

  it("finds the frontmatter zon: manifest block, sliced exactly", () => {
    const man = findMarkerRanges(note).find((r) => r.type === "frontmatter-manifest");
    expect(sliceOf(note, man)).toBe(
      `zon:\n  Title: "\\"{{title}}\\""\n  Year: "\\"{{date}}\\""`
    );
    expect(man.line).toBe(true);
  });

  it("returns ranges sorted by start offset", () => {
    const ranges = findMarkerRanges(note);
    const froms = ranges.map((r) => r.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
  });

  it("handles multiple anchors on separate lines", () => {
    const md = `%% zon kind=annotations sync=on format=list %%
- one %% ann:AAA %%
- two %% ann:BBB %%
%% /zon %%`;
    const anns = findMarkerRanges(md).filter((r) => r.type === "ann-anchor");
    expect(anns.map((r) => r.key)).toEqual(["AAA", "BBB"]);
    anns.forEach((r) => expect(sliceOf(md, r)).toContain("%% ann:"));
  });

  it("finds nothing in a plain note", () => {
    expect(findMarkerRanges("# Heading\n\njust text\n")).toEqual([]);
  });

  it("ignores a zon: only inside frontmatter, not a body line that says zon:", () => {
    const md = `body\nzon: not a manifest\n`;
    expect(findMarkerRanges(md).filter((r) => r.type === "frontmatter-manifest")).toEqual([]);
  });
});

describe("rangeRevealed", () => {
  const r = { from: 10, to: 20 };
  it("is revealed when the cursor sits inside or touches the range", () => {
    expect(rangeRevealed(r, 15)).toBe(true);
    expect(rangeRevealed(r, 10)).toBe(true);
    expect(rangeRevealed(r, 20)).toBe(true);
  });
  it("is hidden when the cursor is clear of the range", () => {
    expect(rangeRevealed(r, 5)).toBe(false);
    expect(rangeRevealed(r, 25)).toBe(false);
  });
  it("is revealed when a selection overlaps the range", () => {
    expect(rangeRevealed(r, 0, 12)).toBe(true);
    expect(rangeRevealed(r, 21, 30)).toBe(false);
  });
});
