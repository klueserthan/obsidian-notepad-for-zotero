import { describe, it, expect } from "vitest";
import { mdToHtml } from "../src/md-html.js";

// Zotero-note-safe tag allowlist (what the Generate path is expected to emit).
const ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "li", "blockquote",
  "a", "strong", "em", "code", "pre", "hr",
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

  it("emits no tags outside the Zotero-note-safe allowlist", () => {
    const md = [
      "# Title",
      "",
      "Para with **bold**, *italic*, `code`, and a [link](https://ex.com).",
      "",
      "> a quote",
      "",
      "- one",
      "- two",
      "",
      "1. a",
      "2. b",
      "",
      "```",
      "code block",
      "```",
      "",
      "---",
      "",
      "<script>bad()</script>",
    ].join("\n");
    const html = mdToHtml(md);
    for (const name of tagNames(html)) {
      expect(ALLOWED.has(name), `unexpected tag <${name}>`).toBe(true);
    }
  });

  it("returns '' for empty/nullish input", () => {
    expect(mdToHtml("")).toBe("");
    expect(mdToHtml(null)).toBe("");
    expect(mdToHtml(undefined)).toBe("");
  });
});
