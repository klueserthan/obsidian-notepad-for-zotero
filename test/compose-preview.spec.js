import { describe, it, expect } from "vitest";
import { composePreviewHtml, llmPlaceholderHtml } from "../src/compose-preview.js";
import { mdToHtml } from "../src/md-html.js";

describe("composePreviewHtml", () => {
  it("with no LLM blocks is identical to mdToHtml", () => {
    const md = "# Title\n\nSome **bold** text.\n\n- a\n- b\n";
    expect(composePreviewHtml(md)).toBe(mdToHtml(md));
  });

  it("empty / nullish input yields empty output", () => {
    expect(composePreviewHtml("")).toBe("");
    expect(composePreviewHtml(null)).toBe("");
    expect(composePreviewHtml(undefined)).toBe("");
  });

  it("replaces an LLM block with an inert placeholder (no raw tags, no execution)", () => {
    const md =
      "## Summary\n\n" +
      '{% llm context="abstract,fulltext" %}\n' +
      "Summarise the abstract.\n" +
      "{% endllm %}\n\n" +
      "After.\n";
    const html = composePreviewHtml(md, { model: "gpt-4o-mini" });

    // Placeholder present, model + context surfaced, prompt body shown.
    expect(html).toContain('class="zon-llm-placeholder"');
    expect(html).toContain("gpt-4o-mini");
    expect(html).toContain("abstract, fulltext");
    expect(html).toContain("Summarise the abstract.");
    // The note text is HTML-escaped in output (apostrophe → &#39;).
    expect(html).toContain("Not run in preview");

    // The raw Nunjucks tags must NOT leak into the preview.
    expect(html).not.toContain("{% llm");
    expect(html).not.toContain("{% endllm");

    // Surrounding markdown still rendered as real HTML.
    expect(html).toContain("<h2>Summary</h2>");
    expect(html).toContain("<p>After.</p>");
  });

  it("handles multiple blocks and preserves the text between them", () => {
    const md =
      "{% llm context=\"abstract\" %}\nfirst\n{% endllm %}\n\n" +
      "middle prose\n\n" +
      "{% llm context=\"annotations\" %}\nsecond\n{% endllm %}\n";
    const html = composePreviewHtml(md);
    expect((html.match(/zon-llm-placeholder"/g) || []).length).toBe(2);
    expect(html).toContain("<p>middle prose</p>");
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("single-pass semantics: a list across an LLM block renders exactly as if the block were a paragraph", () => {
    const md =
      "- a\n- b\n\n" +
      '{% llm context="abstract" %}\nprompt\n{% endllm %}\n\n' +
      "- c\n- d\n";
    const html = composePreviewHtml(md);
    // Reference: the SAME document rendered in one mdToHtml pass with the LLM
    // block replaced by a plain paragraph, then that paragraph swapped for the
    // placeholder. Chunked per-span rendering could not reproduce this byte-for-byte.
    const ref = mdToHtml("- a\n- b\n\nTOK\n\n- c\n- d\n").replace(
      "<p>TOK</p>",
      llmPlaceholderHtml({ contexts: ["abstract"], body: "prompt" }),
    );
    expect(html).toBe(ref);
    // Both surrounding lists survive intact.
    expect((html.match(/<ul>/g) || []).length).toBe(2);
    expect((html.match(/<\/ul>/g) || []).length).toBe(2);
  });

  it("sentinel never leaks into the output, even when document text contains the base token", () => {
    const md =
      "ZON-LLM-PLACEHOLDER-0 is mentioned in prose.\n\n" +
      '{% llm context="abstract" %}\np\n{% endllm %}\n';
    const html = composePreviewHtml(md);
    // The prose mention survives verbatim; the block became a placeholder.
    expect(html).toContain("ZON-LLM-PLACEHOLDER-0 is mentioned in prose.");
    expect(html).toContain('class="zon-llm-placeholder"');
    // No unsubstituted (lengthened) sentinel remains.
    expect(html).not.toMatch(/ZON-LLM-PLACEHOLDER(-X)+-\d/);
  });

  it("shows a fallback when no model is configured", () => {
    const md = '{% llm context="abstract" %}\nx\n{% endllm %}\n';
    expect(composePreviewHtml(md)).toContain("(model not configured)");
    expect(composePreviewHtml(md, { model: "" })).toContain("(model not configured)");
  });
});

describe("llmPlaceholderHtml", () => {
  it("escapes model, context and prompt body", () => {
    const html = llmPlaceholderHtml(
      { contexts: ["abstract"], body: "<script>alert(1)</script> & <b>x</b>" },
      { model: "<evil>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;evil&gt;");
  });

  it("falls back to contextArg when contexts array is absent", () => {
    const html = llmPlaceholderHtml({ contextArg: 'context="fulltext"', body: "p" });
    expect(html).toContain('context="fulltext"'.replace(/"/g, "&quot;"));
  });
});
