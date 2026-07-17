// Composer preview assembly — pure ES module (no DOM, no Zotero).
//
// The Composer pane (item-pane section) shows a live, rendered preview of the
// Summary Note that Generate would create for the selected item. That preview
// must go through the SAME pipeline as Generate — render → stripFrontmatter →
// stripMarkers → markdown→HTML — so what the user sees is truthful.
//
// The ONE difference from Generate: `{% llm %}` blocks are NOT executed in the
// preview (LLM execution lands in a later slice). Instead each block renders as
// an inert, visible placeholder showing the target model and the block's context
// spec plus the (already variable-resolved) prompt body. No model call ever
// happens here — this module is pure string→string and imports nothing that can
// perform network I/O.
//
// Pipeline position: callers pass the already-stripped markdown (frontmatter and
// live-block delimiters removed) and receive preview-ready HTML. The `{% llm %}`
// tags survive marker stripping (stripMarkers only removes `%% zon %%` /
// `%% ann:KEY %%`), so this module is where they are turned into placeholders.

import { parseLLMBlocks } from "./llm-blocks.js";
import { mdToHtml } from "./md-html.js";

// Shown inside every placeholder so the user understands the block is unresolved
// in the preview and will be filled at Generate time (once execution ships).
export const PLACEHOLDER_NOTE =
  "Not run in preview — Generate inserts the model's output here.";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Build the inert placeholder markup for a single parsed `{% llm %}` block.
// `block` is a parseLLMBlocks() entry ({ contexts, contextArg, body, ... }).
// `opts.model` is the configured target model name (optional). Never executes
// anything; the returned HTML is self-contained and styled by `.zon-llm-*` CSS
// injected in the pane.
export function llmPlaceholderHtml(block, opts = {}) {
  const model = opts && opts.model ? String(opts.model) : "";
  const b = block || {};
  const contexts = Array.isArray(b.contexts)
    ? b.contexts.join(", ")
    : String(b.contextArg || "");
  const body = String(b.body == null ? "" : b.body);
  const modelText = model ? esc(model) : "(model not configured)";
  const ctxText = contexts ? esc(contexts) : "(none)";
  return (
    '<div class="zon-llm-placeholder" data-zon-llm="1">' +
    '<div class="zon-llm-placeholder-head">' +
    '<span class="zon-llm-placeholder-badge">LLM</span>' +
    '<span class="zon-llm-placeholder-meta">model: <code>' +
    modelText +
    "</code> · context: <code>" +
    ctxText +
    "</code></span>" +
    "</div>" +
    '<div class="zon-llm-placeholder-note">' +
    esc(PLACEHOLDER_NOTE) +
    "</div>" +
    '<pre class="zon-llm-placeholder-prompt">' +
    esc(body) +
    "</pre>" +
    "</div>"
  );
}

// Turn stripped Summary-Note markdown into preview-ready HTML.
//
// The whole document goes through ONE `mdToHtml` pass — the exact converter the
// Generate path uses — so markdown semantics that span an LLM block (list
// continuation, tight/loose list rules, blockquote lazy lines, …) are decided by
// markdown-it over the full document, never distorted by per-chunk conversion.
// Each `{% llm %}` block is first swapped for a unique sentinel token standing
// alone as a paragraph (markdown-it renders it as `<p>TOKEN</p>`); after the
// single render the sentinel paragraphs are substituted with the inert
// placeholder markup. Net semantics: the preview renders as if each LLM block
// were a plain paragraph. When the markdown has no LLM blocks the output is
// byte-identical to `mdToHtml(md)`.
//
// @param {string} md — rendered, frontmatter/marker-stripped note markdown
// @param {{ model?: string }} [opts]
// @returns {string} preview HTML
export function composePreviewHtml(md, opts = {}) {
  const text = String(md == null ? "" : md);
  const { blocks } = parseLLMBlocks(text);
  if (!blocks.length) return mdToHtml(text);

  // Sentinel base: plain A-Z/digits/hyphens — markdown-it has no rule that
  // transforms it (not linkifiable, no emphasis/code characters), so a line
  // holding only the token renders as a plain paragraph. Lengthen until the
  // base cannot collide with document text.
  let base = "ZON-LLM-PLACEHOLDER";
  while (text.includes(base)) base += "-X";

  const lines = text.split("\n");
  const sorted = blocks.slice().sort((a, b) => a.lineFrom - b.lineFrom);
  const tokens = []; // [{ token, html }]
  const outLines = [];
  let cursor = 0; // next unconsumed line index

  for (const b of sorted) {
    if (b.lineFrom < cursor) continue; // defensive: skip overlapping/nested
    for (let i = cursor; i < b.lineFrom; i++) outLines.push(lines[i]);
    const token = base + "-" + tokens.length;
    tokens.push({ token, html: llmPlaceholderHtml(b, opts) });
    // Blank lines around the token make it its own paragraph regardless of what
    // adjoins the block (extra blank lines are semantically inert in markdown).
    outLines.push("", token, "");
    cursor = b.lineTo + 1;
  }
  for (let i = cursor; i < lines.length; i++) outLines.push(lines[i]);

  let html = mdToHtml(outLines.join("\n"));
  for (const { token, html: placeholder } of tokens) {
    const asParagraph = "<p>" + token + "</p>";
    if (html.includes(asParagraph)) {
      html = html.replace(asParagraph, placeholder);
    } else {
      // Fallback: the token ended up inside another construct (e.g. a lazy
      // blockquote continuation) — substitute the bare token so it never leaks.
      html = html.replace(token, placeholder);
    }
  }
  return html;
}
