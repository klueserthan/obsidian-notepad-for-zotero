import { describe, it, expect } from "vitest";
import { resolveNoteFilename } from "../src/filename.js";

// Minimal buildItemData-shaped object.
const DATA = {
  citekey: "aitken2021",
  title: "Investigating prison suicides",
  date: "2021-03-15",
  publicationTitle: "Punishment & Society",
  creators: [{ firstName: "Dominic", lastName: "Aitken" }],
};

describe("resolveNoteFilename", () => {
  it("renders the default @{{citekey}}.md pattern", () => {
    expect(resolveNoteFilename("@{{citekey}}.md", DATA, "aitken2021")).toBe("@aitken2021.md");
  });

  it("renders a multi-field pattern (author/year/title)", () => {
    expect(resolveNoteFilename("{{author}} {{year}} - {{title}}.md", DATA, "aitken2021"))
      .toBe("Aitken 2021 - Investigating prison suicides.md");
  });

  it("appends .md when the pattern omits it", () => {
    expect(resolveNoteFilename("@{{citekey}}", DATA, "aitken2021")).toBe("@aitken2021.md");
  });

  it("supports a suffix (the lit-note vs wiki-page case)", () => {
    expect(resolveNoteFilename("@{{citekey}} (litnote).md", DATA, "aitken2021"))
      .toBe("@aitken2021 (litnote).md");
  });

  it("strips characters illegal in filenames (from rendered fields)", () => {
    const d = { ...DATA, title: "Law: Policy/Practice" };
    // ':' removed, '/' -> '-'
    expect(resolveNoteFilename("{{title}}.md", d, "x")).toBe("Law Policy-Practice.md");
  });

  it("sanitises the citekey too", () => {
    expect(resolveNoteFilename("@{{citekey}}.md", DATA, "a/b:c")).toBe("@a-bc.md");
  });

  it("falls back to @<citekey>.md when the pattern renders empty", () => {
    expect(resolveNoteFilename("", DATA, "aitken2021")).toBe("@aitken2021.md");
  });

  it("falls back to note.md when there's no pattern and no citekey", () => {
    expect(resolveNoteFilename("", { ...DATA, citekey: "" }, "")).toBe("@note.md");
  });
});
