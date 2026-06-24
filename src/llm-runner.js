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
  "what is missing.";

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

export function buildLLMMessages(systemPrompt, taskText, contextText) {
  const task = String(taskText ?? "");
  const ctx = String(contextText ?? "");
  const user = `Task:\n${task}\n\nContext:\n${ctx}`;
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

  for (const block of blocks) {
    // Guard: only single-context blocks are runnable
    if (block.contexts.length !== 1 || !RUNNABLE_CONTEXTS.includes(block.contexts[0])) {
      return {
        ok: false,
        code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
        errors: [{
          code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
          message: "context '" + block.contexts.join(", ") + "' is not yet supported by Run LLM (only '" + RUNNABLE_CONTEXTS.join("', '") + "')",
          line: block.lineFrom,
        }],
        blocks,
        tasks: [],
      };
    }

    // Context resolution — abstract, annotations, or fulltext
    const ctxKind = block.contexts[0];
    let contextText = "";
    let contextLabel = ctxKind;

    if (ctxKind === "abstract") {
      const abstract = String(itemData?.abstractNote ?? "").trim();
      if (abstract === "") {
        return {
          ok: false,
          code: LLM_RUN_ERRORS.CONTEXT_MISSING,
          errors: [{
            code: LLM_RUN_ERRORS.CONTEXT_MISSING,
            message: "abstract is empty for this item — cannot run with context='abstract'",
            line: block.lineFrom,
          }],
          blocks,
          tasks: [],
        };
      }
      contextText = abstract;
    } else if (ctxKind === "annotations") {
      contextText = renderAnnotationsContext(itemData?.annotations || []);
      if (contextText === "") {
        return {
          ok: false,
          code: LLM_RUN_ERRORS.CONTEXT_MISSING,
          errors: [{
            code: LLM_RUN_ERRORS.CONTEXT_MISSING,
            message: "no usable annotations for this item — cannot run with context='annotations'",
            line: block.lineFrom,
          }],
          blocks,
          tasks: [],
        };
      }
    } else if (ctxKind === "fulltext") {
      contextText = renderFulltextContext(itemData);
      if (contextText === "") {
        return {
          ok: false,
          code: LLM_RUN_ERRORS.CONTEXT_MISSING,
          errors: [{
            code: LLM_RUN_ERRORS.CONTEXT_MISSING,
            message: "no extracted full text available for the primary PDF — cannot run with context='fulltext'",
            line: block.lineFrom,
          }],
          blocks,
          tasks: [],
        };
      }
    } else {
      // Unreachable (RUNNABLE_CONTEXTS gate above), but keep defensive.
      return {
        ok: false,
        code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
        errors: [{
          code: LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED,
          message: "context '" + block.contexts.join(", ") + "' is not yet supported by Run LLM (only '" + RUNNABLE_CONTEXTS.join("', '") + "')",
          line: block.lineFrom,
        }],
        blocks,
        tasks: [],
      };
    }

    // maxContextChars enforcement — applies to all context kinds
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
    tasks.push({ block, messages, contextLabel });
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
  const prepared = prepareLLMRun(text, itemData);
  if (!prepared.ok) {
    return { ok: false, code: prepared.code, errors: prepared.errors, blocks: prepared.blocks };
  }

  const s = sanitizeLLMSettings(settings);
  const url = buildChatCompletionsURL(s.baseURL);
  const headers = buildLLMHeaders(s);
  const outputs = [];
  const { tasks, blocks } = prepared;
  const n = tasks.length;

  for (let i = 0; i < n; i++) {
    if (typeof onProgress === "function") {
      try { onProgress(i + 1, n); } catch { /* ignore callback errors */ }
    }
    const payload = buildChatCompletionsPayload(s, tasks[i].messages);
    let content;
    try {
      content = parseChatCompletionsResponse(await fetchFn(url, headers, payload, s.timeoutSeconds));
    } catch (e) {
      return { ok: false, code: LLM_RUN_ERRORS.HTTP_FAILED, error: e, blockIndex: i, n };
    }
    const res = classifyLLMOutput(content);
    if (!res.ok) {
      return { ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE, blockIndex: i, n };
    }
    outputs.push(res.output);
  }

  const md = applyLLMOutputs(text, blocks, outputs);
  return { ok: true, md, blocks };
}
