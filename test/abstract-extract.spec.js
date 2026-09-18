import { describe, it, expect, vi } from "vitest";
import {
  ABSTRACT_TAG,
  ABSTRACT_REASONS,
  MAX_SLICE_CHARS,
  buildExtractMessages,
  parseExtractAnswer,
  normalizeForContainment,
  collapseWhitespace,
  containsVerbatim,
  extractAbstract,
} from "../src/abstract-extract.js";
import { sanitizeTriggerTag } from "../src/auto-summary.js";

// Mirrors test/paper-type.spec.js's makeFetch: each element is content to
// wrap in a chat-completions JSON response (an object lets a test set
// finish_reason too), or an Error to throw as the HTTP failure for that call.
const makeFetch = (responses) => {
  let i = 0;
  return async (_url, _headers, _payload, _timeout) => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    if (typeof r === "object" && r !== null && "content" in r) {
      return JSON.stringify({
        choices: [{ message: { content: r.content }, finish_reason: r.finishReason ?? "stop" }],
      });
    }
    return JSON.stringify({ choices: [{ message: { content: r }, finish_reason: "stop" }] });
  };
};

const ABSTRACT_TEXT =
  "This paper studies the effect of electoral reform on voter turnout using " +
  "a large panel of municipal elections across two decades and finds " +
  "consistent, statistically significant increases following reform.";

describe("parseExtractAnswer", () => {
  it("NONE is reported before any stripping", () => {
    expect(parseExtractAnswer("NONE")).toEqual({ none: true });
  });

  it("empty or whitespace-only answer is none", () => {
    expect(parseExtractAnswer("")).toEqual({ none: true });
    expect(parseExtractAnswer("   ")).toEqual({ none: true });
  });

  it("strips wrapping double quotes", () => {
    expect(parseExtractAnswer(`"${ABSTRACT_TEXT}"`)).toEqual({ answer: ABSTRACT_TEXT });
  });

  it("strips a leading 'Abstract:' label", () => {
    expect(parseExtractAnswer(`Abstract: ${ABSTRACT_TEXT}`)).toEqual({ answer: ABSTRACT_TEXT });
  });

  it("strips a bare heading on its own line or in all caps", () => {
    expect(parseExtractAnswer(`ABSTRACT\n${ABSTRACT_TEXT}`)).toEqual({ answer: ABSTRACT_TEXT });
    expect(parseExtractAnswer(`Abstract\n${ABSTRACT_TEXT}`)).toEqual({ answer: ABSTRACT_TEXT });
    expect(parseExtractAnswer(`ABSTRACT ${ABSTRACT_TEXT}`)).toEqual({ answer: ABSTRACT_TEXT });
  });

  it("keeps a leading 'Abstract' that is part of the first sentence", () => {
    const text = `Abstract interpretation ${ABSTRACT_TEXT}`;
    expect(parseExtractAnswer(text)).toEqual({ answer: text });
  });

  it("strips a leading 'ABSTRACT.' label", () => {
    expect(parseExtractAnswer(`ABSTRACT. ${ABSTRACT_TEXT}`)).toEqual({ answer: ABSTRACT_TEXT });
  });

  it("NONE inside a longer reply is not treated as the sentinel", () => {
    expect(parseExtractAnswer("NONE of this is relevant, here: " + ABSTRACT_TEXT))
      .toEqual({ answer: "NONE of this is relevant, here: " + ABSTRACT_TEXT });
  });
});

describe("collapseWhitespace (the saved value)", () => {
  it("joins line-break hyphenation and collapses whitespace, keeping same-line dashes", () => {
    expect(collapseWhitespace("inter-\nnational  results - here\n")).toBe("international results - here");
  });
});

describe("normalizeForContainment", () => {
  it("folds ligatures", () => {
    expect(normalizeForContainment("classiﬁcation")).toBe("classification");
  });

  it("keeps subscripts and superscripts, so CO₂ never matches CO2", () => {
    expect(normalizeForContainment("CO₂ and 10²")).toBe("CO₂ and 10²");
  });

  it("drops soft hyphens", () => {
    expect(normalizeForContainment("clas­sification")).toBe("classification");
  });

  it("keeps a same-line hyphen, so an answer that drops it does not match", () => {
    expect(normalizeForContainment("results - especially")).toBe("results - especially");
    expect(containsVerbatim("the results - especially the strong ones", "the results especially the strong ones", false)).toBe(false);
  });

  it("joins line-break hyphenation", () => {
    expect(normalizeForContainment("clas-\nsification")).toBe("classification");
  });

  it("collapses whitespace", () => {
    expect(normalizeForContainment("a   b\n\nc")).toBe("a b c");
  });

  it("is case-sensitive", () => {
    expect(normalizeForContainment("Abstract")).toBe("Abstract");
  });
});

