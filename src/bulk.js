// Bulk AI summary generation — the pure planning helper for the right-click
// "Generate N summary notes…" action (CONTEXT.md Summary Note / Composer;
// ADR-0001 explicit-static LLM; ADR-0002 create-once). This module only decides
// WHAT to do per item; it never touches Zotero items, the LLM runner, or the
// filesystem — bootstrap.js drives the actual per-item render/resolve/save
// sequence and formats its user-facing report through the central STRINGS table
// (this.t), keeping all UI text centralized and translation-ready.
//
// Continue-and-report (locked decision, see docs/adr + the plan): a per-item
// failure never aborts the batch and never causes a note to be written; it's
// recorded and surfaced in the final report, metadata only — never prompt or
// response bodies, matching the logging contract elsewhere (composerRunLLM).

// Plan one item's action from the batch's existing-note policy. `hasExistingNote`
// is whether the item already carries a Summary Note (recognised by Marker Tag —
// the caller determines this via existingSummaryNotes(item).length > 0).
//
// policy:
//   "skip"       — an item with an existing note is left untouched (default)
//   "additional" — every item gets a fresh, additional Summary Note
//   "overwrite"  — an item with an existing note has its NEWEST one replaced
//
// Returns [{ key, action }] aligned 1:1 with `items`, action one of
// "skip" | "create" | "overwrite".
export function planBulk(items, policy) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it) => {
    const key = it && it.key != null ? it.key : "";
    const hasExisting = !!(it && it.hasExistingNote);
    let action;
    if (policy === "additional") {
      action = "create";
    } else if (policy === "overwrite") {
      action = hasExisting ? "overwrite" : "create";
    } else {
      // "skip" is the default for any unrecognised policy value — fail safe
      // toward NOT touching an existing note rather than toward overwriting.
      action = hasExisting ? "skip" : "create";
    }
    return { key, action };
  });
}
