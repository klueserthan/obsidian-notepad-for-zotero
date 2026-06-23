import { describe, it, expect } from "vitest";
import {
  GROUNDING_SYSTEM_PROMPT,
  RUNNABLE_CONTEXTS,
  LLM_RUN_ERRORS,
  buildLLMMessages,
  normalizeLLMOutput,
  classifyLLMOutput,
  prepareLLMRun,
  applyLLMOutputs,
} from "../src/llm-runner.js";
import { parseLLMBlocks } from "../src/llm-blocks.js";
import { item } from "./fixtures/data.js";

// ---------------------------------------------------------------------------
// GROUNDING_SYSTEM_PROMPT
// ---------------------------------------------------------------------------
describe("GROUNDING_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof GROUNDING_SYSTEM_PROMPT).toBe("string");
    expect(GROUNDING_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("instructs: research assistant, markdown only, grounded in context, no commentary", () => {
    expect(GROUNDING_SYSTEM_PROMPT).toContain("research assistant");
    expect(GROUNDING_SYSTEM_PROMPT).toContain("Markdown");
    expect(GROUNDING_SYSTEM_PROMPT).toContain("context");
    const hasNoPrefaceOrCommentary =
      GROUNDING_SYSTEM_PROMPT.includes("no preface") ||
      GROUNDING_SYSTEM_PROMPT.includes("no commentary");
    expect(hasNoPrefaceOrCommentary).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RUNNABLE_CONTEXTS
// ---------------------------------------------------------------------------
describe("RUNNABLE_CONTEXTS", () => {
  it('equals ["abstract"] for this slice', () => {
    expect(RUNNABLE_CONTEXTS).toEqual(["abstract"]);
  });
});

// ---------------------------------------------------------------------------
// buildLLMMessages
// ---------------------------------------------------------------------------
describe("buildLLMMessages", () => {
  it("returns a system message + a user message (length 2)", () => {
    const msgs = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "task", "context");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("system content === GROUNDING_SYSTEM_PROMPT", () => {
    const msgs = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "task", "context");
    expect(msgs[0].content).toBe(GROUNDING_SYSTEM_PROMPT);
  });

  it('user content has a "Task:" section containing the task text', () => {
    const msgs = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "Summarize this text", "ctx");
    expect(msgs[1].content).toContain("Task:");
    expect(msgs[1].content).toContain("Summarize this text");
  });

  it('user content has a "Context:" section containing the context text', () => {
    const msgs = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "task", "abstract here");
    expect(msgs[1].content).toContain("Context:");
    expect(msgs[1].content).toContain("abstract here");
  });

  it("separates Task and Context with a blank line", () => {
    const msgs = buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "task", "context");
    expect(msgs[1].content).toContain("\n\nContext:\n");
  });

  it("handles empty task/context without throwing (still two messages)", () => {
    expect(() => buildLLMMessages(GROUNDING_SYSTEM_PROMPT, "", "")).not.toThrow();
    expect(() => buildLLMMessages(GROUNDING_SYSTEM_PROMPT, null, undefined)).not.toThrow();
    expect(buildLLMMessages(GROUNDING_SYSTEM_PROMPT, null, undefined)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// normalizeLLMOutput
// ---------------------------------------------------------------------------
describe("normalizeLLMOutput", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeLLMOutput("  hello  ")).toBe("hello");
    expect(normalizeLLMOutput("\nhello\n")).toBe("hello");
  });

  it("normalizes CRLF → LF", () => {
    expect(normalizeLLMOutput("line1\r\nline2\r\n")).toBe("line1\nline2");
  });

  it("normalizes lone CR → LF", () => {
    expect(normalizeLLMOutput("line1\rline2\r")).toBe("line1\nline2");
  });

  it("preserves internal whitespace and blank lines", () => {
    const result = normalizeLLMOutput("  line1\n\n  line2  ");
    expect(result).toBe("line1\n\n  line2");
  });

  it('returns "" for null/undefined/whitespace-only input', () => {
    expect(normalizeLLMOutput(null)).toBe("");
    expect(normalizeLLMOutput(undefined)).toBe("");
    expect(normalizeLLMOutput("   ")).toBe("");
    expect(normalizeLLMOutput("\n\n")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// classifyLLMOutput
// ---------------------------------------------------------------------------
describe("classifyLLMOutput", () => {
  it('returns {ok:false, code: EMPTY_RESPONSE} for "" / whitespace', () => {
    expect(classifyLLMOutput("")).toEqual({ ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE });
    expect(classifyLLMOutput("   ")).toEqual({ ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE });
    expect(classifyLLMOutput("\n\n")).toEqual({ ok: false, code: LLM_RUN_ERRORS.EMPTY_RESPONSE });
  });

  it("returns {ok:true, output} for non-empty content, output normalized", () => {
    const result = classifyLLMOutput("Hello world");
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Hello world");
  });

  it("output is trimmed + CRLF-normalized", () => {
    const result = classifyLLMOutput("  Hello\r\nWorld  ");
    expect(result.ok).toBe(true);
    expect(result.output).toBe("Hello\nWorld");
  });
});

// ---------------------------------------------------------------------------
// applyLLMOutputs
// ---------------------------------------------------------------------------
describe("applyLLMOutputs", () => {
  it("replaces a single multi-line block with the output lines", () => {
    const text = ["line0", '{% llm context="abstract" %}', "body", "{% endllm %}", "line4"].join("\n");
    const blocks = [{ openRaw: '{% llm context="abstract" %}', closeRaw: "{% endllm %}", contextArg: 'context="abstract"', contexts: ["abstract"], body: "body", lineFrom: 1, lineTo: 3 }];
    const outputs = ["output line 1\noutput line 2"];
    const result = applyLLMOutputs(text, blocks, outputs);
    expect(result).toBe("line0\noutput line 1\noutput line 2\nline4");
  });

  it("replaces a single-line block (lineFrom === lineTo)", () => {
    const text = ['before', '{% llm context="abstract" %}body{% endllm %}', 'after'].join("\n");
    const blocks = [{ openRaw: '{% llm context="abstract" %}', closeRaw: "{% endllm %}", contextArg: 'context="abstract"', contexts: ["abstract"], body: "body", lineFrom: 1, lineTo: 1 }];
    const outputs = ["replacement"];
    const result = applyLLMOutputs(text, blocks, outputs);
    expect(result).toBe("before\nreplacement\nafter");
  });

  it("replaces multiple blocks in one pass and preserves surrounding prose", () => {
    const text = [
      "start",
      '{% llm context="abstract" %}',
      "first body",
      "{% endllm %}",
      "middle",
      '{% llm context="abstract" %}',
      "second body",
      "{% endllm %}",
      "end",
    ].join("\n");
    const blocks = [
      { openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "first body", lineFrom: 1, lineTo: 3 },
      { openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "second body", lineFrom: 5, lineTo: 7 },
    ];
    const outputs = ["FIRST", "SECOND"];
    const result = applyLLMOutputs(text, blocks, outputs);
    expect(result).toBe("start\nFIRST\nmiddle\nSECOND\nend");
  });

  it("applies blocks last-to-first so earlier line offsets stay valid", () => {
    // Two blocks: first block at line 1-3, second at line 5-7.
    // First block's output is multi-line to test offset safety.
    const text = [
      "start",
      '{% llm context="abstract" %}',
      "first body",
      "{% endllm %}",
      "middle",
      '{% llm context="abstract" %}',
      "second body",
      "{% endllm %}",
      "end",
    ].join("\n");
    const blocks = [
      { openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "first body", lineFrom: 1, lineTo: 3 },
      { openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "second body", lineFrom: 5, lineTo: 7 },
    ];
    // First block output is multi-line; second is single-line.
    const outputs = ["FIRST\nmulti\nline", "SECOND"];
    const result = applyLLMOutputs(text, blocks, outputs);
    const lines = result.split("\n");
    expect(lines[0]).toBe("start");
    expect(lines[1]).toBe("FIRST");
    expect(lines[2]).toBe("multi");
    expect(lines[3]).toBe("line");
    expect(lines[4]).toBe("middle");
    expect(lines[5]).toBe("SECOND");
    expect(lines[6]).toBe("end");
  });

  it("an empty output removes the block's lines entirely", () => {
    const text = ["line0", '{% llm context="abstract" %}', "body", "{% endllm %}", "line4"].join("\n");
    const blocks = [{ openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "body", lineFrom: 1, lineTo: 3 }];
    const outputs = [""];
    const result = applyLLMOutputs(text, blocks, outputs);
    expect(result).toBe("line0\nline4");
  });

  it("is a pure function (does not mutate input text)", () => {
    const text = ["a", '{% llm context="abstract" %}', "body", "{% endllm %}", "b"].join("\n");
    const original = text;
    const blocks = [{ openRaw: "", closeRaw: "", contextArg: 'context="abstract"', contexts: ["abstract"], body: "body", lineFrom: 1, lineTo: 3 }];
    const outputs = ["output"];
    applyLLMOutputs(text, blocks, outputs);
    expect(text).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — abstract success
// ---------------------------------------------------------------------------
describe("prepareLLMRun — abstract success", () => {
  it("returns {ok:true} with one task for a single abstract block", () => {
    const text = ['{% llm context="abstract" %}', "Summarize this.", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("ok");
    expect(result.tasks).toHaveLength(1);
    expect(result.blocks).toHaveLength(1);
  });

  it("task.messages is [system, user] from buildLLMMessages", () => {
    const text = ['{% llm context="abstract" %}', "task body", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.tasks[0].messages).toHaveLength(2);
    expect(result.tasks[0].messages[0].role).toBe("system");
    expect(result.tasks[0].messages[0].content).toBe(GROUNDING_SYSTEM_PROMPT);
    expect(result.tasks[0].messages[1].role).toBe("user");
  });

  it("user message Context section contains item.abstractNote", () => {
    const text = ['{% llm context="abstract" %}', "task", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.tasks[0].messages[1].content).toContain("Context:");
    expect(result.tasks[0].messages[1].content).toContain(item.abstractNote);
  });

  it("blocks array matches parseLLMBlocks output (length + lineFrom/lineTo)", () => {
    const text = ["prose", '{% llm context="abstract" %}', "body", "{% endllm %}", "more"].join("\n");
    const parsed = parseLLMBlocks(text);
    const result = prepareLLMRun(text, item);
    expect(result.blocks).toHaveLength(parsed.blocks.length);
    expect(result.blocks[0].lineFrom).toBe(parsed.blocks[0].lineFrom);
    expect(result.blocks[0].lineTo).toBe(parsed.blocks[0].lineTo);
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — prompt rendering
// ---------------------------------------------------------------------------
describe("prepareLLMRun — prompt rendering", () => {
  it("renders {{title}} inside the prompt body against itemData", () => {
    const text = ['{% llm context="abstract" %}', "{{title}}", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const userContent = result.tasks[0].messages[1].content;
    expect(userContent).toContain("Thinking in Networks");
    expect(userContent).not.toContain("{{title}}");
  });

  it("renders {% for %} loops over creators", () => {
    const body = "{% for c in creators %}{{c.lastName}}{% if not loop.last %}, {% endif %}{% endfor %}";
    const text = ['{% llm context="abstract" %}', body, "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const userContent = result.tasks[0].messages[1].content;
    expect(userContent).toContain("Doe, Smith");
  });

  it("renders {% if %} conditionals", () => {
    const text = ['{% llm context="abstract" %}', '{% if abstractNote %}has abstract{% endif %}', "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const userContent = result.tasks[0].messages[1].content;
    expect(userContent).toContain("has abstract");
  });

  it("rendered prompt appears in the user message Task section, not the raw template", () => {
    const text = ['{% llm context="abstract" %}', "{{title}} - {{date}}", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const userContent = result.tasks[0].messages[1].content;
    // Task section has rendered values, not raw nunjucks
    const taskSection = userContent.split("\n\nContext:\n")[0];
    expect(taskSection).toContain("Thinking in Networks - 2023-04-15");
    expect(taskSection).not.toContain("{{title}}");
  });

  it("a block body with no variables passes through unchanged", () => {
    const text = ['{% llm context="abstract" %}', "Just some plain text.", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const userContent = result.tasks[0].messages[1].content;
    expect(userContent).toContain("Just some plain text.");
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — missing abstract failure
// ---------------------------------------------------------------------------
describe("prepareLLMRun — missing abstract failure", () => {
  it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is ''", () => {
    const text = ['{% llm context="abstract" %}', "task", "{% endllm %}"].join("\n");
    const data = { ...item, abstractNote: "" };
    const result = prepareLLMRun(text, data);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_MISSING);
  });

  it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is whitespace", () => {
    const text = ['{% llm context="abstract" %}', "task", "{% endllm %}"].join("\n");
    const data = { ...item, abstractNote: "   " };
    const result = prepareLLMRun(text, data);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_MISSING);
  });

  it("returns {ok:false, code: CONTEXT_MISSING} when abstractNote is undefined", () => {
    const text = ['{% llm context="abstract" %}', "task", "{% endllm %}"].join("\n");
    const data = { ...item };
    delete data.abstractNote;
    const result = prepareLLMRun(text, data);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_MISSING);
  });

  it("error.message is static and does not include the prompt body", () => {
    const text = ['{% llm context="abstract" %}', "secret prompt body", "{% endllm %}"].join("\n");
    const data = { ...item, abstractNote: "" };
    const result = prepareLLMRun(text, data);
    expect(result.errors[0].message).not.toContain("secret prompt body");
    expect(result.errors[0].message).toContain("abstract is empty");
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — context unsupported
// ---------------------------------------------------------------------------
describe("prepareLLMRun — context unsupported", () => {
  it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for context='annotations'", () => {
    const text = '{% llm context="annotations" %}prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED);
  });

  it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for context='fulltext'", () => {
    const text = '{% llm context="fulltext" %}prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED);
  });

  it("returns {ok:false, code: CONTEXT_UNSUPPORTED} for multi-context", () => {
    // "abstract,annotations" parses without error but has contexts.length !== 1
    const text = '{% llm context="abstract,annotations" %}prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED);
  });

  it("error.message names the unsupported context but not the prompt body", () => {
    const text = '{% llm context="annotations" %}secret prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.errors[0].message).toContain("annotations");
    expect(result.errors[0].message).not.toContain("secret prompt");
  });

  it("error.message names the actual contexts in a multi-context block, not the raw arg", () => {
    const text = '{% llm context="abstract,annotations" %}prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED);
    expect(result.errors[0].message).toContain("abstract, annotations");
    expect(result.errors[0].message).not.toContain('context="');
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — no blocks
// ---------------------------------------------------------------------------
describe("prepareLLMRun — no blocks", () => {
  it("returns {ok:false, code: NO_BLOCKS} for plain text with no LLM tags", () => {
    const result = prepareLLMRun("Just some plain markdown.", item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.NO_BLOCKS);
  });

  it("returns {ok:false, code: NO_BLOCKS} for an empty string", () => {
    const result = prepareLLMRun("", item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.NO_BLOCKS);
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — parse errors
// ---------------------------------------------------------------------------
describe("prepareLLMRun — parse errors", () => {
  it("returns {ok:false, code: PARSE_ERRORS} for an unclosed block", () => {
    const text = ['{% llm context="abstract" %}', "body without endllm"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.PARSE_ERRORS);
  });

  it("returns {ok:false, code: PARSE_ERRORS} for an unknown context", () => {
    const text = '{% llm context="summary" %}prompt{% endllm %}';
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.PARSE_ERRORS);
  });

  it("carries the first error's line number", () => {
    const text = ["good line", '{% llm context="abstract" %}', "oops"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].line).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — render failure
// ---------------------------------------------------------------------------
describe("prepareLLMRun — render failure", () => {
  it("returns {ok:false, code: RENDER_FAILED} for a malformed nunjucks body", () => {
    // Malformed nunjucks — a for loop without the required arguments
    const text = ['{% llm context="abstract" %}', '{% for x in %}', "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.RENDER_FAILED);
  });

  it("error.message is a static string (does not leak the body / nunjucks snippet)", () => {
    const text = ['{% llm context="abstract" %}', '{% for x in %}', "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.errors[0].message).not.toContain("{% for x in %}");
    expect(result.errors[0].message).toContain("prompt render failed");
  });

  it("error.detail carries the raw nunjucks message for debug logging", () => {
    const text = ['{% llm context="abstract" %}', '{% for x in %}', "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.errors[0]).toHaveProperty("detail");
    expect(typeof result.errors[0].detail).toBe("string");
    expect(result.errors[0].detail.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// prepareLLMRun — all-or-nothing pre-flight
// ---------------------------------------------------------------------------
describe("prepareLLMRun — all-or-nothing pre-flight", () => {
  it("aborts the whole run when the 2nd of 2 blocks is unsupported (tasks: [])", () => {
    const text = [
      '{% llm context="abstract" %}',
      "first",
      "{% endllm %}",
      "prose",
      '{% llm context="annotations" %}',
      "second",
      "{% endllm %}",
    ].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_UNSUPPORTED);
    expect(result.tasks).toEqual([]);
  });

  it("aborts the whole run when the 1st of 2 blocks has a missing abstract", () => {
    const text = [
      '{% llm context="abstract" %}',
      "first",
      "{% endllm %}",
      "prose",
      '{% llm context="abstract" %}',
      "second",
      "{% endllm %}",
    ].join("\n");
    const dataNoAbstract = { ...item, abstractNote: "" };
    const result = prepareLLMRun(text, dataNoAbstract);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(LLM_RUN_ERRORS.CONTEXT_MISSING);
    expect(result.tasks).toEqual([]);
  });

  it("never returns a partial task list", () => {
    // Two blocks where the second one fails; tasks must be empty.
    const text = [
      '{% llm context="abstract" %}',
      "valid",
      "{% endllm %}",
      "prose",
      '{% llm context="annotations" %}',
      "invalid",
      "{% endllm %}",
    ].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(false);
    expect(result.tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// provider message assembly
// ---------------------------------------------------------------------------
describe("provider message assembly", () => {
  it("a prepared abstract task yields messages with the grounded system prompt", () => {
    const text = ['{% llm context="abstract" %}', "do something", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    expect(result.tasks[0].messages[0].content).toBe(GROUNDING_SYSTEM_PROMPT);
  });

  it("the user message is exactly 'Task:\\n<prompt>\\n\\nContext:\\n<abstract>'", () => {
    const text = ['{% llm context="abstract" %}', "Summarize this.", "{% endllm %}"].join("\n");
    const result = prepareLLMRun(text, item);
    expect(result.ok).toBe(true);
    const expected = "Task:\nSummarize this.\n\nContext:\n" + item.abstractNote;
    expect(result.tasks[0].messages[1].content).toBe(expected);
  });
});
