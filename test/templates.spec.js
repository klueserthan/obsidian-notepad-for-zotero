import { describe, it, expect } from "vitest";
import {
  parseTemplateFile, templateKind,
  frontmatterFieldValue, paperTypeDeclaration, paperTypeCandidates,
  splitDeclaration, composeDeclaration,
  validateTemplateName, findLabelClash, duplicateLabels,
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

describe("frontmatter declarations with CRLF line endings", () => {
  it("reads a paperType that is not the last field when lines end in \\r\\n", () => {
    const text = "---\r\npaperType: qualitative\r\npaperTypeDescription: Interview study\r\n---\r\n# Body\r\n";
    expect(frontmatterFieldValue(text, "paperType")).toBe("qualitative");
    expect(paperTypeDeclaration(text)).toEqual({ label: "qualitative", description: "Interview study" });
    expect(paperTypeCandidates([{ name: "crlf", text }])).toEqual([{ name: "crlf", label: "qualitative", description: "Interview study" }]);
  });
});

describe("splitDeclaration / composeDeclaration (KTD7)", () => {
  it("splitting then composing a template with a declaration and another key returns the original text", () => {
    const original = "---\nother: value\npaperType: quantitative\npaperTypeDescription: Empirical study\n---\nBody content\n";
    const { label, description, body } = splitDeclaration(original);
    expect(label).toBe("quantitative");
    expect(description).toBe("Empirical study");
    expect(paperTypeDeclaration(body)).toBeNull(); // declaration lifted out of the body
    expect(body).toContain("other: value");
    expect(composeDeclaration(body, label, description)).toBe(original);
  });

  it("composing onto a body with no frontmatter adds a block that paperTypeDeclaration reads back", () => {
    const out = composeDeclaration("Just body text\n", "review", "Surveys existing literature");
    expect(paperTypeDeclaration(out)).toEqual({ label: "review", description: "Surveys existing literature" });
    expect(out).toContain("Just body text");
  });

  it("refuses an empty label", () => {
    expect(composeDeclaration("body", "", "desc")).toBeNull();
    expect(composeDeclaration("body", "   ", "desc")).toBeNull();
  });

  it("refuses a description containing a newline", () => {
    expect(composeDeclaration("body", "review", "line one\nline two")).toBeNull();
  });

  it("splitting a template with no frontmatter returns empty fields and the whole body", () => {
    const text = "## Notes\nno frontmatter here\n";
    expect(splitDeclaration(text)).toEqual({ label: "", description: "", body: text });
  });
});

describe("validateTemplateName (KTD9)", () => {
  it("refuses an empty name", () => {
    expect(validateTemplateName("", []).valid).toBe(false);
    expect(validateTemplateName("   ", []).valid).toBe(false);
  });

  it("refuses reserved names, case-insensitively", () => {
    expect(validateTemplateName("archive", []).valid).toBe(false);
    expect(validateTemplateName("README", []).valid).toBe(false);
    expect(validateTemplateName("Templates", []).valid).toBe(false);
  });

  it("refuses a name that differs from an existing one only in case", () => {
    const r = validateTemplateName("Note-Quantitative", ["note-quantitative"]);
    expect(r.valid).toBe(false);
  });

  it("accepts a well-formed new name and strips path separators", () => {
    expect(validateTemplateName("note-mixed-methods", ["note-review"])).toEqual({ valid: true, name: "note-mixed-methods" });
    expect(validateTemplateName("a/b\\c", []).name).toBe("abc");
  });
});

describe("findLabelClash (KTD9, KTD13)", () => {
  const templates = [{ name: "note-qualitative", text: "---\npaperType: qualitative\n---\nbody" }];

  it("'Qualitative ' conflicts with 'qualitative' on another note type", () => {
    expect(findLabelClash("Qualitative ", templates, "note-new")).toBe("note-qualitative");
  });

  it("does not conflict with the note type being edited", () => {
    expect(findLabelClash("qualitative", templates, "note-qualitative")).toBeNull();
  });
});

describe("paperTypeCandidates / duplicateLabels exclude repeated labels (KTD13)", () => {
  const declared = (name, label) => ({ name, text: `---\npaperType: ${label}\n---\nbody` });

  it("two templates declaring the same label are both excluded from candidates and reported as duplicates", () => {
    const templates = [declared("note-review-a", "review"), declared("note-review-b", "review"), declared("note-quant", "quantitative")];
    expect(paperTypeCandidates(templates)).toEqual([{ name: "note-quant", label: "quantitative", description: null }]);
    const dups = duplicateLabels(templates);
    expect(dups.get("review")).toEqual(["note-review-a", "note-review-b"]);
    expect(dups.has("quantitative")).toBe(false);
  });
});
