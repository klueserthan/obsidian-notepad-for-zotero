// Markdown → Zotero-note-safe HTML.
//
// The Generate action (ADR-0002) turns a rendered, marker-stripped Summary Note
// (markdown) into HTML for a native Zotero child note. Zotero's note editor runs
// its own HTML sanitizer, so the converter is configured to emit only the common,
// well-supported tags: h1–h6, p, ul/ol/li, blockquote, a, strong/em, code, pre,
// hr (markdown-it's defaults) and nothing exotic.
//
// Config:
//   - html: false     — raw HTML in the markdown is ESCAPED, never passed through.
//                       This is the key guarantee that no disallowed/unsafe tag can
//                       leak into the note from template or annotation text.
//   - linkify: true   — bare URLs become links (sensible for citation/DOI text).
//   - typographer: false / breaks: false — deterministic, unsurprising output.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

// Render markdown to Zotero-note-safe HTML. Returns "" for empty/nullish input.
export function mdToHtml(markdown) {
  return md.render(String(markdown == null ? "" : markdown));
}
