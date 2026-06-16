// Reverse sync (note → Zotero) for TAGS — the pilot for bidirectional metadata.
//
// The note is the authority for whichever frontmatter field the user maps to
// Zotero tags (e.g. `Topics:`). These pure helpers read that field's entries,
// normalise each to a plain tag name, and diff against the item's tags so the
// caller can preview + apply the change. All string-in / value-out → unit-tested
// in Node. The actual write (addTag/removeTag/saveTx) lives in bootstrap.

const FM_RE = /^---\n([\s\S]*?)\n---/;
const TOP_KEY_RE = /^[A-Za-z0-9_-]+:/;
const LIST_ITEM_RE = /^\s*-\s+(.*)$/;

// Raw entries of a frontmatter list field. Handles a block list (items may be
// indented OR flush-left, with blank lines between — both occur in our notes):
//   Topics:
//   - "[[A]]"
//   - "[[B]]"
// a flow list  Topics: ["[[A]]", "[[B]]"]  and a comma scalar  Topics: A, B.
// Returns [] when the field is absent or empty.
export function frontmatterList(md, field) {
  const m = String(md).match(FM_RE);
  if (!m || !field) return [];
  const lines = m[1].split("\n");
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRe = new RegExp("^" + esc + ":\\s?(.*)$");
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (!/^\s/.test(lines[k]) && keyRe.test(lines[k])) { i = k; break; }
  }
  if (i < 0) return [];
  const out = [];
  const first = (lines[i].match(keyRe)[1] || "").trim();
  if (first) {
    const inner = first.startsWith("[") && first.endsWith("]") ? first.slice(1, -1) : first;
    for (const p of inner.split(",")) { const v = p.trim(); if (v) out.push(v); }
    return out;
  }
  // block list — subsequent `- item` lines, skipping blanks, until the next key.
  for (let j = i + 1; j < lines.length; j++) {
    const bm = lines[j].match(LIST_ITEM_RE);
    if (bm) { const v = bm[1].trim(); if (v) out.push(v); continue; }
    if (lines[j].trim() === "") continue;
    if (TOP_KEY_RE.test(lines[j])) break; // next top-level field
    break;
  }
  return out;
}

// Normalise one raw frontmatter tag entry to a plain Zotero tag name: drop
// surrounding quotes, [[wikilink]] brackets (taking the link target before any
// `|alias`), and a leading `#` (hashtag style). Returns "" for non-tags.
export function cleanTag(raw) {
  let s = String(raw).trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  const wl = s.match(/^\[\[(.+?)\]\]$/);
  if (wl) {
    s = wl[1];
    const pipe = s.indexOf("|");
    if (pipe >= 0) s = s.slice(0, pipe);
    s = s.trim();
  } else if (s.startsWith("#")) {
    s = s.slice(1).trim();
  }
  return s;
}

// Plan the note→Zotero tag change. `noteTags` is the authority. `add` = tags in
// the note but not on the item; `remove` = removable item tags absent from the
// note. `removable` defaults to itemTags but the caller passes only MANUAL tags
// so automatic tags (feeds etc.) are never stripped.
export function tagSyncPlan(noteTags, itemTags, removable) {
  const noteSet = new Set(noteTags);
  const itemSet = new Set(itemTags);
  const rem = removable == null ? itemTags : removable;
  const add = [...new Set(noteTags)].filter((t) => t && !itemSet.has(t));
  const remove = [...new Set(rem)].filter((t) => t && !noteSet.has(t));
  return { add, remove, changed: add.length > 0 || remove.length > 0 };
}
