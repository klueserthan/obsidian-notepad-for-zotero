import { describe, it, expect } from "vitest";
import { stripMarkers, stripFrontmatter } from "../src/strip-markers.js";

describe("stripMarkers — delimiter lines", () => {
  it("removes an open/close annotations block, keeping the body", () => {
    const md = [
      "## Annotations",
      "%% zon kind=annotations colour=all sync=on format=list %%",
      '- [p.3](x) "yellow point"',
      "%% /zon %%",
    ].join("\n");
    expect(stripMarkers(md)).toBe('## Annotations\n- [p.3](x) "yellow point"');
  });

  it("handles all config variants (sync/format/colour/type/tag/bare flags)", () => {
    for (const open of [
      "%% zon kind=annotations colour=yellow type=highlight sync=on format=quote %%",
      "%% zon kind=annotations colour=yellow,blue sync=off format=list %%",
      "%% zon kind=field var=publisher %%",
      "%%   zon   colour=all   %%",
      "  %% zon sync=on %%",
    ]) {
      const md = `before\n${open}\nbody\n%% /zon %%\nafter`;
      expect(stripMarkers(md)).toBe("before\nbody\nafter");
    }
  });

  it("removes close delimiter variants", () => {
    for (const close of ["%% /zon %%", "  %% /zon %%  ", "%%/zon%%"]) {
      const md = `%% zon colour=all %%\nx\n${close}`;
      expect(stripMarkers(md)).toBe("x");
    }
  });

  it("drops delimiter lines whole — no blank-line debris beyond the source", () => {
    const md = "a\n\n%% zon colour=all %%\nb\n%% /zon %%\n\nc";
    // The two blank lines present in the source survive; none are added.
    expect(stripMarkers(md)).toBe("a\n\nb\n\nc");
  });
});

describe("stripMarkers — inline anchors", () => {
  it("removes an %% ann:KEY %% anchor and its leading separator space", () => {
    const md = '> some quoted text %% ann:ABCD1234 %%';
    expect(stripMarkers(md)).toBe("> some quoted text");
  });

  it("removes multiple anchors across lines, leaving prose byte-identical", () => {
    const md = [
      "%% zon colour=all sync=on format=list %%",
      '- one %% ann:AAAA %%',
      '- two %% ann:BBBB %%',
      "%% /zon %%",
    ].join("\n");
    expect(stripMarkers(md)).toBe("- one\n- two");
  });

  it("handles a bare anchor with no preceding content", () => {
    expect(stripMarkers("%% ann:ZZ99 %%")).toBe("");
  });
});

describe("stripMarkers — surroundings & idempotency", () => {
  const clean = [
    "# Title",
    "",
    "Some **prose** with a 90% figure and a `%%` literal in code.",
    "",
    "> a blockquote",
    "",
    "- list item",
  ].join("\n");

  it("is a no-op on already-clean input (byte-identical)", () => {
    expect(stripMarkers(clean)).toBe(clean);
  });

  it("leaves a stray '90%' and code-fenced text untouched", () => {
    // Lone percent signs and inline code are not delimiters.
    expect(stripMarkers("progress is 90% done")).toBe("progress is 90% done");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const md = [
      "intro",
      "%% zon colour=all sync=on %%",
      '> x %% ann:KEY1 %%',
      "%% /zon %%",
      "outro",
    ].join("\n");
    const once = stripMarkers(md);
    expect(stripMarkers(once)).toBe(once);
    expect(once).toBe("intro\n> x\noutro");
  });

  it("preserves CRLF line endings on surrounding content", () => {
    const md = "a\r\n%% zon colour=all %%\r\nbody\r\n%% /zon %%\r\nb";
    expect(stripMarkers(md)).toBe("a\r\nbody\r\nb");
  });

  it("returns '' for nullish input", () => {
    expect(stripMarkers(null)).toBe("");
    expect(stripMarkers(undefined)).toBe("");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block (incl. the reserved zon: block)", () => {
    const md = [
      "---",
      'citekey: "smith2020"',
      "Title: \"A paper\"",
      "zon:",
      "  Title: \"x\"",
      "---",
      "",
      "**Citation:** ...",
    ].join("\n");
    expect(stripFrontmatter(md)).toBe("**Citation:** ...");
  });

  it("is a no-op when there is no frontmatter", () => {
    const md = "# Heading\n\nbody";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("does not treat a mid-document '---' as frontmatter", () => {
    const md = "intro\n\n---\n\nmore";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("leaves body content byte-identical after the closing fence", () => {
    const md = "---\na: 1\n---\n## Notes\n\ntext";
    expect(stripFrontmatter(md)).toBe("## Notes\n\ntext");
  });
});
