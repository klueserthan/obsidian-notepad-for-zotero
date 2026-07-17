import { describe, it, expect } from "vitest";
import { mdToHtml } from "../src/md-html.js";

// Zotero-note-safe tag allowlist — the module's documented output vocabulary
// (see src/md-html.js). The Generate path must emit exactly this set and
// nothing else.
const ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "li", "blockquote",
  "a", "strong", "em", "code", "pre", "hr",
  "img", "br", "s",
  "table", "thead", "tbody", "tr", "th", "td",
]);

function tagNames(html) {
  const names = new Set();
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b/g)) names.add(m[1].toLowerCase());
  return names;
}

describe("mdToHtml — formatting constructs", () => {
  it("renders headings h1–h6", () => {
    expect(mdToHtml("# One")).toContain("<h1>One</h1>");
    expect(mdToHtml("###### Six")).toContain("<h6>Six</h6>");
  });

  it("renders bold and italic", () => {
    expect(mdToHtml("**b**")).toContain("<strong>b</strong>");
    expect(mdToHtml("*i*")).toContain("<em>i</em>");
  });

  it("renders blockquotes", () => {
    const html = mdToHtml("> quoted");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted");
  });

  it("renders unordered lists", () => {
    const html = mdToHtml("- a\n- b");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
  });

  it("renders ordered lists", () => {
    const html = mdToHtml("1. first\n2. second");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("renders links", () => {
    expect(mdToHtml("[text](https://example.com)"))
      .toContain('<a href="https://example.com">text</a>');
  });

  it("renders inline code", () => {
    expect(mdToHtml("use `code` here")).toContain("<code>code</code>");
  });

  it("renders fenced code blocks", () => {
    const html = mdToHtml("```\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>");
    expect(html).toContain("const x = 1;");
  });

  it("renders horizontal rules", () => {
    expect(mdToHtml("---")).toContain("<hr>");
  });

  it("linkifies bare URLs", () => {
    expect(mdToHtml("see https://example.com now"))
      .toContain('<a href="https://example.com">');
  });

  it("renders images", () => {
    expect(mdToHtml("![a figure](https://example.com/fig.png)"))
      .toContain('<img src="https://example.com/fig.png" alt="a figure">');
  });

  it("renders hard line breaks as <br> (soft newlines stay plain)", () => {
    expect(mdToHtml("line one  \nline two")).toContain("<br>");
    expect(mdToHtml("soft one\nsoft two")).not.toContain("<br>");
  });

  it("renders strikethrough", () => {
    expect(mdToHtml("~~gone~~")).toContain("<s>gone</s>");
  });

  it("renders GFM tables", () => {
    const html = mdToHtml("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>1</td>");
  });
});

describe("mdToHtml — safety", () => {
  it("escapes raw HTML instead of passing it through (html:false)", () => {
    const html = mdToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an inline raw <div> as text", () => {
    const html = mdToHtml("a <div class='x'>b</div> c");
    expect(html).not.toContain("<div");
    expect(html).toContain("&lt;div");
  });

  it("emits exactly the documented Zotero-note-safe tag set, nothing else", () => {
    // Kitchen sink: exercises every construct the module documents.
    const md = [
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6",
      "",
      "Para with **bold**, *italic*, `code`, ~~strike~~, a [link](https://ex.com),",
      "a hard break  ",
      "after it, and ![an image](https://ex.com/i.png).",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "1. a",
      "2. b",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```",
      "code block",
      "```",
      "",
      "---",
      "",
      "<script>bad()</script>",
    ].join("\n");
    const emitted = tagNames(mdToHtml(md));
    expect([...emitted].sort()).toEqual([...ALLOWED].sort());
  });

  it("returns '' for empty/nullish input", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml(null)).toBe("");
    expect(mdToHtml(undefined)).toBe("");
  });
});
