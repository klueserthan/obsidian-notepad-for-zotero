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
