import { describe, it, expect } from "vitest";
import { summaryNoteStaleness } from "../src/staleness.js";

describe("summaryNoteStaleness", () => {
  it("is no-note when there are no Summary Notes at all", () => {
    expect(summaryNoteStaleness([], [])).toBe("no-note");
    expect(summaryNoteStaleness([], [{ dateModified: "2024-06-01" }])).toBe("no-note");
  });

  it("is fresh when there are no annotations, regardless of note age", () => {
    expect(summaryNoteStaleness([{ dateAdded: "2020-01-01" }], [])).toBe("fresh");
  });

  it("is fresh when the newest note is newer than every annotation", () => {
    const notes = [{ dateAdded: "2024-06-10" }];
    const anns = [{ dateModified: "2024-06-01" }, { dateModified: "2024-06-05" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("fresh");
  });

  it("is stale when an annotation is newer than the newest note", () => {
    const notes = [{ dateAdded: "2024-06-01" }];
    const anns = [{ dateModified: "2024-06-01" }, { dateModified: "2024-06-10" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("stale");
  });

  it("compares against the NEWEST note when several exist", () => {
    const notes = [{ dateAdded: "2024-01-01" }, { dateAdded: "2024-06-15" }];
    // Newer than the oldest note but older than the newest -> fresh.
    const anns = [{ dateModified: "2024-03-01" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("fresh");
  });

  it("compares against the NEWEST annotation when several exist", () => {
    const notes = [{ dateAdded: "2024-06-01" }];
    // Oldest annotation predates the note, newest postdates it -> stale.
    const anns = [{ dateModified: "2024-01-01" }, { dateModified: "2024-07-01" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("stale");
  });

  it("treats an exact tie as fresh, not stale", () => {
    const notes = [{ dateAdded: "2024-06-01T12:00:00Z" }];
    const anns = [{ dateModified: "2024-06-01T12:00:00Z" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("fresh");
  });

  it("accepts Date instances as well as strings", () => {
    const notes = [{ dateAdded: new Date("2024-06-01") }];
    const anns = [{ dateModified: new Date("2024-06-10") }];
    expect(summaryNoteStaleness(notes, anns)).toBe("stale");
  });

  it("ignores unparseable annotation dates rather than reporting stale", () => {
    const notes = [{ dateAdded: "2024-06-01" }];
    const anns = [{ dateModified: "not-a-date" }, { dateModified: undefined }];
    expect(summaryNoteStaleness(notes, anns)).toBe("fresh");
  });

  it("treats an unparseable note date as infinitely old (conservatively stale)", () => {
    const notes = [{ dateAdded: "not-a-date" }];
    const anns = [{ dateModified: "2024-06-01" }];
    expect(summaryNoteStaleness(notes, anns)).toBe("stale");
  });

  it("is defensive against non-array inputs", () => {
    expect(summaryNoteStaleness(null, null)).toBe("no-note");
    expect(summaryNoteStaleness(undefined, undefined)).toBe("no-note");
  });
});
