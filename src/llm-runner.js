// Pure LLM run planner — parses blocks, resolves context, assembles messages,
// normalizes output, applies replacements. No DOM, no Zotero, no fetch.

import { parseLLMBlocks, FRONTMATTER_RE, FENCE_RE } from "./llm-blocks.js";
import { renderAnnotationsContext } from "./annotations.js";
import { renderFulltextContext } from "./fulltext.js";
import { LLM_DEFAULTS } from "./llm.js";
import { render } from "./render.js";
import { runBounded } from "./llm-pool.js";
import { headingsToBold } from "./md-html.js";
import {
  canAutoRun,
  sanitizeLLMSettings,
  buildChatCompletionsURL,
  buildLLMHeaders,
  buildChatCompletionsPayload,
  parseChatCompletionsResponse,
} from "./llm.js";

// The instruction every block call shares. Besides grounding, it carries the
// house style (ADR-0006): key points only, lists and tables, no headings, and
// only what belongs under the block's own section. It is constant text, so it
// stays part of the byte-identical request prefix.
export const GROUNDING_SYSTEM_PROMPT =
  "You are a research assistant embedded in a Zotero literature note. " +
  "Complete the task given in the user message and output only Markdown that " +
  "fulfills it. Ground your answer strictly in the context provided in the user " +
  "message; do not introduce facts, interpretations, or citations that are not " +
  "present there. Output only the task result — no preface, no commentary, no " +
  "explanation outside the requested content.\n\n" +
  "Format: write only lists and tables, and number a list only when the task " +
  "asks for that. Never write a heading — no line starting with #, no " +
  "underlined title, no bold line standing in for one; the note already " +
  "supplies the heading above your answer. A list item may open with a short " +
  "bold label, and items may nest one level deep. Write no prose paragraphs.\n\n" +
  "Length: key points only — about three to six top-level list items, or one " +
  "table when the task asks for a table. Keep each item to a sentence or two " +
  "and each table cell to a short phrase. Give the headline result for each " +
  "finding or hypothesis and leave exhaustive coefficients and test statistics " +
  "to the paper.\n\n" +
  "Scope: when the user message includes a note outline and names the section " +
  "to write, write only what belongs under that section. What belongs under " +
  "another section of the outline is written there; refer to it by a short " +
  "label (for example H1) instead of restating it.\n\n" +
  "If the provided context is not sufficient to complete the task, respond " +
  "with a single list item stating what is missing. The user message provides " +
  "the context first, then the note outline when the note has one, followed " +
  "by the task.";

export const RUNNABLE_CONTEXTS = ["abstract", "annotations", "fulltext"];

export const LLM_RUN_ERRORS = {
  NO_BLOCKS: "llm.run.noBlocks",
  PARSE_ERRORS: "llm.run.parseErrors",
  CONTEXT_UNSUPPORTED: "llm.run.contextUnsupported",
  CONTEXT_MISSING: "llm.run.contextMissing",
  CONTEXT_TOO_LARGE: "llm.run.contextTooLarge",
  RENDER_FAILED: "llm.run.renderFailed",
  EMPTY_RESPONSE: "llm.run.emptyResponse",
  HTTP_FAILED: "llm.run.httpFailed",
};

// Context precedes the task so that requests sharing a context differ only in
// their tail — the system prompt + context + note outline form a byte-identical
// prefix that OpenAI-compatible servers can reuse via automatic prefix/prompt
// caching. The section name is the only per-block addition, so it goes after
// `Task:`. A note without headings has neither, leaving just context and task.
export function buildLLMMessages(systemPrompt, taskText, contextText, outline = "", section = "") {
  const task = String(taskText ?? "");
  const ctx = String(contextText ?? "");
  const user = `Context:\n${ctx}\n\n` +
    (outline ? `Note outline:\n${outline}\n\n` : "") +
    "Task:\n" +
    (section ? `Section to write: ${section}\n\n` : "") +
    task;
  return [
    { role: "system", content: String(systemPrompt ?? "") },
    { role: "user", content: user },
  ];
}

const ATX_HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

// The note's own headings: `#` lines outside the YAML frontmatter, fenced code
// and the LLM blocks themselves (a prompt body may contain a `#` line).
// ponytail: annotation text synced into a %% zon %% block is not masked, so a
// PDF comment line starting with "# " shows up as one extra outline entry; mask
// those ranges if a real note's outline is ever polluted.
function findNoteHeadings(text, blocks) {
  const s = String(text ?? "");
  const lines = s.split("\n");
  const fm = s.match(FRONTMATTER_RE);
  const inBlock = (i) => blocks.some((b) => i >= b.lineFrom && i <= b.lineTo);
  const headings = [];
  let fence = "";
  for (let i = fm ? fm[0].split("\n").length : 0; i < lines.length; i++) {
    if (inBlock(i)) continue;
    const fenceM = lines[i].match(FENCE_RE);
    if (fenceM) {
      if (!fence) fence = fenceM[1][0];
      else if (fenceM[1][0] === fence) fence = "";
      continue;
    }
    if (fence) continue;
    const m = lines[i].match(ATX_HEADING_RE);
    if (m && m[2]) headings.push({ line: i, level: m[1].length, text: m[2] });
  }
  return headings;
}

