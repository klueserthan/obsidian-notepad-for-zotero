import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "../src/render.js";
import { templateKind, paperTypeDeclaration } from "../src/templates.js";
import { stripFrontmatter } from "../src/strip-markers.js";
import { DEFAULT_FORMATS, FIELD_FORMATS } from "../src/formats.js";

// The shipped set is exactly the five paper-type note types (R1, R5): each
// declares its paper type via a leading frontmatter block.
const PAPER_TYPE_TEMPLATES = ["note-quantitative", "note-qualitative", "note-theoretical", "note-review", "note-descriptive"];

// The starter templates ship as a literal in addon/bootstrap.js (privileged
// scope, can't be imported here). Extract the BUILTIN_TEMPLATES object literal
// from the source text and validate it against the SAME engine the plugin uses,
// so a Nunjucks typo or a misclassification can't ship to every new user.
function extractBuiltins() {
  const src = readFileSync(fileURLToPath(new URL("../addon/bootstrap.js", import.meta.url)), "utf8");
  const start = src.indexOf("BUILTIN_TEMPLATES: {");
  // The next member after the object literal — a stable end anchor now that the
  // old BUILTIN_TEMPLATES_DOC sibling is gone (deleted with the file pipeline).
  const endAt = src.indexOf("async init(", start);
  expect(start).toBeGreaterThan(-1);
  expect(endAt).toBeGreaterThan(start);
  let chunk = src.slice(src.indexOf("{", start), endAt); // object + trailing comma + comment
  const objText = chunk.slice(0, chunk.lastIndexOf("}") + 1); // drop the trailing comma/comment
  // eslint-disable-next-line no-eval
  return eval("(" + objText + ")");
}

const SAMPLE = {
  citekey: "doe2020thing", title: "A Thing", date: "2020-03-01",
  creators: [{ firstName: "Jane", lastName: "Doe" }, { firstName: "John", lastName: "Smith" }],
  publicationTitle: "Journal of Things", itemType: "journalArticle",
  allTags: "alpha, beta", desktopURI: "zotero://select/library/items/ABCD1234",
  openPdf: "zotero://open-pdf/library/items/EFGH5678",
  bibliography: "Doe, J. (2020). A Thing.", abstractNote: "An abstract.",
  // annotation-block fields
  text: "highlighted text", comment: "a note", page: "12",
  link: "zotero://open-pdf/library/items/ABCD1234?page=12", colour: "yellow",
};