describe("containsVerbatim", () => {
  it("finds a clean answer in the slice", () => {
    expect(containsVerbatim(ABSTRACT_TEXT, ABSTRACT_TEXT, false)).toBe(true);
  });

  it("finds an answer despite hyphenation, soft hyphens, and ligatures in the source", () => {
    const source = "This paper studies clas-\nsi­ﬁcation of voters.";
    const answer = "This paper studies classification of voters.";
    expect(containsVerbatim(source, answer, false)).toBe(true);
  });

  it("rejects a match ending within the last 200 normalized chars of a truncated slice", () => {
    const padding = "x".repeat(50);
    const slice = padding + ABSTRACT_TEXT; // match ends at the very end of the slice
    expect(containsVerbatim(slice, ABSTRACT_TEXT, true)).toBe(false);
  });

  it("accepts the same match when the slice is not truncated (whole text fit)", () => {
    const padding = "x".repeat(50);
    const slice = padding + ABSTRACT_TEXT;
    expect(containsVerbatim(slice, ABSTRACT_TEXT, false)).toBe(true);
  });

  it("accepts a match well before the end of a truncated slice", () => {
    const trailing = "y".repeat(500);
    const slice = ABSTRACT_TEXT + trailing;
    expect(containsVerbatim(slice, ABSTRACT_TEXT, true)).toBe(true);
  });
});

