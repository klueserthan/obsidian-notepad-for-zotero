// Abstract extraction (KTD1) — asks the configured LLM to copy out the
// paper's own abstract from the start of its Zotero-indexed full text, then
// verifies the answer actually appears in that text before it is ever
// written anywhere (R1, R2, R3). This is the same LLM-finds-it,
// plugin-verifies-it split as paper-type detection (src/paper-type.js), and
// it reuses that module's provider plumbing (src/llm.js), but it is a
// separate module because its parsing and verification rules — the NONE
// sentinel, quote/label stripping, normalized containment, the truncation
// guards — belong to a different question than "which candidate fits".
//
// Entry point is single-item `extractAbstract(text, settings, fetchFn)`;
// callers handling several items run it under the shared bounded pool
// (src/llm-pool.js) themselves, same contract as detectPaperTypes.

import {
  sanitizeLLMSettings,
  buildChatCompletionsURL,
  buildLLMHeaders,
  buildChatCompletionsPayload,
  parseChatCompletionsResponse,
  sanitizeError,
} from "./llm.js";

export const ABSTRACT_TAG = "zps:abstract-extracted";

// Stable reason codes (KTD1) for a non-extraction outcome.
export const ABSTRACT_REASONS = {
  NO_FULLTEXT: "no-fulltext",
  NOT_FOUND: "not-found",
  HTTP_FAILED: "http-failed",
};

// ponytail: 12,000 chars approximates the opening two-to-three pages of a
// typical article — Zotero's fulltext cache has no page breaks to slice by.
// Upgrade path: a page-aware slice, if Zotero ever exposes page boundaries.
export const MAX_SLICE_CHARS = 12000;

const MIN_ABSTRACT_WORDS = 20;
const TRUNCATION_GUARD_CHARS = 200;

export const EXTRACT_SYSTEM_PROMPT =
  "You are extracting a research paper's own abstract from the beginning of " +
  "its full text. Reply with the abstract copied exactly, word for word, or " +
  "the single word NONE if the text has no abstract. No other words, no " +
  "commentary, no markdown.";

// Chat messages for one item (KTD2): the source slice, then a request for an
// exact copy or the NONE sentinel.
export function buildExtractMessages(slice) {
  const user =
    "Paper text (beginning):\n\n" + String(slice ?? "") +
    "\n\nReply with the paper's abstract copied exactly as written, or the " +
    "single word NONE if there is no abstract.";
  return [
    { role: "system", content: EXTRACT_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// Extracts the model's answer (KTD2.2): NONE (exact, checked first) means no
// abstract; otherwise strip one layer of wrapping quotes and a leading
// "Abstract" label ("Abstract:", "ABSTRACT.", "Abstract -", or a bare
// heading followed by whitespace).
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
];

export function parseExtractAnswer(raw) {
  let s = String(raw ?? "").trim();
  if (s === "" || s === "NONE") return { none: true };

  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  // A bare word is only a heading when it is all caps, or when punctuation or a
  // line break follows it: "Abstract interpretation …" must keep its first word.
  if (/^ABSTRACT\s+/.test(s)) s = s.replace(/^ABSTRACT\s+/, "");
  else s = s.replace(/^abstract(?:\s*[:.\-–—]\s*|[ \t]*\r?\n\s*)/i, "");
  s = s.trim();

  if (s === "") return { none: true };
  return { answer: s };
}

// Normalizes text for containment (KTD2.3): Latin ligatures folded ("ﬁ" →
// "fi", U+FB00–FB06 only — full NFKC would also equate "CO₂" with "CO2"),
// soft hyphens dropped, line-break hyphenation joined ("-" then a
// line break), whitespace collapsed. Case is left as-is — the comparison is
// case-sensitive.
export function normalizeForContainment(s) {
  return String(s ?? "")
    .replace(/[\uFB00-\uFB06]/g, (c) => c.normalize("NFKC"))
    .replace(/­/g, "")
    .replace(/-[ \t]*\r?\n\s*/g, "") // a hyphen before a line break, not same-line punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// The value actually written once containment has proven it matches the
// source (KTD2.6): line-break hyphenation joined as containment joins it, so
// "inter-\nnational" is saved as "international", and whitespace collapsed.
// Every other character is preserved.
export function collapseWhitespace(s) {
  return String(s ?? "").replace(/-[ \t]*\r?\n\s*/g, "").replace(/\s+/g, " ").trim();
}

// The containment check itself (KTD2.3-5): the normalized answer must appear
// in the normalized slice, and — when the slice is a truncated prefix of the
// full text — the match must not end within the last 200 normalized
// characters, since the abstract may continue past the cut.
export function containsVerbatim(slice, answer, sliceTruncated) {
  const answerNormalized = normalizeForContainment(answer);
  if (!answerNormalized) return false;
  const sliceNormalized = normalizeForContainment(slice);
  const index = sliceNormalized.indexOf(answerNormalized);
  if (index === -1) return false;
  const matchEnd = index + answerNormalized.length;
  if (sliceTruncated && sliceNormalized.length - matchEnd < TRUNCATION_GUARD_CHARS) {
    return false;
  }
  return true;
}

// Extracts and verifies one item's abstract. `text` is the full indexed text
// already read by the caller (KTD3 reads it, this module never touches
// Zotero); `fetchFn(url, headers, payload, timeoutSeconds)` resolves to the
// raw response text, matching detectPaperTypes' fetch seam. Never throws:
// resolves to `{ ok: true, abstract }` or `{ ok: false, reason }`, with a
// numeric `status` (or null) and a sanitized `detail` added for
// `http-failed`.
export async function extractAbstract(text, settings, fetchFn) {
  const fullText = String(text ?? "");
  if (fullText.trim() === "") {
    return { ok: false, reason: ABSTRACT_REASONS.NO_FULLTEXT };
  }

  const s = sanitizeLLMSettings(settings);
  const sliceLen = Math.min(MAX_SLICE_CHARS, s.maxContextChars);
  const slice = fullText.slice(0, sliceLen);
  const sliceTruncated = fullText.length > slice.length;

  const url = buildChatCompletionsURL(s.baseURL);
  const headers = buildLLMHeaders(s);
  const payload = buildChatCompletionsPayload(s, buildExtractMessages(slice));

  let raw;
  try {
    raw = await fetchFn(url, headers, payload, s.timeoutSeconds);
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : null;
    return { ok: false, reason: ABSTRACT_REASONS.HTTP_FAILED, status, detail: sanitizeError(error) };
  }

  // parseChatCompletionsResponse drops finish_reason, so the raw JSON is
  // parsed once here and the parsed object is handed to it for the content.
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    data = null;
  }
  const finishReason = data?.choices?.[0]?.finish_reason;
  const content = parseChatCompletionsResponse(data ?? raw);

  const parsed = parseExtractAnswer(content);
  if (parsed.none) return { ok: false, reason: ABSTRACT_REASONS.NOT_FOUND };
  if (finishReason === "length") return { ok: false, reason: ABSTRACT_REASONS.NOT_FOUND };

  const wordCount = parsed.answer.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_ABSTRACT_WORDS) return { ok: false, reason: ABSTRACT_REASONS.NOT_FOUND };

  if (!containsVerbatim(slice, parsed.answer, sliceTruncated)) {
    return { ok: false, reason: ABSTRACT_REASONS.NOT_FOUND };
  }

  return { ok: true, abstract: collapseWhitespace(parsed.answer) };
}
