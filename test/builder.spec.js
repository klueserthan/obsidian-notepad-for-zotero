import { describe, it, expect } from "vitest";
import {
  previewTemplate, stripForPreview, SAMPLE_ITEM, SAMPLE_ANNOTATIONS,
  INSERT_SNIPPETS, NEW_NOTE_TYPE_SCAFFOLD,
} from "../src/builder.js";
import { composeFormat } from "../src/formats.js";
import { renderBlockBody } from "../src/blocks.js";
import { composePreviewHtml } from "../src/compose-preview.js";

const ctx = { itemData: SAMPLE_ITEM, annotations: SAMPLE_ANNOTATIONS, citekey: SAMPLE_ITEM.citekey };

// A whole-note template: frontmatter, prose, and an annotations block.
const NOTE = `---
Title: "{{title}}"
---

## Notes

## Highlights

%% zon kind=annotations colour=all sync=on format=quote %%
%% /zon %%
`;

describe("previewTemplate — whole-note rendering", () => {
  it("renders against item data and fills its block", () => {
    const out = previewTemplate(NOTE, ctx);
    expect(out.error).toBeFalsy();
    expect(out.raw).toContain('Title: "A Worked Example of Coproduction in Practice"');
    expect(out.raw).toContain("## Notes");
    expect(out.raw).toContain("Coproduction reshapes"); // the all-colour block filled
  });

  it("renders a body with no frontmatter or blocks once, as a whole note (not per highlight)", () => {
    const out = previewTemplate("## About\n\n{{title}}", ctx);
    expect(out.error).toBeFalsy();
    expect(out.preview.match(/A Worked Example of Coproduction in Practice/g)).toHaveLength(1);
    expect(out.raw).not.toContain("%%");
  });
});

describe("previewTemplate — robustness", () => {
  it("never throws on a broken template; returns the error as preview text", () => {
    const out = previewTemplate("{{ oops(", ctx);
    expect(out.error).toBe(true);
    expect(out.preview).toContain("Template error");
  });
  it("works with no annotations and no item (empty ctx)", () => {
    const out = previewTemplate("## Notes\n\n{{title}}", {});
    expect(out.error).toBeFalsy();
    expect(typeof out.raw).toBe("string");
  });
});

describe("stripForPreview — Composer-consistent Builder preview", () => {
  it("drops leading frontmatter AND block markers/anchors", () => {
    const raw = [
      "---",
      'Title: "A Paper"',
      "citekey: doe2023",
      "---",
      "",
      "## Highlights",
      "",
      "%% zon kind=annotations colour=all sync=on format=quote %%",
      "> a quote %% ann:AAA1 %%",
      "%% /zon %%",
    ].join("\n");
    const out = stripForPreview(raw);
    expect(out).not.toContain("%%");        // no delimiters/anchors
    expect(out).not.toContain("---");       // no frontmatter fence
    expect(out).not.toContain("Title:");    // frontmatter body gone
    expect(out).toContain("## Highlights"); // prose survives
    expect(out).toContain("> a quote");     // rendered content survives
    expect(out).not.toMatch(/\n{3,}/);      // gaps collapsed
  });

  it("is idempotent on already-stripped, marker-free markdown", () => {
    const clean = "## Notes\n\n> already clean";
    expect(stripForPreview(clean)).toBe(clean);
    expect(stripForPreview(stripForPreview(clean))).toBe(clean);
  });

  it("leaves a {% llm %} block as literal text (never executed in preview)", () => {
    const raw = "## Summary\n\n{% llm context=\"abstract\" %}\nSummarise this.\n{% endllm %}";
    const out = stripForPreview(raw);
    expect(out).toContain("{% llm context=\"abstract\" %}");
    expect(out).toContain("Summarise this.");
  });

  it("previewTemplate.preview is the stripped view (no frontmatter, no markers)", () => {
    const out = previewTemplate(NOTE, ctx);
    expect(out.error).toBeFalsy();
    expect(out.raw).toContain("---");            // raw keeps the frontmatter
    expect(out.preview).not.toContain("---");    // preview strips it
    expect(out.preview).not.toContain("%%");     // and the block markers
    expect(out.preview).toContain("## Notes");   // prose survives
    expect(out.preview).toContain("Coproduction reshapes"); // filled block survives
  });
});

