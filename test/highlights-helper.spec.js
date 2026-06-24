import { describe, it, expect } from "vitest";
import { render } from "../src/render.js";
import { syncBlocks } from "../src/blocks.js";

// Annotations across three colours, as gatherAnnotations would hand them over.
const ANNS = [
  { key: "A", type: "highlight", attachmentKey: "PDF", pageLabel: "3", pageIndex: 3, sortIndex: "1", annotatedText: "blue point one", comment: "", colourName: "blue" },
  { key: "B", type: "highlight", attachmentKey: "PDF", pageLabel: "5", pageIndex: 5, sortIndex: "2", annotatedText: "yellow point", comment: "", colourName: "yellow" },
  { key: "C", type: "highlight", attachmentKey: "PDF", pageLabel: "7", pageIndex: 7, sortIndex: "3", annotatedText: "blue point two", comment: "", colourName: "blue" },
];

describe("highlights() note-template helper", () => {
  it("expands to a synced annotations block scoped to the colour", () => {
    const out = render('{{ highlights(colour="blue", format="quote") }}', {});
    expect(out).toContain("%% zon");
    expect(out).toContain("kind=annotations");
    expect(out).toContain("colour=blue");
    expect(out).toContain("format=quote");
    expect(out).toContain("sync=on");
    expect(out).toContain("%% /zon %%");
  });

  it("accepts a first positional colour and omits colour for 'all'", () => {
    expect(render('{{ highlights("red") }}', {})).toContain("colour=red");
    const all = render("{{ highlights() }}", {});
    expect(all).toContain("kind=annotations");
    expect(all).not.toContain("colour="); // no colour attr => every colour
  });

  it("supports sync=off for a frozen one-time block", () => {
    expect(render('{{ highlights(colour="green", sync="off") }}', {})).toContain("sync=off");
  });

  it("routes colours to different sections (render → syncBlocks round-trip)", () => {
    const tpl = [
      "## Blue",
      '{{ highlights(colour="blue") }}',
      "",
      "## Yellow",
      '{{ highlights(colour="yellow") }}',
    ].join("\n");

    const expanded = render(tpl, {});
    const filled = syncBlocks(expanded, ANNS, { citekey: "x" });

    // Blue section has both blue highlights, not the yellow one.
    const blueSection = filled.slice(filled.indexOf("## Blue"), filled.indexOf("## Yellow"));
    expect(blueSection).toContain("blue point one");
    expect(blueSection).toContain("blue point two");
    expect(blueSection).not.toContain("yellow point");

    // Yellow section has only the yellow highlight.
    const yellowSection = filled.slice(filled.indexOf("## Yellow"));
    expect(yellowSection).toContain("yellow point");
    expect(yellowSection).not.toContain("blue point");
  });

  it("stays idempotent and synced on a second pass", () => {
    const expanded = render('{{ highlights(colour="blue") }}', {});
    const once = syncBlocks(expanded, ANNS, { citekey: "x" });
    const twice = syncBlocks(once, ANNS, { citekey: "x" });
    expect(twice).toBe(once);
  });
});