describe("BUILTIN_TEMPLATES (shipped starter templates)", () => {
  const builtins = extractBuiltins();

  it("ships exactly the five paper-type note types (R1, R5)", () => {
    expect(Object.keys(builtins).sort()).toEqual([...PAPER_TYPE_TEMPLATES].sort());
  });

  it("every built-in is a whole-note template", () => {
    for (const n of PAPER_TYPE_TEMPLATES) expect(templateKind(builtins[n]), n).toBe("document");
  });

  it("no built-in is or references a building block (R2, KTD12)", () => {
    const core = new Set([...Object.keys(DEFAULT_FORMATS), ...Object.keys(FIELD_FORMATS)]);
    for (const [name, text] of Object.entries(builtins)) {
      expect(text, `${name} carries a %%! directive`).not.toMatch(/^\s*%%!/m);
      expect(text, `${name} calls highlights()`).not.toMatch(/highlights\s*\(/);
      for (const m of text.matchAll(/format=([^\s%]+)/g)) {
        expect(core.has(m[1]), `${name} references non-core format ${m[1]}`).toBe(true);
      }
    }
  });

  it("a leading %%! directive forces format kind even over LLM/zon/frontmatter content", () => {
    expect(templateKind("%%! kind=section %%\n---\nfoo: bar\n---\ntext")).toBe("format");
    expect(templateKind("%%! kind=section %%\n%% zon kind=annotations %%\n%% /zon %%")).toBe("format");
  });

  it("the paper-type LLM templates carry an LLM block and the annotations block", () => {
    for (const n of PAPER_TYPE_TEMPLATES) {
      expect(builtins[n], `${n} LLM block`).toContain('{% llm context="fulltext" %}');
      expect(builtins[n], `${n} annotations block`).toContain("%% zon kind=annotations colour=all sync=on format=list %%");
    }
  });

  it("every template renders through the engine without throwing", () => {
    for (const [name, text] of Object.entries(builtins)) {
      expect(() => render(text, SAMPLE), `render ${name}`).not.toThrow();
    }
  });

  it("a note type renders item data into its body (frontmatter-free once stripped)", () => {
    const out = stripFrontmatter(render(builtins["note-review"], SAMPLE));
    expect(out).toContain("**Citation:** Doe, J. (2020). A Thing.");
    expect(out).toContain("[Open in Zotero](zotero://select/library/items/ABCD1234)");
    expect(out).toContain("[Open PDF](zotero://open-pdf/library/items/EFGH5678)");
    expect(out).toContain("> **Abstract:** An abstract.");
    expect(out).toContain("%% zon kind=annotations colour=all sync=on format=list %%");
    expect(out).not.toMatch(/^---/);
    expect(out).not.toContain("[[");
  });

  it("no builtin carries Obsidian residue (wikilinks, callouts, H1)", () => {
    for (const [name, text] of Object.entries(builtins)) {
      // The leading frontmatter block is on purpose (paperType/paperTypeDescription)
      // — checked below; stripping removes it from the note.
      expect(text, `${name} contains a wikilink`).not.toContain("[[");
      expect(text, `${name} contains an Obsidian callout`).not.toMatch(/>\s*\[!/);
      // The pipeline prepends `# Summary: <title>` — templates must not add their own H1.
      expect(text, `${name} opens with an H1`).not.toMatch(/^#\s/);
    }
  });

  it("each paper-type template declares its label and description (AE5)", () => {
    const expected = {
      "note-quantitative": "inferential",
      "note-qualitative": "qualitative",
      "note-theoretical": "theoretical",
      "note-review": "review",
      "note-descriptive": "descriptive",
    };
    for (const [name, label] of Object.entries(expected)) {
      const decl = paperTypeDeclaration(builtins[name]);
      expect(decl, `${name} declaration`).not.toBeNull();
      expect(decl.label, `${name} label`).toBe(label);
      expect(decl.description, `${name} description`).toEqual(expect.any(String));
      expect(decl.description.length, `${name} description non-empty`).toBeGreaterThan(0);
      expect(templateKind(builtins[name]), `${name} still classifies as document`).toBe("document");
    }
    const labels = Object.keys(expected).map((n) => paperTypeDeclaration(builtins[n]).label);
    expect(new Set(labels).size, "labels are distinct (R4)").toBe(labels.length);
  });

  it("the descriptive note type asks for patterns, never hypotheses or significance (R2, R3)", () => {
    const t = builtins["note-descriptive"];
    for (const heading of ["### Aim", "### Data and Measures", "### Analytic Approach", "### Main Patterns", "### Interpretation and Caveats"]) {
      expect(t, `descriptive ${heading}`).toContain(heading);
    }
    expect(t, "descriptive does not ask for hypotheses").not.toContain("### Hypotheses");
    expect(t, "descriptive does not frame findings as significance").not.toMatch(/significan/i);
  });

  it("the inferential and descriptive descriptions contrast on hypotheses (R6)", () => {
    const inferential = paperTypeDeclaration(builtins["note-quantitative"]).description;
    const descriptive = paperTypeDeclaration(builtins["note-descriptive"]).description;
    // Detection sees only label + description (src/paper-type.js buildDetectMessages),
    // so the pair has to name the separating property in opposite polarity.
    expect(inferential, "inferential names hypotheses").toMatch(/hypothes/i);
    expect(descriptive, "descriptive names hypotheses").toMatch(/hypothes/i);
    expect(descriptive, "descriptive negates them").toMatch(/without stated hypotheses/i);
    expect(inferential, "inferential does not negate them").not.toMatch(/without/i);
    // Both open the same way so neither pulls a numeric paper toward qualitative/review.
    for (const d of [inferential, descriptive]) expect(d).toMatch(/^Quantitative study/);
  });

  it("stripping frontmatter leaves no trace of the paper-type declaration (AE9)", () => {
    for (const name of PAPER_TYPE_TEMPLATES) {
      const rendered = render(builtins[name], SAMPLE);
      const stripped = stripFrontmatter(rendered);
      expect(stripped, `${name} rendered+stripped`).not.toContain("paperType");
      expect(stripped, `${name} rendered+stripped`).not.toMatch(/^---/);
    }
  });
});