describe("extractAbstract", () => {
  it("an answer copied exactly from the source is verified with collapsed whitespace", async () => {
    const messy = "This   paper studies\nthe effect of electoral reform on\nvoter turnout using a large panel of municipal elections held over two decades.";
    const source = "This   paper studies\nthe effect of electoral reform on\nvoter turnout using a large panel of municipal elections held over two decades.";
    const fetch = makeFetch([messy]);
    const result = await extractAbstract(source, {}, fetch);
    expect(result).toEqual({
      ok: true,
      abstract: "This paper studies the effect of electoral reform on voter turnout using a large panel of municipal elections held over two decades.",
    });
  });

  it("AE2: a paraphrase absent from the source is not-found", async () => {
    const fetch = makeFetch(["A completely different sentence that never appears anywhere in the source text and is long enough to clear the word floor easily."]);
    const result = await extractAbstract(ABSTRACT_TEXT, {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NOT_FOUND });
  });

  it("matches despite hyphenation, soft hyphen, and ligature differences between source and answer", async () => {
    const source = "This paper studies clas-\nsi­ﬁcation methods for identifying voter turnout effects across many national and municipal elections and finds robust, statistically significant results overall.";
    const answer = "This paper studies classification methods for identifying voter turnout effects across many national and municipal elections and finds robust, statistically significant results overall.";
    const fetch = makeFetch([answer]);
    const result = await extractAbstract(source, {}, fetch);
    expect(result).toEqual({ ok: true, abstract: answer });
  });

  it("an answer wrapped in quotes and prefixed 'Abstract:' is stripped and verified", async () => {
    const fetch = makeFetch([`"Abstract: ${ABSTRACT_TEXT}"`]);
    const result = await extractAbstract(ABSTRACT_TEXT, {}, fetch);
    expect(result).toEqual({ ok: true, abstract: ABSTRACT_TEXT });
  });

  it("NONE is not-found even when the source contains the word NONE", async () => {
    const source = "NONE of the reform effects were anticipated. " + ABSTRACT_TEXT;
    const fetch = makeFetch(["NONE"]);
    const result = await extractAbstract(source, {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NOT_FOUND });
  });

  it("an 11-word answer found in the source is not-found (length floor)", async () => {
    const short = "This paper studies the effect of electoral reform on turnout rates";
    expect(short.split(/\s+/).length).toBe(11);
    const source = short + " and finds nothing else worth noting in this filler sentence.";
    const fetch = makeFetch([short]);
    const result = await extractAbstract(source, {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NOT_FOUND });
  });

  it("empty text is no-fulltext and fetchFn is never called", async () => {
    const fetch = vi.fn(makeFetch([ABSTRACT_TEXT]));
    const result = await extractAbstract("   ", {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NO_FULLTEXT });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a fetch rejection carrying status 429 yields http-failed with that status", async () => {
    const fetch = makeFetch([Object.assign(new Error("Too many requests"), { status: 429 })]);
    const result = await extractAbstract(ABSTRACT_TEXT, {}, fetch);
    expect(result).toMatchObject({ ok: false, reason: ABSTRACT_REASONS.HTTP_FAILED, status: 429 });
    expect(result.detail).toBe("Too many requests");
  });

  it("a fetch rejection with no status yields http-failed with a null status", async () => {
    const fetch = makeFetch([new Error("Connection refused")]);
    const result = await extractAbstract(ABSTRACT_TEXT, {}, fetch);
    expect(result).toMatchObject({ ok: false, reason: ABSTRACT_REASONS.HTTP_FAILED, status: null });
  });

  it("the payload's user message holds at most min(12000, maxContextChars) characters of source", async () => {
    const longSource = "x".repeat(20000);
    const captured = [];
    const fetch = async (url, headers, payload) => {
      captured.push(payload);
      return JSON.stringify({ choices: [{ message: { content: "NONE" }, finish_reason: "stop" }] });
    };
    await extractAbstract(longSource, {}, fetch);
    const userMsg = captured[0].messages.find((m) => m.role === "user").content;
    expect(userMsg).toContain("x".repeat(MAX_SLICE_CHARS));
    expect(userMsg).not.toContain("x".repeat(MAX_SLICE_CHARS + 1));
  });

  it("respects a smaller maxContextChars than the 12000 ceiling", async () => {
    const longSource = "x".repeat(20000);
    const captured = [];
    const fetch = async (url, headers, payload) => {
      captured.push(payload);
      return JSON.stringify({ choices: [{ message: { content: "NONE" }, finish_reason: "stop" }] });
    };
    await extractAbstract(longSource, { maxContextChars: 500 }, fetch);
    const userMsg = captured[0].messages.find((m) => m.role === "user").content;
    expect(userMsg).toContain("x".repeat(500));
    expect(userMsg).not.toContain("x".repeat(501));
  });

  it("a reply with finish_reason 'length' is not-found even when its text is in the source", async () => {
    const fetch = makeFetch([{ content: ABSTRACT_TEXT, finishReason: "length" }]);
    const result = await extractAbstract(ABSTRACT_TEXT, {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NOT_FOUND });
  });

  it("an answer whose match ends within the last 200 chars of a truncated slice is not-found", async () => {
    const padding = "z".repeat(MAX_SLICE_CHARS - ABSTRACT_TEXT.length - 10);
    const longSource = padding + ABSTRACT_TEXT + "y".repeat(5000); // slice gets truncated, match near slice end
    const fetch = makeFetch([ABSTRACT_TEXT]);
    const result = await extractAbstract(longSource, {}, fetch);
    expect(result).toEqual({ ok: false, reason: ABSTRACT_REASONS.NOT_FOUND });
  });

  it("the same answer verifies when the source fits whole within the slice", async () => {
    const padding = "z".repeat(MAX_SLICE_CHARS - ABSTRACT_TEXT.length - 10);
    const shortSource = padding + ABSTRACT_TEXT; // fits entirely within MAX_SLICE_CHARS, nothing truncated
    const fetch = makeFetch([ABSTRACT_TEXT]);
    const result = await extractAbstract(shortSource, {}, fetch);
    expect(result).toEqual({ ok: true, abstract: ABSTRACT_TEXT });
  });
});

describe("sanitizeTriggerTag rejects the abstract marker tag", () => {
  it("returns '' for the abstract-extracted tag", () => {
    expect(sanitizeTriggerTag(ABSTRACT_TAG, {})).toBe("");
    expect(sanitizeTriggerTag(ABSTRACT_TAG, { failureTags: [], markerTag: "zps:summary-note" })).toBe("");
  });
});
