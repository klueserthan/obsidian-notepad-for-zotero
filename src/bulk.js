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
// the caller determines this via existingSummaryNotes(item).length > 0). Rows
// also carry `templateName` (the per-row picker's choice, passed through
// unchanged for the dialog and bulkGate below) and `included` (the row's
// include toggle; absent/undefined means included, matching today's behaviour
// for callers that don't yet track it).
//
// policy:
//   "skip"       — an item with an existing note is left untouched (default)
//   "additional" — every item gets a fresh, additional Summary Note
//   "overwrite"  — an item with an existing note has its NEWEST one replaced
//
// An excluded row always plans as "skip", regardless of policy — Generate
// must never touch a row the user unticked.
//
// Returns [{ key, action, templateName }] aligned 1:1 with `items`, action one
// of "skip" | "create" | "overwrite".
export function planBulk(items, policy) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it) => {
    const key = it && it.key != null ? it.key : "";
    const hasExisting = !!(it && it.hasExistingNote);
    const included = !(it && it.included === false);
    const templateName = it && it.templateName;
    let action;
    if (!included) {
      action = "skip";
    } else if (policy === "additional") {
      action = "create";
    } else if (policy === "overwrite") {
      action = hasExisting ? "overwrite" : "create";
    } else {
      // "skip" is the default for any unrecognised policy value — fail safe
      // toward NOT touching an existing note rather than toward overwriting.
      action = hasExisting ? "skip" : "create";
    }
    return { key, action, templateName };
  });
}

// Gate Generate for the bulk dialog's review list. A row needs a template
// only if it's included AND the existing-note policy would actually render
// it (planBulk's action isn't "skip") — a row the policy will skip anyway is
// exempt from the assignment gate (session-settled, see the plan's Key
// Decisions: demanding a template for a row that never renders is noise).
//
// Returns { canGenerate, unassigned, included }:
//   included    — count of ticked (included) rows
//   unassigned  — count of included, policy-rendered rows with no templateName
//   canGenerate — false when included is 0 or unassigned is > 0
export function bulkGate(rows, policy) {
  const list = Array.isArray(rows) ? rows : [];
  const plans = planBulk(list, policy);
  let included = 0;
  let unassigned = 0;
  list.forEach((row, i) => {
    const isIncluded = !(row && row.included === false);
    if (isIncluded) included++;
    const willRender = plans[i].action !== "skip";
    const hasTemplate = !!(row && row.templateName);
    if (isIncluded && willRender && !hasTemplate) unassigned++;
  });
  return { canGenerate: included > 0 && unassigned === 0, unassigned, included };
}
