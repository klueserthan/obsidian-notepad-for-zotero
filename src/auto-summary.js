// Pure rules for the opt-in automatic-summary sweep (CONTEXT.md, ADR-0004).
// No Zotero globals: bootstrap.js drives the timer, the Zotero.Search lookup,
// the fulltext read, and the resolve/create pipeline; this module only decides
// WHAT the sweep should do, given plain values it's handed. Mirrors src/bulk.js's
// division of labor (bootstrap acts, src/ decides) and its table-driven tests.

import { DETECT_REASONS } from "./paper-type.js";
import { LLM_RUN_ERRORS } from "./llm-runner.js";
import { ABSTRACT_TAG } from "./abstract-extract.js";

export const AUTO_SUMMARY_DEFAULTS = {
  TRIGGER_TAG: "zps:summarize",
  FAILURE_TAG: "zps:summarize-failed",
  NO_FULLTEXT_TAG: "zps:summarize-no-fulltext",
  WAIT_HOURS: 24,
};

// Parse the first-seen map pref (KTD4): a JSON string keyed `libraryID/itemKey`
// -> ms timestamp. Corrupt JSON or anything that isn't a plain object (array,
// string, number, null) is treated as an empty map rather than thrown.
export function parseFirstSeenMap(json) {
  let parsed;
  try {
    parsed = JSON.parse(String(json ?? ""));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

// Rebuild the first-seen map for this sweep (KTD4): a key in `taggedKeys` that
// wasn't stored gets `nowMs`; one already stored keeps its original time; a
// stored key no longer in `taggedKeys` (untagged, or reached an outcome) drops.
export function updateFirstSeenMap(storedMap, taggedKeys, nowMs) {
  const stored = storedMap && typeof storedMap === "object" ? storedMap : {};
  const keys = Array.isArray(taggedKeys) ? taggedKeys : [];
  const next = {};
  for (const key of keys) {
    next[key] = Object.hasOwn(stored, key) ? stored[key] : nowMs;
  }
  return next;
}

// Sanitize the configurable full-text wait (R3): any non-numeric, zero, or
// negative value falls back to the 24-hour default.
export function sanitizeWaitHours(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : AUTO_SUMMARY_DEFAULTS.WAIT_HOURS;
}

// Decide one tagged item's action for this sweep.
// - An existing Summary Note always wins (R9), full text or not.
// - Full text ready processes even past the wait (AE2 covers the closed-Zotero
//   catch-up case at the fulltext-readiness layer, not here).
// - Not ready fails only once `timeoutAllowed` (KTD5: no timeout decision in
//   the startup grace period or during sync) and the wait has actually passed.
export function planItemAction({ hasSummaryNote, fulltextReady, firstSeen, now, waitMs, timeoutAllowed }) {
  if (hasSummaryNote) return "skip-existing";
  if (fulltextReady) return "process";
  if (timeoutAllowed && now - firstSeen > waitMs) return "fail-no-fulltext";
  return "wait";
}

// Pick the note type for one detection result (KTD8). `no-abstract`,
// `no-candidate`, and `invalid-answer` fall back to the default note name;
// `http-failed` is a provider failure (KTD7), never silently defaulted, so a
// network blip can't fix the wrong note type into a create-once note.
export function chooseNoteType(detectionResult, defaultName) {
  const reason = detectionResult && detectionResult.reason;
  if (reason === DETECT_REASONS.HTTP_FAILED) return { providerFailure: true };
  if (reason === DETECT_REASONS.NO_ABSTRACT || reason === DETECT_REASONS.NO_CANDIDATE || reason === DETECT_REASONS.INVALID_ANSWER) {
    return { templateName: defaultName };
  }
  if (detectionResult && detectionResult.templateName) return { templateName: detectionResult.templateName };
  return { templateName: defaultName };
}

const PROVIDER_HTTP_STATUSES = new Set([401, 403, 404, 429]);

// Classify a resolve failure (KTD7) into provider / item / abort, before any
// tag is written. `code` is a runner code (llm.run.*) passed through unchanged,
// or a resolve-level code (resolve.*) from the U3 resolve step.
export function classifyFailure({ code, status }) {
  if (code === "resolve.notConfigured" || code === "resolve.coreMissing" || code === "resolve.unknownNoteType") {
    return "abort";
  }
  if (code === "resolve.renderFailed") return "item";
  if (code === LLM_RUN_ERRORS.HTTP_FAILED) {
    // Zotero.HTTP reports a refused or dropped connection as status 0: a provider failure, like no status at all.
    const isProviderStatus = status == null || status === 0 || PROVIDER_HTTP_STATUSES.has(status) || (status >= 500 && status <= 599);
    return isProviderStatus ? "provider" : "item";
  }
  // Every other llm.run.* code (emptyResponse, contextTooLarge, contextMissing,
  // contextUnsupported, renderFailed, parseErrors, noBlocks) is an item failure.
  return "item";
}

// Validate a trigger-tag setting (R3): trimmed, non-empty, and distinct from
// both failure tags, the Summary Note marker tag, and the abstract-extraction
// marker tag (KTD8) — a trigger tag colliding with any of them would make the
// sweep's own tag writes ambiguous.
export function sanitizeTriggerTag(value, { failureTags, markerTag } = {}) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === ABSTRACT_TAG) return "";
  const fails = Array.isArray(failureTags) ? failureTags : [];
  if (fails.includes(trimmed)) return "";
  if (markerTag && (trimmed === markerTag || trimmed.startsWith(markerTag + ":"))) return ""; // the marker, or a note-type tag
  return trimmed;
}

// Tag add/remove list for one outcome (Key Decision: "the tag becomes the
// outcome"). `success` and `skip-existing` both clear every automatic-mode
// tag; `pickup` (retrying a failed item) clears just the failure tags and
// leaves the trigger tag the researcher re-added.
export function tagChangesForOutcome(outcome, { triggerTag, failureTag, noFulltextTag } = {}) {
  const trigger = triggerTag || "";
  const fail = failureTag || "";
  const noFulltext = noFulltextTag || "";
  switch (outcome) {
    case "success":
    case "skip-existing":
      return { add: [], remove: [trigger, fail, noFulltext] };
    case "fail":
      return { add: [fail], remove: [trigger] };
    case "fail-no-fulltext":
      return { add: [noFulltext], remove: [trigger] };
    case "pickup":
      return { add: [], remove: [fail, noFulltext] };
    default:
      return { add: [], remove: [] };
  }
}
