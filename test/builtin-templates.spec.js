import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "../src/render.js";
import { templateKind, parseTemplateFile } from "../src/templates.js";

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

  it("ships exactly the expected set", () => {
    expect(Object.keys(builtins).sort()).toEqual(
      [
        "abstract",
        "critique",
        "highlight",
        "key-quote",
        "note",
        "note-by-colour",
        "note-minimal",
        "research-questions",
        "snapshot",
      ]
    );
  });

  it("classifies note scaffolds as documents and the rest as formats", () => {
    expect(templateKind(builtins["note"])).toBe("document");
    expect(templateKind(builtins["note-minimal"])).toBe("document");
    expect(templateKind(builtins["note-by-colour"])).toBe("document");
    expect(templateKind(builtins["research-questions"])).toBe("document");
    for (const n of ["abstract", "critique", "key-quote", "highlight", "snapshot"]) {
      expect(templateKind(builtins[n])).toBe("format");
    }
  });

  it("research-questions ships the exact heading, context, and prompt", () => {
    expect(builtins["research-questions"]).toBe(
      `## Research Questions

{% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}
`
    );
  });

  it("every template renders through the engine without throwing", () => {
    for (const [name, text] of Object.entries(builtins)) {
      const body = templateKind(text) === "document" ? text : parseTemplateFile(text).item;
      expect(() => render(body, SAMPLE), `render ${name}`).not.toThrow();
    }
  });

  it("the note scaffold renders item data into its body (frontmatter-free)", () => {
    const out = render(builtins["note"], SAMPLE);
    expect(out).toContain("**Citation:** Doe, J. (2020). A Thing.");
    expect(out).toContain("[Open in Zotero](zotero://select/library/items/ABCD1234)");
    expect(out).toContain("[Open PDF](zotero://open-pdf/library/items/EFGH5678)");
    expect(out).toContain("> **Abstract:** An abstract.");
    expect(out).toContain("%% zon kind=annotations colour=all sync=on format=list %%");
    expect(out).not.toMatch(/^---/);
    expect(out).not.toContain("[[");
  });

  it("no builtin carries Obsidian residue (frontmatter, wikilinks, callouts, H1)", () => {
    for (const [name, text] of Object.entries(builtins)) {
      expect(text, `${name} starts with a frontmatter fence`).not.toMatch(/^---\r?\n/);
      expect(text, `${name} contains a wikilink`).not.toContain("[[");
      expect(text, `${name} contains an Obsidian callout`).not.toMatch(/>\s*\[!/);
      // The pipeline prepends `# Summary: <title>` — templates must not add their own H1.
      expect(text, `${name} opens with an H1`).not.toMatch(/^#\s/);
    }
  });
});
