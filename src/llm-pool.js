// Shared bounded worker pool. Pure logic (no DOM, no Zotero, no fetch) reused
// by the block runner (src/llm-runner.js) and paper-type detection.

/**
 * Runs `fn(i)` for i in [0, n) with at most `concurrency` calls in flight at
 * once, claiming indices in ascending order. Resolves to an array of length
 * `n`; a claimed-and-settled index holds `{ ok: true, value }` or
 * `{ ok: false, error }`, an unclaimed index is left unset (`undefined`).
 *
 * `shouldStop()`, when given, is checked before every claim; once it returns
 * true no further index is claimed. `stopOnFailure`, when true, stops further
 * claims once any task has rejected — in-flight tasks are still awaited. This
 * primitive never rejects and applies no priority to which failure "counts";
 * callers needing deterministic (e.g. lowest-index) failure reporting derive
 * it from the returned per-index array themselves.
 */
export async function runBounded(n, concurrency, fn, opts = {}) {
  const { stopOnFailure = false, shouldStop } = opts;
  const results = new Array(n);
  if (n <= 0) return results;

  let next = 0;
  let failed = false;

  const worker = async () => {
    for (;;) {
      if (stopOnFailure && failed) return;
      if (typeof shouldStop === "function" && shouldStop()) return;
      if (next >= n) return;
      const i = next++;
      try {
        const value = await fn(i);
        results[i] = { ok: true, value };
      } catch (error) {
        results[i] = { ok: false, error };
        if (stopOnFailure) failed = true;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), n);
  const workers = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
