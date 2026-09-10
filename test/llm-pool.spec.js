import { describe, it, expect } from "vitest";
import { runBounded } from "../src/llm-pool.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runBounded", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight--;
      return i * 10;
    };
    const results = await runBounded(5, 2, fn);
    expect(maxInFlight).toBe(2);
    expect(results.map((r) => r.value)).toEqual([0, 10, 20, 30, 40]);
  });

  it("lands results at their task index regardless of completion order", async () => {
    const delays = [30, 5, 15];
    const fn = async (i) => {
      await delay(delays[i]);
      return `out-${i}`;
    };
    const results = await runBounded(3, 3, fn);
    expect(results.map((r) => r.value)).toEqual(["out-0", "out-1", "out-2"]);
  });

  it("stopOnFailure: a rejection at index 1 prevents index 3 from starting while index 2, already in flight, still completes", async () => {
    const started = [];
    const fn = async (i) => {
      started.push(i);
      if (i === 0) { await delay(1); return "ok0"; }
      if (i === 1) { await delay(5); throw new Error("boom-1"); }
      if (i === 2) { await delay(30); return "ok2"; }
      return "ok3";
    };
    const results = await runBounded(4, 2, fn, { stopOnFailure: true });
    expect(started).toContain(2);
    expect(started).not.toContain(3);
    expect(results[1]).toEqual({ ok: false, error: expect.any(Error) });
    expect(results[1].error.message).toBe("boom-1");
    expect(results[2]).toEqual({ ok: true, value: "ok2" });
    expect(results[3]).toBeUndefined();
  });

  it("without stopOnFailure, every task runs and rejections are returned per index", async () => {
    const fn = async (i) => {
      if (i === 1) throw new Error("mid failure");
      return `out-${i}`;
    };
    const results = await runBounded(3, 2, fn);
    expect(results[0]).toEqual({ ok: true, value: "out-0" });
    expect(results[1].ok).toBe(false);
    expect(results[1].error.message).toBe("mid failure");
    expect(results[2]).toEqual({ ok: true, value: "out-2" });
  });

  it("concurrency larger than the task count spawns only n workers", async () => {
    let calls = 0;
    const fn = async (i) => { calls++; return i; };
    const results = await runBounded(3, 10, fn);
    expect(calls).toBe(3);
    expect(results.map((r) => r.value)).toEqual([0, 1, 2]);
  });

  it("zero tasks resolves immediately", async () => {
    let called = false;
    const fn = async () => { called = true; };
    const results = await runBounded(0, 5, fn);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("shouldStop returning true after the second claim leaves unclaimed indices unset", async () => {
    let claims = 0;
    const shouldStop = () => {
      claims++;
      return claims > 2;
    };
    const fn = async (i) => `out-${i}`;
    const results = await runBounded(5, 1, fn, { shouldStop });
    expect(results[0]).toEqual({ ok: true, value: "out-0" });
    expect(results[1]).toEqual({ ok: true, value: "out-1" });
    expect(results[2]).toBeUndefined();
    expect(results[3]).toBeUndefined();
    expect(results[4]).toBeUndefined();
  });
});
