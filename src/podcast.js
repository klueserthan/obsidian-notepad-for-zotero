// Podcast Script (ADR-0007) — one LLM call turns a paper's indexed full text
// into a single-narrator spoken explainer, written for Zotero's Read Aloud.
// Pure logic: the caller reads the full text and item metadata and injects the
// transport, same `fetchFn(url, headers, payload, timeoutSeconds)` seam as
// src/abstract-extract.js. It does not use the ADR-0006 house style, which is
// lists-only and so the opposite of a spoken script.

import {
  sanitizeLLMSettings,
  buildChatCompletionsURL,
  buildLLMHeaders,
  buildChatCompletionsPayload,
  parseChatCompletionsResponse,
  sanitizeError,
} from "./llm.js";

// The tag on every saved script — the only way the plugin recognises one.
export const PODCAST_TAG = "zps:podcast-script";

// Stable reason codes for a failed run; bootstrap maps each to a message.
export const PODCAST_REASONS = {
  NO_FULLTEXT: "no-fulltext",
  TOO_LARGE: "too-large",
  TRUNCATED: "truncated",
  EMPTY: "empty",
  HTTP_FAILED: "http-failed",
};

// Constant text, so it stays a cacheable request prefix. Structure (plan
// first, weighted parts, spoken transitions) borrowed from lfnovo/
// podcast-creator (MIT); the listening and grounding rules are our own.
export const PODCAST_SYSTEM_PROMPT =
  "You are the narrator of a one-person podcast that explains a single research " +
  "paper. Write the full script of one episode, about 1,500 words (roughly ten " +
  "minutes spoken), in English, whatever the language of the paper.\n\n" +
  "Listener: a researcher from outside the paper's subfield. They know how " +
  "research works, so do not explain basic methods, but explain the field's own " +
  "terms the first time they come up.\n\n" +
  "Grounding: use only what the paper says. Never invent numbers, results, " +
  "quotes, or claims, and do not bring in outside literature. When the paper is " +
  "unclear about something, say so rather than guess.\n\n" +
  "Structure: plan the episode before you write it, then write it as one " +
  "continuous script in this order, giving the most time to the findings:\n" +
  "1. Introduction: the paper's title, its authors, the year and where it " +
  "appeared, and in a sentence or two why it matters.\n" +
  "2. The question and its background (short).\n" +
  "3. How the authors went about it: data, design, and method (medium).\n" +
  "4. What they found (the longest part).\n" +
  "5. Limitations the paper acknowledges or that clearly follow from its design (short).\n" +
  "6. A one-sentence takeaway that restates the main result.\n" +
  "Move between parts with spoken transitions, and introduce the paper only once.\n\n" +
  "Write for the ear, not the eye. The script is read aloud by a text-to-speech " +
  "voice exactly as written, so:\n" +
  "- Output plain prose paragraphs separated by blank lines, and nothing else: " +
  "no title, no headings, no lists, no tables, no markdown, no speaker labels, " +
  "no stage directions.\n" +
  "- No URLs, no citations in brackets, no equations, no parentheses.\n" +
  "- Write numbers, symbols, and abbreviations the way they are spoken, for " +
  "example \"forty-two percent\" and \"p less than point zero five\"; spell out " +
  "an abbreviation the first time it is used.\n" +
  "- Prefer short sentences and plain words.\n\n" +
  "Output only the script: no preface and no closing remarks about the script itself.";

// Metadata before the paper text, so the introduction can name the paper
// without the model hunting through the PDF's front matter for it.
export function buildPodcastMessages(text, meta) {
  const year = (String(meta?.date ?? "").match(/\d{4}/) || [""])[0];
  const fields = [
    ["Title", meta?.title],
    ["Authors", meta?.authors],
    ["Year", year],
    ["Published in", meta?.publicationTitle],
  ].filter(([, v]) => String(v ?? "").trim() !== "");
  const user =
    "Paper details:\n" + fields.map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n") +
    "\n\nPaper text:\n\n" + String(text ?? "") +
    "\n\nWrite the episode script for this paper.";
  return [
    { role: "system", content: PODCAST_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

// The prompt forbids markdown, but models slip; whatever remains would be
// spoken aloud, so it is stripped here. Blank lines separate paragraphs.
export function scriptToParagraphs(raw) {
  const plain = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "") // headings
    .replace(/^[ \t]*>[ \t]?/gm, "") // blockquotes
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "") // list markers
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/[*`]+/g, "") // bold/italic asterisks, code ticks
    .replace(/(^|\W)_+(\S(?:.*?\S)?)_+(?=\W|$)/g, "$1$2"); // _italic_, not snake_case
  return plain.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
}

export async function writePodcastScript(text, meta, settings, fetchFn) {
  const s = sanitizeLLMSettings(settings);
  if (String(text ?? "").trim() === "") return { ok: false, reason: PODCAST_REASONS.NO_FULLTEXT };
  // Fail loudly rather than silently script a cut-down paper (ADR-0001).
  if (String(text).length > s.maxContextChars) return { ok: false, reason: PODCAST_REASONS.TOO_LARGE };
  const payload = buildChatCompletionsPayload(s, buildPodcastMessages(text, meta));
  let raw;
  try {
    raw = await fetchFn(buildChatCompletionsURL(s.baseURL), buildLLMHeaders(s), payload, s.timeoutSeconds);
  } catch (error) {
    const status = typeof error?.status === "number" ? error.status : null;
    return { ok: false, reason: PODCAST_REASONS.HTTP_FAILED, status, detail: sanitizeError(error) };
  }
  // parseChatCompletionsResponse drops finish_reason, so parse once here.
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { data = null; }
  if (data?.choices?.[0]?.finish_reason === "length") return { ok: false, reason: PODCAST_REASONS.TRUNCATED };
  const paragraphs = scriptToParagraphs(parseChatCompletionsResponse(data ?? raw));
  if (!paragraphs.length) return { ok: false, reason: PODCAST_REASONS.EMPTY };
  return { ok: true, paragraphs };
}

const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The saved page: `lang` makes Read Aloud pick an English voice, and the body
// holds only paragraphs, the whole of what the voice reads.
export function podcastHtml(title, paragraphs) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    `<title>Podcast: ${escapeHtml(title)}</title>\n</head>\n<body>\n` +
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>\n`).join("") +
    "</body>\n</html>\n";
}