describe("annotation-block render engine (dormant, KTD12)", () => {
  it("composeFormat builds a body from style + parts (the 'advanced' mode)", () => {
    // quote with only the page link
    const f1 = composeFormat("quote", ["page"]);
    const b1 = renderBlockBody({ colour: "all", style: "quote", parts: "page" }, SAMPLE_ANNOTATIONS, {});
    expect(b1).toContain("> Coproduction reshapes");
    expect(b1).toContain("[p.3]"); // page on
    expect(b1).not.toContain("#finding"); // tags off
    // list with page+comment+tags
    const b2 = renderBlockBody({ colour: "all", style: "list", parts: "page,comment,tags" }, SAMPLE_ANNOTATIONS, {});
    expect(b2).toContain("#finding #method");
    expect(b2).toContain("— *core claim*");
  });

  it("composeFormat comment-first leads with the comment in every style", () => {
    for (const style of ["list", "quote", "callout"]) {
      const f = composeFormat(style, ["page", "comment"], true);
      // The comment template segment must precede the highlight text segment.
      const iComment = f.item.indexOf("{{comment}}");
      const iText = f.item.indexOf("{{text}}");
      expect(iComment, style).toBeGreaterThan(-1);
      expect(iComment, style).toBeLessThan(iText);
    }
    // No-op when the comment part isn't included.
    const noComment = composeFormat("quote", ["page"], true);
    expect(noComment.item).toBe(composeFormat("quote", ["page"], false).item);
  });

  it("order=comment-first renders the comment above the quote", () => {
    const body = renderBlockBody(
      { colour: "all", style: "quote", parts: "comment,page", order: "comment-first" },
      SAMPLE_ANNOTATIONS, {});
    // SAMP0001: comment "core claim" should appear before its quoted text.
    expect(body.indexOf("core claim")).toBeLessThan(body.indexOf("Coproduction reshapes"));
  });

  it("composed formats handle IMAGE annotations (embed, not empty quotes)", () => {
    const IMG = [{ key: "IM", type: "image", attachmentKey: "PDF", pageLabel: "2", pageIndex: 1, sortIndex: "1", annotatedText: "", colourName: "yellow", imageBaseName: "doe-p2-IM.png" }];
    for (const style of ["list", "quote", "callout"]) {
      const body = renderBlockBody({ colour: "all", style: style, parts: "page" }, IMG, { citekey: "doe", attachmentFolder: "Refs" });
      expect(body, style).toContain("![[Refs/doe/doe-p2-IM.png]]");
      expect(body, style).not.toContain('""'); // no empty-text artefact
    }
  });

  it("a block renders via style+parts even with no named format available", () => {
    const body = renderBlockBody({ colour: "all", style: "callout", parts: "comment" }, SAMPLE_ANNOTATIONS, {});
    expect(body).toContain("> [!quote]");
    expect(body).toContain("Coproduction reshapes");
  });

  it("the colour filter accepts a comma list (OR)", () => {
    const body = renderBlockBody({ colour: "yellow,blue", format: "list" }, SAMPLE_ANNOTATIONS, {});
    expect(body).toContain("Coproduction reshapes");      // yellow
    expect(body).toContain("a clean, quotable sentence");  // blue
  });

  it("comment=yes keeps only highlights that have a comment", () => {
    const body = renderBlockBody({ colour: "all", comment: "yes", format: "list" }, SAMPLE_ANNOTATIONS, {});
    expect(body).toContain("Coproduction reshapes");          // SAMP0001 has "core claim"
    expect(body).not.toContain("a clean, quotable sentence");  // SAMP0002 comment is ""
  });

  it("the comment-first format foregrounds the comment", () => {
    const ctx2 = { itemData: SAMPLE_ITEM, annotations: SAMPLE_ANNOTATIONS, citekey: SAMPLE_ITEM.citekey };
    const out = previewTemplate('%% zon kind=annotations colour=all format=comment-first sync=on %%\n%% /zon %%', ctx2);
    expect(out.error).toBeFalsy();
    expect(out.raw).toContain("core claim"); // the comment, leading its block
  });
});

describe("note-type editor: Insert menu snippets and New scaffold (R12, R13)", () => {
  it("has exactly the four required snippets: LLM prompt, annotations, citation, abstract", () => {
    const ids = INSERT_SNIPPETS.map((s) => s.id);
    expect(ids).toEqual(["llm", "annotations", "citation", "abstract"]);
    for (const s of INSERT_SNIPPETS) { expect(s.label).toBeTruthy(); expect(s.text.length).toBeGreaterThan(0); }
  });

  it("every Insert snippet renders through previewTemplate without a template error", () => {
    for (const s of INSERT_SNIPPETS) {
      const out = previewTemplate(s.text, ctx);
      expect(out.error, s.id + ": " + out.raw).toBeFalsy();
    }
  });

  it("the LLM snippet previews as an inert placeholder in the editor's HTML preview (KTD11)", () => {
    const llm = INSERT_SNIPPETS.find((s) => s.id === "llm");
    const html = composePreviewHtml(previewTemplate(llm.text, ctx).preview);
    expect(html).toContain('data-zon-llm="1"');
    expect(html).toContain("Write the prompt here.");
    expect(html).not.toContain("{% llm");
  });

  it("the Abstract snippet renders without Obsidian callout syntax (Zotero notes don't render callouts)", () => {
    const abs = INSERT_SNIPPETS.find((s) => s.id === "abstract");
    const html = composePreviewHtml(previewTemplate(abs.text, ctx).preview);
    expect(html).toContain("Abstract:");
    expect(html).not.toContain("[!abstract]");
  });

  it("the New scaffold has no frontmatter (paper type lives in the editor's own fields) and renders", () => {
    expect(NEW_NOTE_TYPE_SCAFFOLD).not.toMatch(/^---/);
    const out = previewTemplate(NEW_NOTE_TYPE_SCAFFOLD, ctx);
    expect(out.error).toBeFalsy();
  });
});
