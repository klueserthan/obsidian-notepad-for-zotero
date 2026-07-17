// Markdown → Zotero-note-safe HTML.
//
// The Generate action (ADR-0002) turns a rendered, marker-stripped Summary Note
// (markdown) into HTML for a native Zotero child note. Zotero's note editor runs
// its own HTML sanitizer, so the converter is pinned to a known, explicit rule
// set whose full output vocabulary is the allowlist below — all of it legitimate
// in Zotero's note editor (TinyMCE):
//
//   h1–h6, p, ul/ol/li, blockquote, a, strong, em, code, pre, hr,
//   img                            (image syntax ![alt](src))
//   br                             (hard line breaks: trailing double-space or backslash)
//   s                              (strikethrough ~~text~~)
//   table/thead/tbody/tr/th/td    (GFM tables)
//
// Config (explicit, so the emitted set can't drift silently):
//   - preset "default" — CommonMark block/inline rules (headings, lists,
//     blockquotes, links, images, emphasis, code, hr, hard breaks).
//   - .enable(["table", "strikethrough"]) — the two GFM extras; pinned by name
//     so the vocabulary above stays the contract even if upstream preset
//     defaults ever change.
//   - html: false     — raw HTML in the markdown is ESCAPED, never passed
//                       through. This is the key guarantee that no arbitrary/
//                       unsafe tag can leak into the note from template or
//                       annotation text.
//   - linkify: true   — bare URLs become links (sensible for citation/DOI text).
//   - breaks: false   — soft newlines do NOT become <br>; only explicit hard
//                       breaks do.
//   - typographer: false — deterministic, unsurprising output.
//
// test/md-html.spec.js asserts the emitted tags are exactly this set.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt("default", {
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
}).enable(["table", "strikethrough"]);

// Render markdown to Zotero-note-safe HTML. Returns "" for empty/nullish input.
export function mdToHtml(markdown) {
  return md.render(String(markdown == null ? "" : markdown));
}
