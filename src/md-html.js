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

// A heading's words as they would render, written so that wrapping them in
// `**` is safe: emphasis markup is dropped, code spans are kept, and every
// character markdown could read as syntax is escaped. A regex over the raw text
// would eat literal asterisks ("b = 0.42**").
function plainLabel(inline) {
  let inLink = false;
  return (inline.children || []).map((child) => {
    if (child.type === "link_open") inLink = true;
    if (child.type === "link_close") inLink = false;
    // Link text is often a bare URL, which escaping would break.
    if (child.type === "text") return inLink ? child.content : child.content.replace(/[\\`*_[\]~]/g, "\\$&");
    if (child.type === "code_inline") return child.markup + child.content + child.markup;
    if (child.type === "softbreak" || child.type === "hardbreak") return " ";
    return "";
  }).join("").trim();
}

// Turn every heading in `markdown` into a bold paragraph of its own. Applied to
// what an LLM block wrote, so model text can never add to the note's heading
// structure (ADR-0006). Headings are located with the same parser mdToHtml
// renders with, so fenced code, underlined (setext) headings and headings nested
// in list items or blockquotes follow the renderer's rules exactly.
export function headingsToBold(markdown) {
  let text = String(markdown == null ? "" : markdown);
  // A rewrite can expose a new underlined heading (a bold line directly above a
  // nested `---`), so re-parse until nothing is left. One pass is the norm and
  // each pass removes a heading marker, so the cap only guards against a hang.
  for (let pass = 0; pass < 5; pass++) {
    const tokens = md.parse(text, {});
    const lines = text.split("\n");
    let changed = false;
    // Bottom-up, so earlier line numbers stay valid while lines are spliced.
    for (let i = tokens.length - 1; i >= 0; i--) {
      const open = tokens[i];
      if (open.type !== "heading_open" || !open.map) continue;
      const [from, to] = open.map;
      const content = tokens[i + 1].content;
      const first = lines[from];
      // Everything before the heading itself is the list/quote marker to keep.
      const at = open.markup[0] === "#" ? first.indexOf("#") : first.indexOf(content.split("\n")[0]);
      const label = plainLabel(tokens[i + 1]);
      const out = [];
      if (label) {
        // Blank lines keep a top-level bold line from merging into a
        // neighbouring list item or paragraph, or becoming a heading again
        // above a `---`.
        const top = open.level === 0;
        if (top && from > 0 && lines[from - 1].trim() !== "") out.push("");
        out.push(first.slice(0, Math.max(at, 0)) + "**" + label + "**");
        if (top && to < lines.length && lines[to].trim() !== "") out.push("");
      }
      lines.splice(from, to - from, ...out);
      changed = true;
    }
    if (!changed) break;
    text = lines.join("\n");
  }
  return text;
}
