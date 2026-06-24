What is genuinely worth changing
These aren't blockers — the workflow runs today — but they tighten the failure modes that bit you in the 6h hangs.
1. Pin the action version.
anomalyco/opencode/github@latest will silently change behavior on the next release. Pin to a tag or commit SHA:
- uses: anomalyco/opencode/github@<sha-or-tag>
2. Explicit actions/setup-node so the agents' bash uses a version you control.
The runner image is on Node 20 (with a deprecation warning visible in every run). If vitest/eslint/etc. eventually require Node ≥ 22, the run will break. The action's own internals already use Node 24, but the agents' bash inherits the runner default:
- uses: actions/setup-node@v4
  with:
    node-version: 22
3. Cache the MCP package downloads.
First subagent invocation does npx -y @upstash/context7-mcp, which is ~30–60s of npm cold-start. Cache ~/.npm/_npx:
- uses: actions/cache@v4
  with:
    path: ~/.npm/_npx
    key: npx-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
4. Drop fetch-depth: 1 (or set a deeper depth).
actions/checkout@v6 defaults to a shallow clone (depth 1). That makes git log -5 and similar return one commit, and git diff <sha> may 404. It's why the action's index.ts uses --depth=${commits} for PR events. The issue workflow's checkout doesn't, so the agent's git log/git diff is shallow. For the orchestrator's "review the diff" tasks this is usually fine, but it's a footgun:
- uses: actions/checkout@v6
  with:
    fetch-depth: 0   # full history
    persist-credentials: false
5. Pre-install the .opencode/ workspace deps so the plugin's import { Plugin } from "@opencode-ai/plugin" is resolved from the workspace, not from the opencode binary's install dir.
Today it works by accident because opencode's own install contains @opencode-ai/plugin. If a future opencode release renames or removes that package, your custom plugin breaks at the action step. Make it explicit:
- name: Install .opencode plugin deps
  working-directory: .opencode
  run: npm ci
(Both package.json and package-lock.json are already committed; only node_modules/ is gitignored.)
6. Larger runner for long orchestrator jobs (paid tier only).
The default ubuntu-latest is 2-core / 7 GB RAM. The orchestrator + test-verifier + code-reviewer + two MCP servers can chew through that. If you start seeing OOM or extreme slowdowns on longer issues, switching to a 4-core/16 GB runner (ubuntu-latest-4-cores or ubuntu-latest-8-cores) is the cheapest fix.
7. Optional: set OPENCODE_DISABLE_AUTOUPDATE: true in the action's env: if you want predictable behavior across re-runs (skip the per-run version probe).
TL;DR
The user-facing answer to "do I need to install anything?" is no — the default runner has it all, and the action auto-installs the binary. The action's action.yml already does the heavy lifting. The only hard requirement is the OPENCODE_API_KEY secret. Everything else above is hardening that costs ~5 lines of YAML and removes future footguns.