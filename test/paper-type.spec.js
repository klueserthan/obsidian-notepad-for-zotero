import { describe, it, expect, vi } from "vitest";
import {
  buildDetectMessages,
  parseDetectAnswer,
  detectPaperTypes,
  DETECT_REASONS,
} from "../src/paper-type.js";

// Helper mirroring test/llm-runner.spec.js's makeFetch: each element is
// content to wrap in a chat-completions JSON response, or an Error to throw
// as the HTTP failure for that call.
const makeFetch = (responses) => {
  let i = 0;
  return async (_url, _headers, _payload, _timeout) => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return JSON.stringify({ choices: [{ message: { content: r } }] });
  };
};

const candidates = [
  { name: "quant", label: "Quantitative", description: "Uses statistical analysis of large-N data" },
  { name: "qual", label: "Qualitative", description: "Uses interviews or case studies" },
  { name: "theory", label: "Theoretical", description: "Develops formal theory" },
  { name: "review", label: "Review", description: "Surveys existing literature" },
];

const rows = [
  { key: "r1", title: "Survey A", abstractNote: "A large-N survey of voters." },
  { key: "r2", title: "Survey B", abstractNote: "A regression analysis of panel data." },
  { key: "r3", title: "Interview A", abstractNote: "In-depth interviews with elites." },
  { key: "r4", title: "Interview B", abstractNote: "A case study using interviews." },
  { key: "r5", title: "Lit review", abstractNote: "A systematic review of the literature." },
];

describe("parseDetectAnswer", () => {
  it("reply '0' names no candidate", () => {
    expect(parseDetectAnswer("0", 4)).toEqual({ none: true });
  });

  it("reply '7' with four candidates is invalid (out of range)", () => {
    expect(parseDetectAnswer("7", 4)).toEqual({ invalid: true });
  });

  it("reply 'Option 2 fits best' extracts index 2", () => {
    expect(parseDetectAnswer("Option 2 fits best", 4)).toEqual({ index: 2 });
  });

  it("reply with two integers is invalid", () => {
    expect(parseDetectAnswer("None of the 4 fit: 0", 4)).toEqual({ invalid: true });
  });

  it("empty reply is invalid", () => {
    expect(parseDetectAnswer("", 4)).toEqual({ invalid: true });
  });
});

describe("buildDetectMessages", () => {
  it("lists every candidate's label and description in numbered order, then title and abstract", () => {
    const messages = buildDetectMessages(candidates, { title: "My Title", abstractNote: "My Abstract" });
    const user = messages.find((m) => m.role === "user").content;
    expect(user.indexOf("1. Quantitative")).toBeGreaterThanOrEqual(0);
    expect(user.indexOf("1. Quantitative")).toBeLessThan(user.indexOf("2. Qualitative"));
    expect(user.indexOf("2. Qualitative")).toBeLessThan(user.indexOf("3. Theoretical"));
    expect(user.indexOf("3. Theoretical")).toBeLessThan(user.indexOf("4. Review"));
    for (const c of candidates) {
      expect(user).toContain(c.label);
      expect(user).toContain(c.description);
    }
    expect(user).toContain("My Title");
    expect(user).toContain("My Abstract");
  });
});