// Headings as a plain nested list — no `#` marks, which would invite the model
// to write headings of its own.
function renderOutline(headings) {
  const top = Math.min(...headings.map((h) => h.level));
  return headings.map((h) => "  ".repeat(h.level - top) + "- " + h.text).join("\n");
}

export function normalizeLLMOutput(raw) {
  return String(raw ?? "").replace(/\r\n?/g, "\n").trim();
}

export function classifyLLMOutput(content) {
  const c = String(content ?? "").trim();
  if (c.length === 0) return { ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE };
  return { ok: true, output: normalizeLLMOutput(c) };
}

function resolveContext(kind, itemData) {
  if (kind === "abstract") {
    const text = String(itemData?.abstractNote ?? "").trim();
    if (text === "") {
      return { text: "", missingReason: "abstract is empty for this item" };
    }
    return { text, missingReason: null };
  }
  if (kind === "annotations") {
    const text = renderAnnotationsContext(itemData?.annotations || []);
    if (text === "") {
      return { text: "", missingReason: "no usable annotations for this item" };
    }
    return { text, missingReason: null };
  }
  if (kind === "fulltext") {
    const text = renderFulltextContext(itemData);
    if (text === "") {
      return { text: "", missingReason: "no extracted full text available for the primary PDF" };
    }
    return { text, missingReason: null };
  }
  // Unknown kind — fail closed (validation pass should catch this first)
  return {
    text: "",
    missingReason:
      "context '" + kind + "' is not yet supported by Run LLM (only '" + RUNNABLE_CONTEXTS.join("', '") + "')",
  };
}

export function prepareLLMRun(text, itemData, opts = {}) {
  const { blocks, errors } = parseLLMBlocks(text);

  if (errors.length > 0) {
    return { ok: false, code: LLM_RUN_ERRORS.PARSE_ERRORS, errors, blocks: [], tasks: [] };
  }

  if (blocks.length === 0) {
    return { ok: false, code: LLM_RUN_ERRORS.NO_BLOCKS, errors: [], blocks: [], tasks: [] };
  }

  const maxContextChars = (typeof opts?.maxContextChars === "number" && opts.maxContextChars > 0)
    ? Math.floor(opts.maxContextChars) : LLM_DEFAULTS.maxContextChars;

  const tasks = [];
  // Blocks with the same context set share one resolved context string, so it
  // is resolved (and size-checked) once and reused by reference across tasks.
  const contextCache = new Map();
  // One outline per note, identical for every block, so it can sit in the
  // shared request prefix.
  const headings = findNoteHeadings(text, blocks);
  const outline = headings.length ? renderOutline(headings) : "";

  for (const block of blocks) {
    // Dedupe contexts while preserving order
    const seen = new Set();
    const kinds = [];
    for (const k of block.contexts) {
      if (!seen.has(k)) {
        seen.add(k);
        kinds.push(k);
      }
    }

    // Validation pass: all context kinds must be runnable
    const unsupported = kinds.filter(k => !RUNNABLE_CONTEXTS.includes(k));
    if (unsupported.length > 0) {
      return {
        ok: false,
        code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
        errors: [{
          code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
          message: "context '" + kinds.join(", ") + "' is not yet supported by Run LLM (only '" + RUNNABLE_CONTEXTS.join("', '") + "')",
          line: block.lineFrom,
        }],
        blocks,
        tasks: [],
      };
    }

    const contextLabel = kinds.join(", ");
    let contextText = contextCache.get(contextLabel);
    if (contextText === undefined) {
      // Resolution loop: iterate contexts in template order
      const sections = [];
      for (const kind of kinds) {
        const { text, missingReason } = resolveContext(kind, itemData);
        if (missingReason !== null) {
          return {
            ok: false,
            code: LLM_RUN_ERRORS.CONTEXT_MISSING,
            errors: [{
              code: LLM_RUN_ERRORS.CONTEXT_MISSING,
              message: missingReason + " — cannot run with context='" + kinds.join(", ") + "'",
              line: block.lineFrom,
            }],
            blocks,
            tasks: [],
          };
        }
        sections.push("## Context: " + kind + "\n" + text);
      }

      contextText = sections.join("\n\n");

      // Size enforcement on combined context text
      if (contextText.length > maxContextChars) {
        return {
          ok: false,
          code: LLM_RUN_ERRORS.CONTEXT_TOO_LARGE,
          errors: [{
            code: LLM_RUN_ERRORS.CONTEXT_TOO_LARGE,
            message: `context is ${contextText.length} characters, exceeds the configured limit of ${maxContextChars} — reduce the context or raise maxContextChars`,
            line: block.lineFrom,
          }],
          blocks,
          tasks: [],
        };
      }

      contextCache.set(contextLabel, contextText);
    }

    // Prompt rendering
    let rendered;
    try {
      rendered = render(block.body, itemData);
    } catch (e) {
      return {
        ok: false,
        code: LLM_RUN_ERRORS.RENDER_FAILED,
        errors: [{
          code: LLM_RUN_ERRORS.RENDER_FAILED,
          message: "prompt render failed (check template variables)",
          line: block.lineFrom,
          detail: String(e && e.message || e),
        }],
        blocks,
        tasks: [],
      };
    }

    // Message assembly
    // A block writes the section of the nearest heading above it.
    const section = headings.filter((h) => h.line < block.lineFrom).pop()?.text ?? "";
    const messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, contextText, outline, section);
    tasks.push({ block, messages, contextLabel, contextText });
  }

  return { ok: true, code: "ok", errors: [], blocks, tasks };
}

