import { describe, it, expect } from "vitest";
import {
  parseManifest,
  hasManifest,
  applyManifest,
  setManifestEntry,
  removeManifestEntry,
  buildManifestFromScaffold,
  writeManifest,
  getAttachmentFolder,
  setAttachmentFolder,
} from "../src/manifest.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ITEM = {
  citekey: "doe2020",
  title: "A New Title",
  date: "2020-05-01",
  publicationTitle: "Journal of Things",
  desktopURI: "zotero://select/library/items/ABCD1234",
  allTags: "policing, accountability",
  creators: [{ firstName: "Jane", lastName: "Doe" }],
  itemType: "journalArticle",
};

const NOTE = `---
citekey: "old"
Title: "Old title"
Year: "1999"
KeyIdea: my own idea
zon:
  Title: "\\"{{title}}\\""
  Year: "\\"{{date | format('YYYY')}}\\""
---

## Notes
my prose
`;

describe("parseManifest", () => {
  it("reads the zon: map into key -> expression", () => {
    const { entries, present } = parseManifest(NOTE);
    expect(present).toBe(true);
    expect(entries.map((e) => e.key)).toEqual(["Title", "Year"]);
    expect(entries[0].expr).toBe(`"{{title}}"`);
    expect(entries[1].expr).toBe(`"{{date | format('YYYY')}}"`);
  });

  it("reports absent when there is no zon: map", () => {
    expect(hasManifest(`---\nTitle: "x"\n---\nbody`)).toBe(false);
    expect(hasManifest(`no frontmatter at all`)).toBe(false);
  });
});

describe("applyManifest", () => {
  it("refreshes managed keys, leaves everything else untouched", () => {
    const out = applyManifest(NOTE, ITEM);
    expect(out).toContain(`Title: "A New Title"`);
    expect(out).toContain(`Year: "2020"`);
    expect(out).toContain("KeyIdea: my own idea"); // unmanaged user key kept
    expect(out).toContain("my prose"); // body untouched
    expect(out).toContain("zon:"); // manifest preserved
  });

  it("is idempotent", () => {
    const once = applyManifest(NOTE, ITEM);
    const twice = applyManifest(once, ITEM);
    expect(twice).toBe(once);
  });

  it("is a no-op when the note has no manifest", () => {
    const plain = `---\nTitle: "x"\n---\nbody\n`;
    expect(applyManifest(plain, ITEM)).toBe(plain);
  });

  it("leaves a key untouched if its expression throws", () => {
    const bad = setManifestEntry(`---\nTitle: "x"\n---\nb\n`, "Title", "{{ oops( }}");
    const out = applyManifest(bad, ITEM);
    expect(out).toContain(`Title: "x"`); // unchanged, not blown up
  });
});

describe("setManifestEntry / removeManifestEntry", () => {
  it("adds a managed key, creating the map if absent", () => {
    const md = `---\nTitle: "x"\n---\nbody\n`;
    const out = setManifestEntry(md, "Title", `"{{title}}"`);
    expect(hasManifest(out)).toBe(true);
    expect(applyManifest(out, ITEM)).toContain(`Title: "A New Title"`);
  });

  it("replaces an existing entry rather than duplicating it", () => {
    let out = setManifestEntry(NOTE, "Year", `"changed"`);
    out = setManifestEntry(out, "Year", `"{{date | format('YYYY')}}"`);
    const { entries } = parseManifest(out);
    expect(entries.filter((e) => e.key === "Year").length).toBe(1);
  });

  it("removes a key and drops an empty map", () => {
    const one = removeManifestEntry(NOTE, "Title");
    expect(parseManifest(one).entries.map((e) => e.key)).toEqual(["Year"]);
    const none = removeManifestEntry(one, "Year");
    expect(hasManifest(none)).toBe(false);
    expect(none).toContain("KeyIdea: my own idea"); // other frontmatter intact
  });
});

describe("buildManifestFromScaffold", () => {
  const scaffold = readFileSync(
    fileURLToPath(new URL("./fixtures/note-scaffold.md", import.meta.url)),
    "utf8"
  );

  it("manages every template-bearing field, single-line OR multi-line", () => {
    const map = buildManifestFromScaffold(scaffold);
    // Fully template-driven: whatever the scaffold templates, gets managed —
    // including the multi-line Author/Topics/Tags lists.
    expect(Object.keys(map).sort()).toEqual(
      ["Author", "Journal", "Tags", "Title", "Topics", "Year", "ZoteroLink", "citekey"].sort()
    );
  });

  it("leaves a static/empty field (no expression) user-owned", () => {
    // KeyIdea is blank in the scaffold -> carries no {{ }} -> not managed.
    expect(buildManifestFromScaffold(scaffold)).not.toHaveProperty("KeyIdea");
  });

  it("never hard-codes field names — a custom-named field is managed too", () => {
    const custom = `---\nMyTitle: "{{title}}"\nNotes:\n---\nbody\n`;
    const map = buildManifestFromScaffold(custom);
    expect(map).toHaveProperty("MyTitle");
    expect(map).not.toHaveProperty("Notes"); // static/empty
  });

  it("round-trips and refreshes a SINGLE-LINE field idempotently", () => {
    const map = buildManifestFromScaffold(scaffold);
    const note = `---\nTitle: "stale"\nYear: "1900"\nKeyIdea: keep me\n---\nbody\n`;
    const managed = writeManifest(note, map);
    const out = applyManifest(managed, ITEM);
    expect(out).toContain(`Title: "A New Title"`);
    expect(out).toContain(`Year: "2020"`);
    expect(out).toContain("KeyIdea: keep me"); // unmanaged, preserved
    expect(applyManifest(out, ITEM)).toBe(out); // idempotent
  });

  it("round-trips and refreshes a MULTI-LINE list field idempotently", () => {
    const map = buildManifestFromScaffold(scaffold);
    // A note whose Author is stale; manage it from the scaffold's list template.
    const note = `---\nAuthor:\n - "[[Old Name]]"\nKeyIdea:\n---\nbody\n`;
    const managed = writeManifest(note, map);
    const out = applyManifest(managed, ITEM);
    expect(out).toContain(`- "[[Jane Doe]]"`); // re-rendered from creators
    expect(out).not.toContain("Old Name");      // stale list replaced
    expect(applyManifest(out, ITEM)).toBe(out);  // idempotent on the multi-line value
  });
});

describe("attachment folder (per-note, like tag field)", () => {
  it("returns null when no zon: attachments: is set", () => {
    expect(getAttachmentFolder(NOTE)).toBe(null);
    expect(getAttachmentFolder("no frontmatter at all")).toBe(null);
  });

  it("round-trips a per-note attachment folder", () => {
    const out = setAttachmentFolder(NOTE, "Z/imgs");
    expect(getAttachmentFolder(out)).toBe("Z/imgs");
    expect(out).toContain("attachments:");
  });

  it("is a reserved sync key — applyManifest never renders it as a field", () => {
    const note = setAttachmentFolder(`---\nTitle: "x"\nzon:\n  Title: "\\"{{title}}\\""\n---\nbody\n`, "References/Attachments");
    const out = applyManifest(note, ITEM);
    // The managed Title still refreshes...
    expect(out).toContain(`Title: "A New Title"`);
    // ...but `attachments` is not emitted as a top-level frontmatter field.
    expect(out).not.toMatch(/^attachments: /m);
    // and it's still readable as a per-note setting after a refresh.
    expect(getAttachmentFolder(out)).toBe("References/Attachments");
  });
});