describe("detectPaperTypes", () => {
  it("AE1: five rows, four candidates, fetchFn answering 1,1,2,2,4 report the matching template and label per row", async () => {
    const fetch = makeFetch(["1", "1", "2", "2", "4"]);
    const results = {};
    await detectPaperTypes(rows, candidates, {}, fetch, (key, result) => { results[key] = result; });
    expect(results.r1).toEqual({ templateName: "quant", label: "Quantitative" });
    expect(results.r2).toEqual({ templateName: "quant", label: "Quantitative" });
    expect(results.r3).toEqual({ templateName: "qual", label: "Qualitative" });
    expect(results.r4).toEqual({ templateName: "qual", label: "Qualitative" });
    expect(results.r5).toEqual({ templateName: "review", label: "Review" });
  });

  it("AE2: an empty abstract gets no-abstract without calling fetchFn", async () => {
    const fetch = vi.fn(makeFetch(["1"]));
    const emptyRows = [
      { key: "empty", title: "No abstract", abstractNote: "   " },
      { key: "ok", title: "Has abstract", abstractNote: "A survey of voters." },
    ];
    const results = {};
    await detectPaperTypes(emptyRows, candidates, {}, fetch, (key, result) => { results[key] = result; });
    expect(results.empty).toEqual({ reason: DETECT_REASONS.NO_ABSTRACT });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("AE3: fetchFn rejects for the third row only; other rows succeed; fetchFn called once per non-empty row", async () => {
    const fetch = vi.fn(makeFetch(["1", "2", new Error("Connection refused"), "4", "1"]));
    const results = {};
    await detectPaperTypes(rows, candidates, {}, fetch, (key, result) => { results[key] = result; });
    expect(results.r1).toEqual({ templateName: "quant", label: "Quantitative" });
    expect(results.r2).toEqual({ templateName: "qual", label: "Qualitative" });
    expect(results.r3.reason).toBe(DETECT_REASONS.HTTP_FAILED);
    expect(results.r3.detail).toBe("Connection refused");
    expect(results.r4).toEqual({ templateName: "review", label: "Review" });
    expect(results.r5).toEqual({ templateName: "quant", label: "Quantitative" });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("an abstract longer than maxContextChars is truncated in the user message", async () => {
    const longAbstract = "x".repeat(50);
    const captured = [];
    const fetch = async (url, headers, payload) => {
      captured.push(payload);
      return JSON.stringify({ choices: [{ message: { content: "1" } }] });
    };
    await detectPaperTypes(
      [{ key: "r1", title: "T", abstractNote: longAbstract }],
      candidates,
      { maxContextChars: 10 },
      fetch,
      () => {},
    );
    const userMsg = captured[0].messages.find((m) => m.role === "user").content;
    expect(userMsg).toContain("x".repeat(10));
    expect(userMsg).not.toContain("x".repeat(11));
  });

  it("shouldStop returning true after the first row settles leaves remaining rows with no call and no onRow result", async () => {
    const fetch = vi.fn(makeFetch(["1", "2", "3"]));
    const onRow = vi.fn();
    let settled = 0;
    const shouldStop = () => settled >= 1;
    await detectPaperTypes(
      rows.slice(0, 3),
      candidates,
      { concurrency: 1 },
      async (...args) => {
        const out = await fetch(...args);
        settled += 1;
        return out;
      },
      onRow,
      { shouldStop },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledWith("r1", { templateName: "quant", label: "Quantitative" });
  });

  it("user message contains every candidate's label/description and the row's title/abstract (via fetchFn payload)", async () => {
    const captured = [];
    const fetch = async (url, headers, payload) => {
      captured.push(payload);
      return JSON.stringify({ choices: [{ message: { content: "1" } }] });
    };
    await detectPaperTypes(
      [{ key: "r1", title: "Distinct Title", abstractNote: "Distinct abstract text." }],
      candidates,
      {},
      fetch,
      () => {},
    );
    const userMsg = captured[0].messages.find((m) => m.role === "user").content;
    expect(userMsg).toContain("Distinct Title");
    expect(userMsg).toContain("Distinct abstract text.");
    for (const c of candidates) {
      expect(userMsg).toContain(c.label);
      expect(userMsg).toContain(c.description);
    }
  });

  it("concurrency 1 with three rows runs strictly sequentially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetch = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return JSON.stringify({ choices: [{ message: { content: "1" } }] });
    };
    await detectPaperTypes(rows.slice(0, 3), candidates, { concurrency: 1 }, fetch, () => {});
    expect(maxInFlight).toBe(1);
  });

  it("empty candidate list resolves every row with no-candidate without calling fetchFn", async () => {
    const fetch = vi.fn(makeFetch(["1", "2", "3", "4", "1"]));
    const results = {};
    await detectPaperTypes(rows, [], {}, fetch, (key, result) => { results[key] = result; });
    for (const row of rows) {
      expect(results[row.key]).toEqual({ reason: DETECT_REASONS.NO_CANDIDATE });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
