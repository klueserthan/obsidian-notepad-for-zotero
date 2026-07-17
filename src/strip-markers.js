// Strip live-block delimiters/anchors from rendered markdown.
//
// A rendered note (see src/blocks.js) carries invisible Obsidian comments that
// delimit managed blocks and anchor each annotation:
//
//   %% zon kind=annotations colour=yellow type=highlight sync=on format=quote %%
//   > ...rendered annotations...   %% ann:ABCD1234 %%
//   %% /zon %%
//
// In an Obsidian vault these are invisible comments. In a native Zotero note they
// would show up as visible garbage. This module removes them ahead of the
// markdown→HTML step (see src/md-html.js), leaving all non-delimiter content
// byte-identical.
//
// Grammar mirrors src/blocks.js exactly:
//   - OPEN  line:  ^\s* %% zon <config> %% \s*$   (whole line, any config params)
//   - CLOSE line:  ^\s* %% /zon %% \s*$           (whole line)
//   - inline anchor: %% ann:KEY %%                (KEY is [A-Za-z0-9]+)
//
// Whole delimiter lines are dropped in full (the line AND its newline), so no
// blank-line debris is introduced. Inline anchors are removed together with the
// single separating space the renderer emits before them (`text %% ann:K %%` →
// `text`), so the surrounding prose is left clean. Idempotent: running it again
// on already-clean input returns the input unchanged.

// Whole-line open delimiter, e.g. `%% zon kind=annotations colour=yellow ... %%`.
const OPEN_LINE_RE = /^\s*%%\s*zon\s+[^%]*?\s*%%\s*$/;
// Whole-line close delimiter, `%% /zon %%`.
const CLOSE_LINE_RE = /^\s*%%\s*\/zon\s*%%\s*$/;
// Inline annotation anchor plus any horizontal whitespace immediately before it.
// Horizontal whitespace only (no `\s`), so the match never crosses a newline.
const ANN_ANCHOR_RE = /[ \t]*%%[ \t]*ann:[A-Za-z0-9]+[ \t]*%%/g;

// Remove all live-block delimiters and annotation anchors from rendered markdown.
// Surrounding content is preserved byte-identically; idempotent on clean input.
export function stripMarkers(md) {
  const text = String(md == null ? "" : md);
  const out = [];
  for (const line of text.split("\n")) {
    if (OPEN_LINE_RE.test(line) || CLOSE_LINE_RE.test(line)) continue; // drop the whole line
    out.push(line.replace(ANN_ANCHOR_RE, ""));
  }
  return out.join("\n");
}

// Drop a leading YAML frontmatter block (`--- … ---`), if present. Rendered notes
// begin with frontmatter authored for the Obsidian file world (Title/Year/Tags/…
// and the reserved `zon:` manifest block); it has no place in a Zotero note body.
// Kept as its own export (separate concern from delimiter stripping) and applied
// alongside stripMarkers in the Generate path. Reuses the same frontmatter grammar
// as the editor/preview layer (src/preview.js) so the two never drift.
export function stripFrontmatter(md) {
  const text = String(md == null ? "" : md);
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  if (!m) return text;
  // Drop the blank line(s) between the closing fence and the first body line so
  // the note body begins cleanly.
  return text.slice(m[0].length).replace(/^(?:\r?\n)+/, "");
}

// Prepend the generic Summary Note title heading. Zotero derives a note's
// displayed title from its first content line, so every generated note (and its
// preview — the two must match) opens with `# Summary: <item title>`; templates
// therefore must not supply their own leading H1. Idempotent: if the body
// already opens with the exact heading this call would add, it is returned
// unchanged. An empty/missing item title falls back to plain `# Summary`.
export function withSummaryTitle(md, itemTitle) {
  const body = String(md == null ? "" : md);
  const title = String(itemTitle == null ? "" : itemTitle).trim();
  const heading = title ? `# Summary: ${title}` : "# Summary";
  if (body === heading || body.startsWith(heading + "\n")) return body;
  return heading + "\n\n" + body;
}
