import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../src/paths.js";

describe("sanitizeFilename", () => {
  it("keeps normal names (incl. spaces, dashes, @, citekeys)", () => {
    expect(sanitizeFilename("@doe2023")).toBe("@doe2023");
    expect(sanitizeFilename("Smith & Jones - 2020")).toBe("Smith & Jones - 2020");
  });
  it("strips path separators (prevents traversal)", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toMatch(/[\\/]/);
    expect(sanitizeFilename("a/b\\c")).toBe("a-b-c");
  });
  it("removes characters illegal on Windows/macOS and control chars", () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h')).toBe("abcdefgh");
    expect(sanitizeFilename("a\tb\nc")).toBe("abc"); // tab + newline are control chars
  });
  it("never returns empty", () => {
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename("...")).toBe("untitled");
    expect(sanitizeFilename(null)).toBe("untitled");
  });
});
