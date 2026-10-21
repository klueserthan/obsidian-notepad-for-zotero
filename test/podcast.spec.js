import { describe, it, expect } from "vitest";
import { podcastHtml, writePodcastScript } from "../src/podcast.js";

// Each element is the reply content (or { content, finishReason }) wrapped in a
// chat-completions response, or an Error thrown as the HTTP failure. Every
// request payload is recorded in `calls`.
const makeFetch = (responses) => {
  let i = 0;
  const calls = [];
  const fn = async (url, headers, payload, timeout) => {
    calls.push({ url, payload, timeout });
    const r = responses[i++];
    if (r instanceof Error) throw r;
    const { content, finishReason = "stop" } = typeof r === "object" ? r : { content: r };
    return JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] });
  };
  fn.calls = calls;
  return fn;
};

const SETTINGS = { baseURL: "http://localhost:11434/v1", model: "m", maxTokens: 4096, timeoutSeconds: 300 };
const META = { title: "Turnout and Reform", authors: "Ada Lovelace, Alan Turing", date: "2021-05-01", publicationTitle: "Journal of Tests" };
const TEXT = "Full paper text about electoral reform and turnout.";

describe("writePodcastScript", () => {
  it("returns the reply as paragraphs split on blank lines", async () => {
    const fetchFn = makeFetch(["Welcome to the episode.\n\nToday we look at turnout."]);
    const result = await writePodcastScript(TEXT, META, SETTINGS, fetchFn);
    expect(result).toEqual({ ok: true, paragraphs: ["Welcome to the episode.", "Today we look at turnout."] });
  });

  it("sends the paper's metadata and full text under the podcast token and time limits", async () => {
    const fetchFn = makeFetch(["Welcome."]);
    await writePodcastScript(TEXT, META, SETTINGS, fetchFn);
    const { payload, timeout } = fetchFn.calls[0];
    expect(payload.max_tokens).toBe(4096);
    expect(timeout).toBe(300);
    const [system, user] = payload.messages;
    expect(system.role).toBe("system");
    expect(system.content).not.toBe("");
    for (const part of ["Turnout and Reform", "Ada Lovelace, Alan Turing", "2021", "Journal of Tests", TEXT]) {
      expect(user.content).toContain(part);
    }
  });

  it("strips stray markdown so Read Aloud never speaks the markup", async () => {
    const reply = "## Episode: Turnout\n\nThis is **really** _important_.\n\n- First, the `data`.\n2. Then the [method](https://x.org).";
    const result = await writePodcastScript(TEXT, META, SETTINGS, makeFetch([reply]));
    expect(result.paragraphs).toEqual(["Episode: Turnout", "This is really important.", "First, the data.\nThen the method."]);
  });

  it("fails when the reply was cut off at the token limit", async () => {
    const fetchFn = makeFetch([{ content: "Welcome to the episode. Today we", finishReason: "length" }]);
    const result = await writePodcastScript(TEXT, META, SETTINGS, fetchFn);
    expect(result).toEqual({ ok: false, reason: "truncated" });
  });

  it("fails on an empty reply", async () => {
    const result = await writePodcastScript(TEXT, META, SETTINGS, makeFetch(["   "]));
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("reports an HTTP failure with its status and a redacted detail instead of throwing", async () => {
    const err = Object.assign(new Error("401 Unauthorized: Bearer sk-secret123"), { status: 401 });
    const result = await writePodcastScript(TEXT, META, SETTINGS, makeFetch([err]));
    expect(result).toEqual({ ok: false, reason: "http-failed", status: 401, detail: "401 Unauthorized: Bearer [redacted]" });
  });

  it("fails without a request when there is no full text", async () => {
    const fetchFn = makeFetch([]);
    expect(await writePodcastScript("  ", META, SETTINGS, fetchFn)).toEqual({ ok: false, reason: "no-fulltext" });
    expect(fetchFn.calls).toHaveLength(0);
  });

  it("fails without a request when the full text exceeds the context limit, never truncating it", async () => {
    const fetchFn = makeFetch([]);
    const result = await writePodcastScript("x".repeat(101), META, { ...SETTINGS, maxContextChars: 100 }, fetchFn);
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(fetchFn.calls).toHaveLength(0);
  });
});

describe("podcastHtml", () => {
  it("is an English page titled after the paper with one escaped paragraph per script paragraph", () => {
    const html = podcastHtml("Cats & <Dogs>", ["Hello \"world\".", "A < B & C."]);
    expect(html).toBe(
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      "<title>Podcast: Cats &amp; &lt;Dogs&gt;</title>\n</head>\n<body>\n" +
      "<p>Hello &quot;world&quot;.</p>\n<p>A &lt; B &amp; C.</p>\n</body>\n</html>\n",
    );
  });
});
