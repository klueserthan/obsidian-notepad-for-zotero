// Pure LLM run planner — parses blocks, resolves context, assembles messages,
// normalizes output, applies replacements. No DOM, no Zotero, no fetch.

import { parseLLMBlocks } from "./llm-blocks.js";
import { renderAnnotationsContext } from "./annotations.js";
import { renderFulltextContext } from "./fulltext.js";
import { LLM_DEFAULTS } from "./llm.js";
import { render } from "./render.js";
import {
  canAutoRun,
  sanitizeLLMSettings,
  buildChatCompletionsURL,
  buildLLMHeaders,
  buildChatCompletionsPayload,
  parseChatCompletionsResponse,
} from "./llm.js";

export const GROUNDING_SYSTEM_PROMPT =
  "You are a research assistant embedded in a Zotero literature note. " +
  "Complete the task given in the user message and output only Markdown that " +
  "fulfills it. Ground your answer strictly in the context provided in the user " +
  "message; do not introduce facts, interpretations, or citations that are not " +
  "present there. Output only the task result — no preface, no commentary, no " +
  "explanation outside the requested content. If the provided context is not " +
  "sufficient to complete the task, respond with a brief Markdown note stating " +
  "what is missing. The user message provides the context first, followed by " +
  "the task.";

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
// their tail — the system prompt + context form a byte-identical prefix that
// OpenAI-compatible servers can reuse via automatic prefix/prompt caching.
export function buildLLMMessages(systemPrompt, taskText, contextText) {
  const task = String(taskText ?? "");
  const ctx = String(contextText ?? "");
  const user = `Context:\n${ctx}\n\nTask:\n${task}`;
  return [
    { role: "system", content: String(systemPrompt ?? "") },
    { role: "user", content: user },
  ];
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
    const messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, contextText);
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
  const outputs = new Array(n);

  const progress = (done) => {
    if (typeof onProgress === "function") {
      try { onProgress(done, n); } catch { /* ignore callback errors */ }
    }
  };
  progress(0);

  // Bounded worker pool. Blocks are independent, so up to `concurrency` requests
  // run at once; outputs land at their block index, keeping document order.
  // All-or-nothing: the first failure stops workers from claiming further blocks,
  // in-flight requests are awaited (Zotero.HTTP cannot abort) and discarded, and
  // the failure with the smallest block index is reported deterministically.
  let next = 0;
  let done = 0;
  let failure = null;

  const worker = async () => {
    while (failure === null && next < n) {
      const i = next++;
      const payload = buildChatCompletionsPayload(s, tasks[i].messages);
      let content;
      try {
        content = parseChatCompletionsResponse(await fetchFn(url, headers, payload, s.timeoutSeconds));
      } catch (e) {
        if (failure === null || i < failure.blockIndex) {
          failure = { ok: false, code: LLM_RUN_ERRORS.HTTP_FAILED, error: e, blockIndex: i, n };
        }
        return;
      }
      const res = classifyLLMOutput(content);
      if (!res.ok) {
        if (failure === null || i < failure.blockIndex) {
          failure = { ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE, blockIndex: i, n };
        }
        return;
      }
      outputs[i] = res.output;
      done += 1;
      progress(done);
    }
  };

  const workers = [];
  for (let w = 0; w < Math.min(s.concurrency, n); w++) workers.push(worker());
  await Promise.all(workers);

  if (failure !== null) return failure;

  const md = applyLLMOutputs(text, blocks, outputs);
  return { ok: true, md, blocks, outputs };
}
