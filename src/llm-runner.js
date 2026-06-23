// Pure LLM run planner — parses blocks, resolves context, assembles messages,
// normalizes output, applies replacements. No DOM, no Zotero, no fetch.

import { parseLLMBlocks } from "./llm-blocks.js";
import { render } from "./render.js";

export const GROUNDING_SYSTEM_PROMPT =
  "You are a research assistant embedded in a Zotero literature note. " +
  "Complete the task given in the user message and output only Markdown that " +
  "fulfills it. Ground your answer strictly in the context provided in the user " +
  "message; do not introduce facts, interpretations, or citations that are not " +
  "present there. Output only the task result — no preface, no commentary, no " +
  "explanation outside the requested content. If the provided context is not " +
  "sufficient to complete the task, respond with a brief Markdown note stating " +
  "what is missing.";

export const RUNNABLE_CONTEXTS = ["abstract"];

export const LLM_RUN_ERRORS = {
  NO_BLOCKS: "llm.run.noBlocks",
  PARSE_ERRORS: "llm.run.parseErrors",
  CONTEXT_UNSUPPORTED: "llm.run.contextUnsupported",
  CONTEXT_MISSING: "llm.run.contextMissing",
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

export function prepareLLMRun(text, itemData) {
  const { blocks, errors } = parseLLMBlocks(text);

  if (errors.length > 0) {
    return { ok: false, code: LLM_RUN_ERRORS.PARSE_ERRORS, errors, blocks: [], tasks: [] };
  }

  if (blocks.length === 0) {
    return { ok: false, code: LLM_RUN_ERRORS.NO_BLOCKS, errors: [], blocks: [], tasks: [] };
  }

  const tasks = [];

  for (const block of blocks) {
    // Context resolution — abstract only this slice
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

    // Abstract resolution
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
    const messages = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, rendered, abstract);
    tasks.push({ block, messages, contextLabel: "abstract" });
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
