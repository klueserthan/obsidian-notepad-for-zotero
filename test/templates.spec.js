import { describe, it, expect } from "vitest";
import {
  parseTemplateFile, templateKind,
  frontmatterFieldValue, paperTypeDeclaration, paperTypeCandidates,
} from "../src/templates.js";
import { renderBlockBody } from "../src/blocks.js";

describe("parseTemplateFile", () => {
  it("parses a body with no directive (sep inferred)", () => {
    const t = parseTemplateFile(`- [p.{{page}}]({{link}}) "{{text}}"`);
    expect(t.defaults).toEqual({});
    expect(t.item).toBe(`- [p.{{page}}]({{link}}) "{{text}}"`);
    expect(t.sep).toBe("\n"); // single-line body → newline join
  });

  it("infers blank-line separator for a multi-line body", () => {
    const t = parseTemplateFile(`> {{text}}\n> — p.{{page}}`);
    expect(t.sep).toBe("\n\n");
  });

  it("reads a directive header and strips it from the body", () => {
    const t = parseTemplateFile(`%%! colour=yellow sync=on %%\n> {{text}}`);
    expect(t.defaults).toEqual({ colour: "yellow", sync: "on" });
    expect(t.item).toBe(`> {{text}}`);
  });

  it("normalises color→colour and honours sep=blank", () => {
    const t = parseTemplateFile(`%%! color=red sep=blank %%\n- {{text}}`);
    expect(t.defaults).toEqual({ colour: "red" });
    expect(t.sep).toBe("\n\n");
  });

  it("honours sep=newline even for a multi-line body", () => {
    const t = parseTemplateFile(`%%! sep=newline %%\n- a {{text}}\n  continued`);
    expect(t.sep).toBe("\n");
  });

  it("a parsed template renders through renderBlockBody", () => {
    const t = parseTemplateFile(`%%! colour=yellow %%\n- "{{text}}" (p.{{page}})`);
    const anns = [
      { annotatedText: "hello", pageLabel: "3", attachmentKey: "AK", pageIndex: 2, key: "K1", colourName: "yellow", sortIndex: "00001" },
      { annotatedText: "skipme", pageLabel: "4", attachmentKey: "AK", pageIndex: 3, key: "K2", colourName: "red", sortIndex: "00002" },
    ];
    // colour filter applied via the block config (not the template defaults)
    const out = renderBlockBody({ colour: "yellow", format: "t" }, anns, {
      formats: { t: { item: t.item, sep: t.sep } },
    });
    expect(out).toBe(`- "hello" (p.3) %% ann:K1 %%`); // only the yellow one, anchored (A2)
  });
});

describe("templateKind with LLM blocks", () => {
  it("classifies a template with an LLM block as document", () => {
    expect(templateKind('{% llm context="abstract" %}x{% endllm %}')).toBe("document");
  });

  it("classifies a plain per-annotation format as format", () => {
    expect(templateKind("> {{text}}")).toBe("format");
  });

  it("LLM block beats format-only body (no frontmatter, no zon)", () => {
    const t = "- {{text}}\n{% llm context=\"abstract\" %}p{% endllm %}";
    expect(templateKind(t)).toBe("document");
  });

  it("classifies a frontmatter-free highlights() template as document", () => {
    const t = '## Key passages\n{{ highlights(colour="yellow", format="quote") }}\n';
    expect(templateKind(t)).toBe("document");
  });
});

describe("frontmatterFieldValue", () => {
  it("reads a plain scalar from frontmatter", () => {
    const t = "---\npaperType: quantitative\n---\nbody";
    expect(frontmatterFieldValue(t, "paperType")).toBe("quantitative");
  });

  it("strips surrounding quotes from a quoted value", () => {
    const t = '---\npaperType: "quantitative"\n---\nbody';
    expect(frontmatterFieldValue(t, "paperType")).toBe("quantitative");
  });

  it("returns null when there is no frontmatter block", () => {
    expect(frontmatterFieldValue("no frontmatter here", "paperType")).toBeNull();
  });

  it("returns null when the frontmatter block lacks the key", () => {
    const t = "---\ntitle: Something\n---\nbody";
    expect(frontmatterFieldValue(t, "paperType")).toBeNull();
  });

  it("does not read a key that appears only in the body, after the closing fence", () => {
    const t = "---\ntitle: Something\n---\npaperType: quantitative\n";
    expect(frontmatterFieldValue(t, "paperType")).toBeNull();
  });
});

describe("paperTypeDeclaration", () => {
  it("returns label and description when both are present", () => {
    const t = "---\npaperType: quantitative\npaperTypeDescription: Empirical study with numeric data.\n---\nbody";
    expect(paperTypeDeclaration(t)).toEqual({
      label: "quantitative",
      description: "Empirical study with numeric data.",
    });
  });

  it("returns null when the label is empty or absent", () => {
    expect(paperTypeDeclaration("---\ntitle: X\n---\nbody")).toBeNull();
    expect(paperTypeDeclaration("---\npaperType:\n---\nbody")).toBeNull();
  });

  it("returns a null description when only the label is declared", () => {
    const t = "---\npaperType: quantitative\n---\nbody";
    expect(paperTypeDeclaration(t)).toEqual({ label: "quantitative", description: null });
  });
});

describe("paperTypeCandidates", () => {
  const declared = (name, label) =>
    ({ name, text: `---\npaperType: ${label}\npaperTypeDescription: desc\n---\nbody` });

  it("returns only declared document templates, in input order", () => {
    const templates = [
      declared("note-quantitative", "quantitative"),
      { name: "note", text: "**Citation:** {{bibliography}}\n%% zon kind=annotations %%\n%% /zon %%" },
      declared("note-review", "review"),
    ];
    expect(paperTypeCandidates(templates)).toEqual([
      { name: "note-quantitative", label: "quantitative", description: "desc" },
      { name: "note-review", label: "review", description: "desc" },
    ]);
  });

  it("skips a declaration on a format-kind template even though it declares a type", () => {
    const templates = [
      { name: "highlight", text: "%%! colour=yellow %%\n---\npaperType: quantitative\n---\n> {{text}}" },
    ];
    expect(paperTypeCandidates(templates)).toEqual([]);
  });
});
