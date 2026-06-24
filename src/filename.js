// Build a note's filename from the user's filename pattern. Pure (string in,
// string out) so it unit-tests in Node — and it guards a file-write path, so the
// sanitise/fallback chain is worth testing directly rather than only through the
// Zotero glue. Used for BOTH creating a note and matching an existing one by
// filename, so the two can never disagree.

import { render } from "./render.js";
import { filenameFields } from "./item-data.js";
import { sanitizeFilename } from "./paths.js";

// `pattern` is the user's filename pattern (Nunjucks, e.g. `@{{citekey}}.md` or
// `{{author}} {{year}} - {{title}}.md`). `itemData` is buildItemData output.
// Renders the pattern over the item's data plus filename-friendly scalars
// (year/author/journal) and the citekey, guarantees a `.md` extension, and
// sanitises away characters illegal in filenames. Falls back to `@<citekey>.md`
// (or `note.md`) if the pattern errors or renders empty.
export function resolveNoteFilename(pattern, itemData, citekey) {
  const ck = citekey ? sanitizeFilename(citekey) : "";
  let fn = "";
  try {
    fn = String(render(pattern || "", { ...(itemData || {}), ...filenameFields(itemData), citekey: ck }) || "").trim();
  } catch (e) { fn = ""; }
  if (!fn) fn = "@" + (ck || "note");
  if (!/\.md$/i.test(fn)) fn += ".md";
  return sanitizeFilename(fn);
}
