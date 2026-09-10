// Paper-type detection (KTD1) — asks the configured LLM to pick, per row, the
// best-fitting candidate template from that row's title and abstract only
// (R9, R10). This bypasses the {% llm %} block runner entirely: candidates
// come from paperTypeCandidates (src/templates.js), not from blocks already
// inside rendered text, and detection is reached only from the bulk dialog's
// explicit "Detect types" click, never from render/preview (ADR-0001).
//
// Mirrors executeLLMBlocks's contract (src/llm-runner.js): sanitized settings,
// a fetchFn(url, headers, payload, timeoutSeconds) => responseText, and the
// shared bounded pool (src/llm-pool.js). Unlike the block runner this never
// aborts the batch on one row's failure — every row settles independently and
// is reported through `onRow`, matching R12's "other rows are unaffected".

import { runBounded } from "./llm-pool.js";
import {
  sanitizeLLMSettings,
  buildChatCompletionsURL,
  buildLLMHeaders,
  buildChatCompletionsPayload,
  parseChatCompletionsResponse,
  sanitizeError,
} from "./llm.js";

export const DETECT_SYSTEM_PROMPT =
  "You are classifying a research paper into one of a fixed list of paper " +
  "types so the right template can render it. Reply with a single integer " +
  "only: the number of the best-fitting candidate, or 0 if none fits. No " +
  "other words.";

// Stable reason codes (R12) the dialog maps to user-facing strings. A row
// never throws; it always resolves to a success value or one of these.
export const DETECT_REASONS = {
  NO_ABSTRACT: "no-abstract",
  NO_CANDIDATE: "no-candidate",
  INVALID_ANSWER: "invalid-answer",
  HTTP_FAILED: "http-failed",
};

// Chat messages for one row (KTD3): candidates numbered 1..n as
// "N. label — description", then the row's title and abstract, asking for
// exactly one integer (0 for "none fits").
export function buildDetectMessages(candidates, { title, abstractNote } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const lines = list.map((c, i) => {
    const label = String(c?.label ?? "");
    const description = String(c?.description ?? "").trim();
    return `${i + 1}. ${label}${description ? " — " + description : ""}`;
  });
  const user =
    "Candidates:\n" + lines.join("\n") +
    "\n\nTitle: " + String(title ?? "") +
    "\nAbstract: " + String(abstractNote ?? "") +
    "\n\nWhich candidate fits best? Reply with its number only, or 0 if none fits.";
  return [
    { role: "system", content: DETECT_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// Extracts the model's answer (KTD3): a reply containing exactly one integer
// in 0..n is the answer (0 means "none fits"); no integer, more than one, or
// one out of range names no candidate per R12 and is reported as invalid.
export function parseDetectAnswer(text, n) {
  const matches = String(text ?? "").match(/\d+/g);
  if (!matches || matches.length !== 1) return { invalid: true };
  const value = Number(matches[0]);
  if (value === 0) return { none: true };
  if (value >= 1 && value <= n) return { index: value };
  return { invalid: true };
}

// Detects one paper type per row. `rows` is [{ key, title, abstractNote }].
// `candidates` is paperTypeCandidates' output: [{ name, label, description }].
// Sanitizes settings, cuts each abstract to maxContextChars, resolves rows
// with an empty abstract or no candidates without calling the model, then
// runs the rest through the shared bounded pool at settings.concurrency
// (shouldStop passed through for KTD5's mid-run cancel). `onRow(key, result)`
// fires as each row settles; result is `{ templateName, label }` on success,
// else `{ reason, detail }` (detail only for http-failed, already sanitized).
// Never throws for a single row; resolves once every row has settled or
// shouldStop has cut the run short.
export async function detectPaperTypes(rows, candidates, settings, fetchFn, onRow, opts = {}) {
  const { shouldStop } = opts;
  const s = sanitizeLLMSettings(settings);
  const list = Array.isArray(rows) ? rows : [];
  const cands = Array.isArray(candidates) ? candidates : [];

  const emit = (key, result) => {
    if (typeof onRow === "function") {
      try { onRow(key, result); } catch { /* ignore callback errors */ }
    }
  };

  const pending = [];
  for (const row of list) {
    const key = row && row.key != null ? row.key : "";
    const abstract = String(row?.abstractNote ?? "").trim();
    if (abstract === "") {
      emit(key, { reason: DETECT_REASONS.NO_ABSTRACT });
      continue;
    }
    if (cands.length === 0) {
      emit(key, { reason: DETECT_REASONS.NO_CANDIDATE });
      continue;
    }
    const abstractNote = abstract.length > s.maxContextChars
      ? abstract.slice(0, s.maxContextChars)
      : abstract;
    pending.push({ key, title: String(row?.title ?? ""), abstractNote });
  }

  if (pending.length === 0) return;

  const url = buildChatCompletionsURL(s.baseURL);
  const headers = buildLLMHeaders(s);

  const task = async (i) => {
    const row = pending[i];
    try {
      const messages = buildDetectMessages(cands, row);
      const payload = buildChatCompletionsPayload(s, messages);
      const content = parseChatCompletionsResponse(await fetchFn(url, headers, payload, s.timeoutSeconds));
      const answer = parseDetectAnswer(content, cands.length);
      if (answer.index) {
        const candidate = cands[answer.index - 1];
        emit(row.key, { templateName: candidate.name, label: candidate.label });
      } else if (answer.none) {
        emit(row.key, { reason: DETECT_REASONS.NO_CANDIDATE });
      } else {
        emit(row.key, { reason: DETECT_REASONS.INVALID_ANSWER });
      }
    } catch (error) {
      emit(row.key, { reason: DETECT_REASONS.HTTP_FAILED, detail: sanitizeError(error) });
    }
  };

  await runBounded(pending.length, s.concurrency, task, { shouldStop });
}
