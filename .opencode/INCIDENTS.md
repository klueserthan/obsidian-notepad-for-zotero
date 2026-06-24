# Agent runtime incidents

Postmortems for opencode-runtime / subagent failures in CI. Newest at the
top. Reference the run and log line numbers; keep terse.

## 2026-06-23 — Workflows missing `npm ci` (would have masked the fix)

After the policy rollout landed, realized the three `opencode-*.yml`
workflows have no install step — only `actions/checkout` and
`anomalyco/opencode/github@latest`. So `node_modules/` is absent on the
runner.

- `npm test` → **fails** (no `vitest` binary in `node_modules/.bin/`).
- `npx vitest` → **works, but bad**: npx auto-fetches an unpinned
  `vitest@latest` into `~/.npm/_npx/...`, re-downloads every run, and can
  pass against a different version than the repo's pinned `^2.1.8`. Exactly
  the kind of non-determinism that masks real test failures.

**Fix.** Added `actions/setup-node@v4` (Node 22, `cache: npm`) and an
`npm ci` step to all three opencode workflows. `cache: npm` keys on
`package-lock.json` so cache invalidates when the lockfile changes.

**Generalization.** Every workflow that hands control to an agent needs
the env the agent expects pre-installed. The agent should never be
responsible for env setup — a failed `npm ci` would be indistinguishable
from a test failure in the agent's logs, and it spends the agent's step
budget on plumbing.

## 2026-06-23 — Policy rollout: `ask` → `deny` across every agent

After the three 6h hangs below, applied the same fix to every other agent
that still had `ask` in its frontmatter, plus a `steps: N` cap on every
subagent.

- `agents/api-docs-researcher.md`: `external_directory`, `doom_loop` →
  `deny`; `steps: 30`.
- `agents/code-executor.md`: `external_directory`, `doom_loop` → `deny`;
  `git commit *`, `git rebase *`, `git reset *`, `git clean *` overrides
  changed `ask` → `deny`; `steps: 200`.
- `agents/code-explorer.md`: `external_directory`, `doom_loop` → `deny`;
  `steps: 50`.
- `agents/code-reviewer.md`: `steps: 100` (other `ask` already denied).
- `agents/docs-reviewer.md`: `external_directory`, `doom_loop` → `deny`;
  `steps: 100`.
- `agents/host-security-investigator.md`: `external_directory`, `doom_loop`
  → `deny`; `curl *`, `wget *`, `ssh *`, `scp *`, `rsync *`, `sftp *` →
  `deny`; `steps: 50`.
- `agents/orchestrator.md`: `external_directory`, `doom_loop` → `deny`;
  `steps: 500`.
- `agents/plan-runner.md`: `external_directory`, `doom_loop` → `deny`;
  `steps: 100`.
- `agents/security-reviewer.md`: `external_directory`, `doom_loop` →
  `deny`; `steps: 100`.
- `agents/spec-critic.md`: `external_directory`, `doom_loop` → `deny`;
  `steps: 50`.
- `agents/test-verifier.md`: `steps: 100` (other `ask` already denied).

**Invariant.** No `ask` in any agent frontmatter. No `ask` in the project
config. `doom_loop: deny` and `external_directory: deny` everywhere.
`steps: N` on every agent. `timeout-minutes` on the workflows.

## 2026-06-23 — 3 CI runs aborted at 6h on `npx vitest` `bash: ask`

Runs `27991538215` (issue #9), `75468339751` (LLM block slice 1),
`75468339757` (LLM block slice 2) all hit the 6h cap after ~5h 40m of log
silence. The last log line in every run was
`asking { permission: "bash", patterns: [ "npx vitest run test/<file>.spec.js 2>&1" ] }`
with no response. CI has no user, so the opencode runtime blocks indefinitely
on any `ask` permission.

**Cause.** `test-verifier` had `bash: "*": ask`; the model legitimately
tried `npx vitest run ...`, the pattern didn't match the allow-listed globs
(`npm test *`, `npm run test *`, …), the catch-all asked, hang. The
code-reviewer hit the same trap via the project default
`bash: { "*": "ask" }` in `opencode.jsonc`.

**Fix.**
- `agents/test-verifier.md`: `bash: "*": ask` → `"*": deny`; added
  `npx vitest *` and `npx eslint *` to the allow-list;
  `external_directory: ask` → `deny`; `doom_loop: ask` → `deny`;
  `rm/mv/cp *: ask` → `deny`.
- `agents/code-reviewer.md`: `external_directory: ask` → `deny`;
  `doom_loop: ask` → `deny`.
- `opencode.jsonc`: `bash: { "*": "ask" }` → `"*": "deny"`,
  `edit: "ask"` → `"deny"`. Safety net for any subagent that doesn't pin
  its own policy.
- `.github/workflows/opencode-*.yml`: added `timeout-minutes: 120` so a
  hang fails fast.
- `opencode.jsonc:69`: fixed `oopencode-go/minimax-m3` typo for
  `spec-critic` (latent).

**Generalization.** In CI, `ask` is a hang. Use `deny` for the catch-all and
`allow` for explicit globs the model demonstrably needs (the failing run
tells you which). For belt-and-suspenders: `steps: N` per agent (iteration
cap) and `timeout-minutes` on the workflow. See
`opencode.ai/docs/permissions` for rule precedence and
`opencode.ai/docs/agents` for the `steps` config.