export function applyLLMOutputs(text, blocks, outputs) {
  const lines = String(text ?? "").split("\n");
  const order = blocks.map((b, i) => i).sort((a, b) => blocks[b].lineFrom - blocks[a].lineFrom);
  for (const i of order) {
    const blk = blocks[i];
    const out = String(outputs[i] ?? "");
    const outLines = out.length ? out.split("\n") : [];
    lines.splice(blk.lineFrom, blk.lineTo - blk.lineFrom + 1, ...outLines);
  }
  return lines.join("\n");
}

export function decideLLMAction(md, settings) {
  const { blocks } = parseLLMBlocks(String(md || ""));
  if (blocks.length === 0) return { action: "none", count: 0 };
  if (canAutoRun(settings)) return { action: "run", count: blocks.length };
  return { action: "preserve", count: blocks.length };
}

export async function executeLLMBlocks(text, itemData, settings, fetchFn, onProgress) {
  const s = sanitizeLLMSettings(settings);

  const prepared = prepareLLMRun(text, itemData, { maxContextChars: s.maxContextChars });
  if (!prepared.ok) {
    return { ok: false, code: prepared.code, errors: prepared.errors, blocks: prepared.blocks };
  }

  const url = buildChatCompletionsURL(s.baseURL);
  const headers = buildLLMHeaders(s);
  const { tasks, blocks } = prepared;
  const n = tasks.length;

  const progress = (done) => {
    if (typeof onProgress === "function") {
      try { onProgress(done, n); } catch { /* ignore callback errors */ }
    }
  };
  progress(0);

  // Bounded worker pool (src/llm-pool.js). Blocks are independent, so up to
  // `concurrency` requests run at once; outputs land at their block index,
  // keeping document order. All-or-nothing: the pool stops claiming further
  // blocks after the first rejection, in-flight requests are awaited (Zotero.HTTP
  // cannot abort) and discarded, and the failure with the smallest block index
  // is reported deterministically (results are scanned in ascending order below).
  let done = 0;

  const task = async (i) => {
    const payload = buildChatCompletionsPayload(s, tasks[i].messages);
    const content = parseChatCompletionsResponse(await fetchFn(url, headers, payload, s.timeoutSeconds));
    const res = classifyLLMOutput(content);
    // The model is told to write no headings; this makes it true (ADR-0006).
    // Converted here, so cached outputs, preview and Generate all see it.
    const output = res.ok ? headingsToBold(res.output).trim() : "";
    if (!output) {
      // Tagged so the pool's stop-on-failure semantics cover an empty response
      // exactly like an HTTP rejection, while letting the mapping below tell
      // the two apart.
      const err = new Error("empty LLM response");
      err.code = LLM_RUN_ERRORS.EMPTY_RESPONSE;
      throw err;
    }
    done += 1;
    progress(done);
    return output;
  };

  const results = await runBounded(n, s.concurrency, task, { stopOnFailure: true });

  for (let i = 0; i < n; i++) {
    const r = results[i];
    if (r && !r.ok) {
      if (r.error && r.error.code === LLM_RUN_ERRORS.EMPTY_RESPONSE) {
        return { ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE, blockIndex: i, n };
      }
      return { ok: false, code: LLM_RUN_ERRORS.HTTP_FAILED, error: r.error, blockIndex: i, n };
    }
  }

  const outputs = results.map((r) => r.value);
  const md = applyLLMOutputs(text, blocks, outputs);
  return { ok: true, md, blocks, outputs };
}
