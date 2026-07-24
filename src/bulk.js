// Bulk AI summary generation — pure planning + reporting helpers for the
// right-click "Generate N summary notes…" action (CONTEXT.md Summary Note /
// Composer; ADR-0001 explicit-static LLM; ADR-0002 create-once). This module
// only decides WHAT to do per item and how to describe what happened; it
// never touches Zotero items, the LLM runner, or the filesystem — bootstrap.js
// drives the actual per-item render/resolve/save sequence and calls these
// pure functions to plan the batch and format its end-of-run report.
//
// Continue-and-report (locked decision, see docs/adr + the plan): a per-item
// failure never aborts the batch and never causes a note to be written; it's
// recorded and surfaced in the final summary text, metadata only (title +
// reason) — never prompt or response bodies, matching the logging contract
// elsewhere (bootstrap.js composerRunLLM).

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

// Human-readable one-line summary of a finished batch, for the progress
// window's finishProgress() description.
// counts: { created, overwritten, skipped, failed } — any missing/non-numeric
// field is treated as 0.
export function summarizeBulkResults(counts) {
  const c = counts || {};
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const created = n(c.created), overwritten = n(c.overwritten),
    skipped = n(c.skipped), failed = n(c.failed);
  return (
    "created " + created +
    ", overwritten " + overwritten +
    ", skipped " + skipped +
    ", failed " + failed
  );
}

// Multi-line, human-readable failure report — metadata only (title + reason),
// NEVER prompt/response bodies (the caller must only ever pass sanitized
// reason strings, e.g. from describeLLMFailure or a caught error's message).
// failures: [{ title, reason }]. Returns "" for an empty/missing list.
export function formatBulkFailures(failures) {
  const list = Array.isArray(failures) ? failures : [];
  if (!list.length) return "";
  return list
    .map((f) => {
      const title = (f && f.title != null && String(f.title).trim()) || "(untitled)";
      const reason = (f && f.reason != null) ? String(f.reason) : "unknown error";
      return title + ": " + reason;
    })
    .join("\n");
}
