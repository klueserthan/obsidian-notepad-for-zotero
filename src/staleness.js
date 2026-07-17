// Pure date comparison between an item's Summary Notes and its annotations —
// the Composer's read-only Stale Indicator (ADR-0002, CONTEXT.md "Stale
// Indicator"). No Zotero globals: bootstrap.js gathers the descriptors (child
// notes recognised ONLY by the Marker Tag, and the item's raw annotations) and
// calls summaryNoteStaleness(). This module never writes anything — it only
// classifies.
//
// State meanings:
//   "no-note" — the item has no Summary Note yet (distinct from "stale": there
//               is nothing to compare against, so nothing can be stale)
//   "fresh"   — the newest Summary Note is at least as new as every annotation
//               (also the state when there are no annotations at all — an
//               empty annotation list is never stale)
//   "stale"   — at least one annotation was modified after the newest Summary
//               Note was added

// Coerce an ISO string, Date-parseable string, or Date instance to epoch ms.
// Returns NaN for anything unparseable (null/undefined/garbage).
function toTimestamp(value) {
  if (value == null) return NaN;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? NaN : t;
}

// The latest timestamp among `values` (mapped through `pick`), ignoring any
// entries that don't parse. Returns -Infinity for an empty or all-unparseable
// list, so such a list never wins a staleness comparison — i.e. an item whose
// annotations all carry unparseable dates is never reported stale on their
// account, and a Summary Note with an unparseable dateAdded is treated as
// infinitely old (conservative: more likely to read as stale, never crashes).
function latestTimestamp(list, pick) {
  let max = -Infinity;
  for (const entry of list) {
    const t = toTimestamp(pick(entry));
    if (t > max) max = t;
  }
  return max;
}

// summaryNotes: [{ dateAdded }] — the item's child notes carrying the Marker Tag.
// annotations:  [{ dateModified }] — the item's annotations (any shape with a
//               dateModified field works; extra fields are ignored).
// Returns "no-note" | "fresh" | "stale". Ties (newest annotation exactly as new
// as the newest note) resolve to "fresh" — staleness requires strictly newer.
export function summaryNoteStaleness(summaryNotes, annotations) {
  const notes = Array.isArray(summaryNotes) ? summaryNotes : [];
  const anns = Array.isArray(annotations) ? annotations : [];

  if (notes.length === 0) return "no-note";
  if (anns.length === 0) return "fresh";

  const newestNote = latestTimestamp(notes, (n) => n && n.dateAdded);
  const newestAnnotation = latestTimestamp(anns, (a) => a && a.dateModified);

  return newestAnnotation > newestNote ? "stale" : "fresh";
}
