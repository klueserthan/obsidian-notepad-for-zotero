# Plan: LLM Interpreter Provider Configuration

Status: draft · Scope: first end-to-end LLM interpreter **configuration** path (no execution yet)
Repo: `obsidian-notepad-for-zotero` (Zotero 7+ plugin, AGPL-3.0)

## Context & goals

Add the first LLM interpreter setup path so a user can configure an
OpenAI-compatible Chat Completions provider, keep Ollama-friendly defaults,
optionally store an API key, tune basic generation settings, validate the
connection, and see configuration-gated LLM controls become available only when
base URL and model are set. **Executing LLM blocks from notes, template
parsing, and multiple profiles are explicitly out of scope** — only the
configuration + validation + gating slice ships here.

The codebase splits cleanly between **pure logic** (`src/*.js`, ES modules, no
Zotero/DOM deps, exercised by Vitest in `test/*.spec.js`, re-exported through
`core/core.js` → bundled as the `ZONCore` IIFE global) and **Zotero-bound UI**
(`addon/bootstrap.js` monolith + `addon/content/preferences.{xhtml,js}`). The
existing Crossref DOI lookup (`src/crossref.js` + `findDOIForItem` in
`bootstrap.js` ~line 2088) is the direct precedent: pure URL/parse helpers in
`src/`, the actual `Zotero.HTTP.request` call in the bootstrap. We mirror that
split exactly for LLM.

### Verified repo facts the plan depends on

- `src/crossref.js` is the analog pure module; `test/crossref.spec.js` is the
  analog test (`import { … } from "../src/crossref.js"`, vitest, no DOM).
- `core/core.js` re-exports every `src/` module by name; adding one `export`
  line picks the new module into the `ZONCore` bundle (entry already configured
  in `zotero-plugin.config.ts` → `esbuildOptions` → `core/core.js`). **No build
  config change needed.**
- `bootstrap.js`: `PREF_*` constants at lines 28–42, `DEFAULT_*` at 46–64,
  `seedDefaults()` at 604–623, typed pref getters at 625–658, `STRINGS` at
  338–416, `t(key, args)` at 419–424, `log(msg)` at 332, `init()` at 174
  (sets `Zotero.ZON = this` at line 176, calls `seedDefaults()` at 177,
  registers the prefs pane at 187–194 with `scripts: [preferences.js]`).
- Pref prefix is literal `extensions.zotero-obsidian-notes.` (from
  `package.json#config.prefsPrefix`). `preferences.xhtml` binds inputs with
  `preference="extensions.zotero-obsidian-notes.<name>"` (literal full names,
  no `__token__`). New controls follow the same literal-name convention.
- `Zotero.HTTP.request("GET", url, { responseType, timeout, headers })` is the
  only existing network call (bootstrap ~2096). POST with a body uses the same
  helper: `Zotero.HTTP.request("POST", url, { body, headers, responseType,
  timeout })`.
- `ZONCore` is injected per **main** window (`injectCore(win)`, line 693) and
  read as `win.ZONCore`. The **preferences window is a separate window** where
  `window.ZONCore` is NOT available; prefs JS reaches the plugin through
  `Zotero.ZON` (the dev handle) and `Zotero.Prefs`.
- Note-pane toolbar is built in `buildEditorUI(wrap, win)` (line 1122) with a
  local `h(tag, cls)` helper; actions row is `row2` (line 1252). The "⋯ More"
  popover is appended to `row2` only when `experimentalEnabled()` (line 1253) —
  the precedent for config-gated toolbar controls.
- `vitest.config.js` includes `test/*.spec.js` and excludes
  `test/integration/**`. New spec goes in `test/llm.spec.js`.
- FTL (`addon/locale/en-US/zotero-obsidian-notes.ftl`) holds only ~12 chrome
  strings. **No FTL change needed** — all new LLM text is JS-emitted → belongs
  in `STRINGS`. Do NOT touch `fluent.prefixLocaleFiles`/`prefixFluentMessages`.

## Design summary

1. New pure module `src/llm.js` — defaults, validation/gating, payload
   construction, response extraction, error sanitization, log-metadata
   sanitization. No Zotero/DOM deps.
2. One new `export` line in `core/core.js` → ships `src/llm.js` inside `ZONCore`.
3. `bootstrap.js` — 8 new prefs (`PREF_LLM_*` + `DEFAULT_LLM_*`), `seedDefaults`
  entries, a consolidated `llmSettings()` getter, `canRunLLM()`/`canAutoRun()`
  gating methods, a `testLLMConnection()` method (HTTP + `ZONCore` helpers,
  metadata-only logging), new `STRINGS` keys, and a gated note-pane "Run LLM"
  button (placeholder action — execution is out of scope).
4. `addon/content/preferences.xhtml` — a new LLM groupbox with 8 bound controls
   + a "Test connection" button + a status span.
5. `addon/content/preferences.js` — wire the Test button to
   `Zotero.ZON.testLLMConnection()`; enforce auto-run gating on base URL/model
   change (disable + reset the auto-run checkbox when unconfigured).
6. `test/llm.spec.js` — Vitest specs for the pure module.

## Exact pref names, defaults, and STRINGS keys

### New prefs (bootstrap.js `PREF_*` + `DEFAULT_*`)

| Constant | Full pref name | Default | Type |
|---|---|---|---|
| `PREF_LLM_BASE_URL` | `extensions.zotero-obsidian-notes.llmBaseUrl` | `http://localhost:11434/v1` | string |
| `PREF_LLM_MODEL` | `extensions.zotero-obsidian-notes.llmModel` | `""` | string |
| `PREF_LLM_API_KEY` | `extensions.zotero-obsidian-notes.llmApiKey` | `""` | string |
| `PREF_LLM_TEMPERATURE` | `extensions.zotero-obsidian-notes.llmTemperature` | `0.2` | number |
| `PREF_LLM_MAX_OUTPUT_TOKENS` | `extensions.zotero-obsidian-notes.llmMaxOutputTokens` | `2048` | number |
| `PREF_LLM_MAX_CONTEXT_CHARS` | `extensions.zotero-obsidian-notes.llmMaxContextChars` | `100000` | number |
| `PREF_LLM_TIMEOUT` | `extensions.zotero-obsidian-notes.llmTimeout` | `60` | number (seconds) |
| `PREF_LLM_AUTORUN` | `extensions.zotero-obsidian-notes.llmAutoRun` | `false` | boolean |

Defaults are Ollama-friendly: `http://localhost:11434/v1`, blank model, blank
API key, temperature `0.2`, max output tokens `2048`, max context `100000`,
timeout `60`s, auto-run off. API key optional — not required for "configured".

### New STRINGS keys (bootstrap.js `STRINGS`, dot-namespaced, JS-emitted only)

```
"btn.testLLM": "Test connection",
"btn.runLLM": "Run LLM",
"tip.testLLM": "Send a minimal request to verify the provider settings",
"tip.runLLM": "Run the LLM interpreter on this note (beta — execution coming soon)",
"tip.llmAutoRun": "Run the LLM interpreter automatically when creating a note or inserting a block. Requires base URL and model.",
"label.llmAutoRun": "Run LLM on create/insert",
"status.llmTesting": "Testing LLM connection…",
"status.llmTestOk": "LLM connection OK ({model})",
"status.llmTestEmpty": "LLM connection succeeded but returned no content",
"status.llmTestFail": "LLM connection failed — {error}",
"status.llmNotConfigured": "Set LLM base URL and model in Settings first",
"status.llmNotImplemented": "LLM execution is not yet available in this beta",
```

> **Note on the "no inline user-visible strings" DoD:** the existing
> `preferences.xhtml` is 100% inline labels (e.g. "Obsidian vault path") and
> `preferences.js` uses inline strings for its `notify()` messages. The
> AGENTS.md STRINGS rule is scoped to `bootstrap.js`. This plan keeps
> **preferences.xhtml static labels inline** (consistent with the existing
> pane) and routes **all JS-emitted LLM text** (button labels set from JS,
> tooltips, test results, errors, statuses) through `STRINGS` via
> `Zotero.ZON.t()`. If the reviewer wants the XHTML labels in STRINGS too,
> Slice 3 can be extended to populate them from `preferences.js` — flagged as a
> decision point below.

## `src/llm.js` — pure module (exact signatures)

```js
// src/llm.js — PURE LLM provider helpers (OpenAI-compatible Chat Completions).
// No Zotero/DOM deps → unit-tests headlessly. The HTTP call lives in the
// bootstrap (Zotero.HTTP.request); this module only builds/parse/sanitizes.

export const LLM_DEFAULTS = {
  baseUrl: "http://localhost:11434/v1",
  model: "",
  apiKey: "",
  temperature: 0.2,
  maxOutputTokens: 2048,
  maxContextChars: 100000,
  timeout: 60,
  autoRun: false,
};

// True when baseUrl AND model are non-empty after trim. "Configured enough to
// attempt a request" — API key is NOT required (Ollama needs none).
export function isLLMConfigured(settings) { /* … */ }

// Alias of isLLMConfigured for now — distinct name so future run-time gating
// (e.g. rate limits) can diverge from "configured".
export function canRunLLM(settings) { /* … */ }

// True only when configured AND autoRun is truthy.
export function canAutoRun(settings) { /* … */ }

// Return a NEW normalized settings object (never mutates input):
//  - trim baseUrl / model / apiKey
//  - coerce temperature → Number, clamp [0, 2], default 0.2 on NaN
//  - coerce maxOutputTokens → integer, clamp [1, 128000], default 2048
//  - coerce maxContextChars → integer, clamp [1000, 4000000], default 100000
//  - coerce timeout → integer seconds, clamp [1, 600], default 60
//  - autoRun → !!autoRun, then FORCE false when !isLLMConfigured(normalized)
export function normalizeLLMSettings(settings) { /* … */ }

// Build the Chat Completions request descriptor. Returns { url, headers, body }:
//  - url = baseUrl (trimmed) + "/chat/completions", collapsing a trailing slash
//    so "http://h/v1" and "http://h/v1/" both → "http://h/v1/chat/completions"
//  - headers = { "Content-Type": "application/json" } plus
//    { "Authorization": "Bearer " + apiKey } ONLY when apiKey non-empty
//  - body = JSON.stringify({ model, messages, temperature, max_tokens,
//    stream: false }) — apiKey NEVER appears in the body
// `messages` is passed through unchanged (caller-owned). `opts.stream` default
// false. Does NOT send anything.
export function buildChatCompletionsPayload(settings, messages, opts = {}) { /* … */ }

// Extract the assistant text from a Chat Completions JSON response:
// choices[0].message.content. Accepts string or array-of-parts content. Returns
// "" for empty/malformed/null — never throws.
export function extractChatContent(json) { /* … */ }

// Reduce any provider error (Error / string / HTTP response / parsed JSON) to a
// short sanitized message: strip "Bearer …" / sk-… / Authorization headers,
// drop prompt/response/abstract/annotation text, truncate to ~200 chars, prefix
// with an HTTP status when present. Never includes secrets or content.
export function sanitizeLLMError(err) { /* … */ }

// Metadata-only object for Zotero.debug / console: { model, host, timeout,
// hasApiKey, status?, ms?, error? }. `host` is baseUrl's origin only. Never
// includes the API key value, prompts, responses, or note content.
export function llmLogMeta(settings, extra = {}) { /* … */ }
```

### `core/core.js` — add one export line

```js
export { LLM_DEFAULTS, isLLMConfigured, canRunLLM, canAutoRun, normalizeLLMSettings, buildChatCompletionsPayload, extractChatContent, sanitizeLLMError, llmLogMeta } from "../src/llm.js";
```

## `bootstrap.js` — wiring (exact additions)

### Pref constants & defaults (after line 42 / 64)

Add the 8 `PREF_LLM_*` constants after `PREF_EXPERIMENTAL` (line 42) and the 8
`DEFAULT_LLM_*` values after `DEFAULT_EXPERIMENTAL` (line 64), per the table
above.

### `seedDefaults()` (line 604–623)

Append 8 `seed(this.PREF_LLM_X, this.DEFAULT_LLM_X);` calls so the prefs pane
shows real values on first run (its inputs bind to stored prefs).

### Typed pref helpers + consolidated getter (after line 658)

```js
// Small typed readers for the LLM prefs (mirror the per-pref getter style but
// DRY — 8 prefs would otherwise be 8 near-identical methods).
_llmStr(key, def) {
  try { let v = Zotero.Prefs.get(key, true); return (v == null) ? def : String(v); }
  catch (e) { return def; }
},
_llmNum(key, def) {
  try { let v = Zotero.Prefs.get(key, true); let n = Number(v); return (v == null || Number.isNaN(n)) ? def : n; }
  catch (e) { return def; }
},
_llmBool(key, def) {
  try { let v = Zotero.Prefs.get(key, true); return (v === undefined) ? def : !!v; }
  catch (e) { return def; }
},

// All eight LLM prefs as one object (typed, with defaults). NOT normalized —
// normalization is a pure helper in ZONCore (used by testLLMConnection).
llmSettings() {
  return {
    baseUrl: this._llmStr(this.PREF_LLM_BASE_URL, this.DEFAULT_LLM_BASE_URL),
    model: this._llmStr(this.PREF_LLM_MODEL, this.DEFAULT_LLM_MODEL),
    apiKey: this._llmStr(this.PREF_LLM_API_KEY, this.DEFAULT_LLM_API_KEY),
    temperature: this._llmNum(this.PREF_LLM_TEMPERATURE, this.DEFAULT_LLM_TEMPERATURE),
    maxOutputTokens: this._llmNum(this.PREF_LLM_MAX_OUTPUT_TOKENS, this.DEFAULT_LLM_MAX_OUTPUT_TOKENS),
    maxContextChars: this._llmNum(this.PREF_LLM_MAX_CONTEXT_CHARS, this.DEFAULT_LLM_MAX_CONTEXT_CHARS),
    timeout: this._llmNum(this.PREF_LLM_TIMEOUT, this.DEFAULT_LLM_TIMEOUT),
    autoRun: this._llmBool(this.PREF_LLM_AUTORUN, this.DEFAULT_LLM_AUTORUN),
  };
},

// Gating — computed inline (no ZONCore dependency) so it works even before the
// core bundle is injected. Matches the pure isLLMConfigured/canAutoRun logic.
canRunLLM() {
  let s = this.llmSettings();
  return !!(s.baseUrl && String(s.baseUrl).trim() && s.model && String(s.model).trim());
},
canAutoRun() {
  return this.canRunLLM() && !!this.llmSettings().autoRun;
},
```

### `testLLMConnection()` method (new, near the Crossref block ~line 2109)

```js
// Send a minimal OpenAI-compatible Chat Completions request to validate the
// provider settings. Payload/response/error handling come from ZONCore (pure);
// only the HTTP transport lives here. Logs metadata ONLY (never key/content).
// Returns { ok, empty, message, model }.
async testLLMConnection() {
  let raw = this.llmSettings();
  let win = Zotero.getMainWindow && Zotero.getMainWindow();
  if (!win) return { ok: false, empty: false, message: this.t("status.llmTestFail", { error: "no window" }), model: raw.model };
  if (!win.ZONCore) { try { await this.injectCore(win); } catch (e) {} }
  let C = win.ZONCore;
  if (!C || !C.buildChatCompletionsPayload) return { ok: false, empty: false, message: this.t("status.llmTestFail", { error: "core not ready" }), model: raw.model };
  let settings = C.normalizeLLMSettings(raw);
  if (!C.isLLMConfigured(settings)) return { ok: false, empty: false, message: this.t("status.llmNotConfigured"), model: settings.model };
  let payload = C.buildChatCompletionsPayload(settings, [{ role: "user", content: "Reply with OK." }]);
  let t0 = Date.now();
  try {
    let resp = await Zotero.HTTP.request("POST", payload.url, {
      body: payload.body,
      headers: payload.headers,
      responseType: "text",
      timeout: (settings.timeout || 60) * 1000,
    });
    let ms = Date.now() - t0;
    let json; try { json = JSON.parse(resp.responseText || resp.response || "{}"); } catch (e) { json = {}; }
    let content = C.extractChatContent(json);
    this.log("LLM test ok " + JSON.stringify(C.llmLogMeta(settings, { status: resp.status, ms })));
    return content
      ? { ok: true, empty: false, message: this.t("status.llmTestOk", { model: settings.model }), model: settings.model }
      : { ok: true, empty: true, message: this.t("status.llmTestEmpty"), model: settings.model };
  } catch (e) {
    let ms = Date.now() - t0;
    let msg = C.sanitizeLLMError(e);
    this.log("LLM test failed " + JSON.stringify(C.llmLogMeta(settings, { ms, error: msg })));
    return { ok: false, empty: false, message: this.t("status.llmTestFail", { error: msg }), model: settings.model };
  }
},
```

> The success UI shows only `model` + OK/empty — **not** the response text — to
> keep content out of any copy/log path. The log line carries only
> `llmLogMeta(...)` (model, host, status, ms, hasApiKey bool, sanitized error).

### Note-pane "Run LLM" gated button (in `buildEditorUI`, ~line 1252)

Add a button appended to `row2` **only when `this.canRunLLM()`** (the gating the
issue requires). Execution is out of scope, so the click handler shows a status
banner via the existing `status` span — proving the gating works without
implementing execution.

```js
let runLlmBtn = h("button"); runLlmBtn.textContent = this.t("btn.runLLM");
runLlmBtn.title = this.t("tip.runLLM");
runLlmBtn.addEventListener("click", () => {
  // Execution is out of scope for this slice — surface a clear beta status.
  status.textContent = this.t("status.llmNotImplemented");
});
// … after row2 is built (line 1252) …
if (this.canRunLLM()) row2.append(runLlmBtn);
```

> **Decision point (flagged):** the issue's acceptance criterion explicitly
> requires "Run LLM … controls gated on non-empty base URL and model", while
> "Executing LLM blocks" is out of scope. The button-above is the minimal way
> to satisfy the gating criterion honestly (visible only when configured; click
> says "execution coming soon"). **Alternative:** defer the note-pane button
> entirely to the execution issue and ship only the auto-run pref + gating
> logic + preferences UI here. Recommended: include the gated placeholder
> button (Slice 4 is small and independently revertible).

## `addon/content/preferences.xhtml` — new LLM groupbox

Append a second `<groupbox>` after the existing one (before the closing
`</vbox>` at line 99). Inputs bind via `preference="..."` (literal full pref
names, matching the existing pane). Numeric fields use `type="number"`; if
Zotero's `preference` binding proves flaky for number inputs, fall back to
`type="text"` (the bootstrap getter coerces via `Number()` regardless).

```xml
<groupbox>
  <label><html:h2>LLM Interpreter</html:h2></label>
  <html:div style="display:flex;flex-direction:column;gap:12px;padding:6px 4px;max-width:780px;">
    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Base URL (OpenAI-compatible)</html:span>
      <html:input id="zon-llm-baseurl" type="text" style="width:100%;box-sizing:border-box;"
        preference="extensions.zotero-obsidian-notes.llmBaseUrl"/>
      <html:span style="color:#888;font-size:11px;">e.g. http://localhost:11434/v1 for Ollama, or https://api.openai.com/v1.</html:span>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Model</html:span>
      <html:input id="zon-llm-model" type="text" style="width:100%;box-sizing:border-box;"
        preference="extensions.zotero-obsidian-notes.llmModel"/>
      <html:span style="color:#888;font-size:11px;">Model name accepted by your provider’s chat/completions endpoint.</html:span>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>API key (optional)</html:span>
      <html:input id="zon-llm-apikey" type="password" style="width:100%;box-sizing:border-box;"
        preference="extensions.zotero-obsidian-notes.llmApiKey"/>
      <html:span style="color:#888;font-size:11px;">Leave blank for local providers (Ollama). Stored in Zotero prefs (not encrypted).</html:span>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Temperature</html:span>
      <html:input id="zon-llm-temperature" type="number" step="0.1" min="0" max="2" style="width:120px;"
        preference="extensions.zotero-obsidian-notes.llmTemperature"/>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Max output tokens</html:span>
      <html:input id="zon-llm-maxtokens" type="number" min="1" style="width:120px;"
        preference="extensions.zotero-obsidian-notes.llmMaxOutputTokens"/>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Max context characters</html:span>
      <html:input id="zon-llm-maxctx" type="number" min="1000" style="width:120px;"
        preference="extensions.zotero-obsidian-notes.llmMaxContextChars"/>
    </html:label>

    <html:label style="display:flex;flex-direction:column;gap:3px;">
      <html:span>Timeout (seconds)</html:span>
      <html:input id="zon-llm-timeout" type="number" min="1" style="width:120px;"
        preference="extensions.zotero-obsidian-notes.llmTimeout"/>
    </html:label>

    <html:label style="display:flex;align-items:flex-start;gap:8px;">
      <html:input id="zon-llm-autorun" type="checkbox"
        preference="extensions.zotero-obsidian-notes.llmAutoRun"/>
      <html:span style="display:flex;flex-direction:column;gap:3px;">
        <html:span>Run LLM on create/insert</html:span>
        <html:span style="color:#888;font-size:11px;">Auto-run the interpreter when creating a note or inserting a block. Only available when Base URL and Model are set.</html:span>
      </html:span>
    </html:label>

    <html:div style="display:flex;align-items:center;gap:8px;">
      <html:button id="zon-llm-test" type="button">Test connection</html:button>
      <html:span id="zon-llm-test-status" style="color:#888;font-size:11px;"></html:span>
    </html:div>
  </html:div>
</groupbox>
```

## `addon/content/preferences.js` — wiring additions

Inside the existing IIFE, extend `wireControls` (or add a sibling `wireLLM`)
using the same retry-until-present pattern (the pane XHTML can insert a tick
after the script runs — see the existing `wireControls` comment at line 55).

```js
function wireLLM(tries) {
  const testBtn = document.getElementById("zon-llm-test");
  if (!testBtn) {
    if ((tries || 0) < 40) window.setTimeout(() => wireLLM((tries || 0) + 1), 50);
    return;
  }
  const ZON = () => Zotero.ZON;
  const baseEl = document.getElementById("zon-llm-baseurl");
  const modelEl = document.getElementById("zon-llm-model");
  const autoEl = document.getElementById("zon-llm-autorun");
  const statusEl = document.getElementById("zon-llm-test-status");

  // Gating: disable the auto-run checkbox whenever base URL or model is empty,
  // and reset the pref to false so it can never remain enabled unconfigured.
  function refreshGating() {
    const z = ZON();
    const ok = z && z.canRunLLM ? z.canRunLLM()
      : !!(baseEl && baseEl.value.trim() && modelEl && modelEl.value.trim());
    if (autoEl) {
      autoEl.disabled = !ok;
      if (!ok && autoEl.checked) {
        autoEl.checked = false;
        try { Zotero.Prefs.set(PREFIX + "llmAutoRun", false, true); } catch (e) {}
        autoEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
  // Re-evaluate on any change to base URL / model (the `preference` binding
  // writes the pref first; we read the input value for immediacy).
  for (const el of [baseEl, modelEl]) {
    if (el) el.addEventListener("change", refreshGating);
  }
  refreshGating(); // initial state on pane open

  // Test connection → delegates to bootstrap (HTTP + ZONCore pure helpers).
  testBtn.addEventListener("click", async () => {
    const z = ZON();
    if (!z || !z.testLLMConnection) { if (statusEl) statusEl.textContent = "Plugin not ready — try reopening Settings."; return; }
    testBtn.disabled = true;
    if (statusEl) statusEl.textContent = z.t ? z.t("status.llmTesting") : "Testing…";
    try {
      const r = await z.testLLMConnection();
      if (statusEl) statusEl.textContent = r.message;
    } catch (e) {
      if (statusEl) statusEl.textContent = (z && z.t) ? z.t("status.llmTestFail", { error: String(e) }) : String(e);
    } finally {
      testBtn.disabled = false;
    }
  });
}
wireLLM();
```

> `refreshGating` is the UI-side enforcement of "auto-run cannot remain enabled
> when base URL or model becomes unset". The pure `normalizeLLMSettings` is the
> read-side backstop (used by `testLLMConnection` and exercised in tests), so
> even an about:config edit can't make `canAutoRun()` lie.

## `test/llm.spec.js` — Vitest specs (pure, no Zotero)

`import { LLM_DEFAULTS, isLLMConfigured, canRunLLM, canAutoRun, normalizeLLMSettings, buildChatCompletionsPayload, extractChatContent, sanitizeLLMError, llmLogMeta } from "../src/llm.js";`

| Describe / it | Assertion |
|---|---|
| `LLM_DEFAULTS` | exact values: baseUrl `http://localhost:11434/v1`, model `""`, apiKey `""`, temperature `0.2`, maxOutputTokens `2048`, maxContextChars `100000`, timeout `60`, autoRun `false` |
| `isLLMConfigured` | true when baseUrl+model non-empty; false when either is `""`/whitespace; false for `null`/`undefined`/`{}`; apiKey irrelevant (configured with blank key) |
| `canRunLLM` | mirrors `isLLMConfigured` for the same cases |
| `canAutoRun` | true only when configured AND `autoRun: true`; false when `autoRun: true` but model empty; false when configured but `autoRun: false` |
| `normalizeLLMSettings` | (a) forces `autoRun: false` when baseUrl or model empty (even if input `autoRun: true`); (b) trims baseUrl/model/apiKey; (c) coerces numeric strings `"0.5"`→`0.5`; (d) clamps temperature to [0,2] (`5`→`2`, `-1`→`0`); (e) clamps maxOutputTokens to [1,128000] (`0`→`1`); (f) clamps timeout to [1,600] (`0`→`1`); (g) defaults NaN numerics to the `LLM_DEFAULTS` value; (h) returns a NEW object (input not mutated) |
| `buildChatCompletionsPayload` | (a) url = `http://localhost:11434/v1/chat/completions` for default baseUrl; (b) collapses trailing slash (`…/v1/`→`…/v1/chat/completions`); (c) headers include `Content-Type: application/json` always; (d) headers include `Authorization: Bearer sk-x` only when apiKey non-empty; (e) NO `Authorization` header when apiKey blank; (f) body JSON has `model`, `messages` passed through, `temperature`, `max_tokens`, `stream: false`; (g) apiKey does NOT appear anywhere in body |
| `extractChatContent` | (a) returns `choices[0].message.content` string; (b) returns `""` for `{choices:[]}`; (c) returns `""` for `{}`/`null`/malformed; (d) joins array-of-parts content; (e) never throws |
| `sanitizeLLMError` | (a) `new Error("boom")`→`"boom"`; (b) string passthrough; (c) includes HTTP status when present (`{status:401}`→contains `401`); (d) strips `Bearer sk-…`/`Authorization:` from the message; (e) truncates to ≤200 chars; (f) never includes prompt/response text even if the error object contains it |
| `llmLogMeta` | (a) returns `model`, `host` (origin only), `timeout`, `hasApiKey` boolean; (b) `hasApiKey` is false when key blank, true when set; (c) the API key VALUE never appears in the object; (d) merges `extra` (`status`, `ms`, `error`) |

Run: `npx vitest run test/llm.spec.js` then `npm test` (full suite).

## Slice ordering (for serialized code-executor delegation)

Each slice is independently verifiable and commits cleanly. Slices 1–3 are the
core; Slice 4 is the (recommended but separable) note-pane gating.

### Slice 1 — Pure module + tests (red→green, no Zotero)
- Create `src/llm.js` with all exports per signatures above.
- Add the one `export { … } from "../src/llm.js";` line to `core/core.js`.
- Create `test/llm.spec.js` with every case in the table above.
- **Verify:** `npx vitest run test/llm.spec.js` passes; `npm test` full suite
  green; `npm run build` succeeds (the new module is bundled into
  `core.bundle.js` — confirm `ZONCore.normalizeLLMSettings` exists in the
  built bundle by grepping `.scaffold/build/addon/content/core.bundle.js`).
- **No bootstrap/UI changes yet.**

### Slice 2 — bootstrap pref wiring + STRINGS (no behavior change)
- Add `PREF_LLM_*` (8) + `DEFAULT_LLM_*` (8) to `bootstrap.js`.
- Add 8 `seed(...)` calls to `seedDefaults()`.
- Add `_llmStr/_llmNum/_llmBool`, `llmSettings()`, `canRunLLM()`,
  `canAutoRun()` methods.
- Add the 12 `STRINGS` keys above.
- **Verify:** `npm run build` succeeds; `npm test` still green (no src change).
  Manual: in a dev Zotero, `Zotero.ZON.llmSettings()` returns the defaults;
  `Zotero.ZON.canRunLLM()` is `false` (blank model); setting
  `llmModel` makes `canRunLLM()` true. (Optional — needs `npm start`.)

### Slice 3 — preferences UI + Test connection
- Add the LLM `<groupbox>` to `addon/content/preferences.xhtml`.
- Add `wireLLM()` to `addon/content/preferences.js` (Test button + auto-run
  gating) and call it.
- Add `testLLMConnection()` to `bootstrap.js`.
- **Verify:** `npm run build` succeeds; `npm test` green. Manual (`npm start`):
  open Settings → Obsidian Notes → LLM section shows the 8 defaults; auto-run
  checkbox is disabled (blank model); type a model → checkbox enables; clear
  model → checkbox disables AND unchecks + pref resets to false; "Test
  connection" against a running Ollama reports OK; against a bad URL reports a
  sanitized error with no API key / prompt content; check `Zotero.debug` output
  contains only metadata (model, host, status, ms, hasApiKey).

### Slice 4 — note-pane "Run LLM" gated button (recommended, separable)
- In `buildEditorUI` (~line 1252), add `runLlmBtn` and append to `row2` only
  when `this.canRunLLM()`; click → `status.textContent = this.t("status.llmNotImplemented")`.
- **Verify:** `npm run build` succeeds; `npm test` green. Manual: with blank
  model the button is absent; set model → reopen item → button appears; click →
  shows the "not yet available" status; clear model → reopen → button gone.
- **Rollback:** removing the 3 lines + button reverts this slice with no impact
  on Slices 1–3.

### Slice 5 — final verification
- `npm test` (full) + `npm run build` both green.
- Walk every acceptance criterion (see checklist below).
- Optional: add a Mocha integration spec under `test/integration/` that calls
  `Zotero.ZON.testLLMConnection()` against a mock — **only if a local
  OpenAI-compatible endpoint is available in CI**; otherwise leave to manual
  verification (the issue scopes "outside Zotero" tests to the pure module).

## Risks & rollback considerations

- **API key storage is plaintext** in `extensions.zotero-obsidian-notes.llmApiKey`
  (Zotero prefs are not encrypted; visible in `about:config`). The issue
  explicitly accepts optional key storage for this beta. Mitigations: never log
  it (`llmLogMeta` exposes only `hasApiKey` bool); `sanitizeLLMError` strips
  `Bearer …`/`Authorization` from any surfaced error; the XHTML hint states
  "Stored in Zotero prefs (not encrypted)". **Flag for a future encrypted-store
  follow-up.**
- **`ZONCore` not in the prefs window.** Routed around by putting
  `testLLMConnection()` on `Zotero.ZON` (bootstrap), which reaches `ZONCore`
  via `Zotero.getMainWindow().ZONCore` (injecting if missing). preferences.js
  only calls `Zotero.ZON.testLLMConnection()` — never `window.ZONCore`.
- **Auto-run enforcement races.** If base URL/model are cleared via
  `about:config` (bypassing the prefs UI), the raw `llmAutoRun` pref may stay
  `true`. The read-side backstop (`canAutoRun()` = `canRunLLM() && autoRun`)
  still returns `false`, and `normalizeLLMSettings` forces `false` before any
  request, so behavior is correct; only the prefs checkbox could visually lie
  until reopened. Acceptable for a beta; documented.
- **Number-input `preference` binding.** Zotero's `preference="…"` attribute
  binding is proven for text/checkbox in this pane but not for
  `type="number"`. Fallback: `type="text"` (bootstrap coerces via `Number()`).
  Verify in Slice 3 manual check.
- **Note-pane "Run LLM" placeholder UX.** A button that says "not yet
  available" could confuse. Mitigation: tooltip + status make the beta state
  explicit; Slice 4 is independently revertible. (Decision point above.)
- **Build config untouched.** No edits to `zotero-plugin.config.ts` — the new
  `src/llm.js` is picked up by the existing `core/core.js` entry. No `&&` in
  single-command fields. No FTL changes. Rollback of the whole feature = revert
  the 5 files (`src/llm.js`, `core/core.js`, `bootstrap.js`,
  `preferences.xhtml`, `preferences.js`) + `test/llm.spec.js`.
- **No new dependencies.** Uses `URL`/`JSON` globals available in Firefox 115
  (the esbuild target). `buildChatCompletionsPayload` must avoid Node-only
  APIs — use `new URL(baseUrl).origin` for `llmLogMeta` host, guarded by
  try/catch so a malformed baseUrl never throws.

## Testing & verification playbook

1. **Unit (Vitest, no Zotero):** `npm test` — must include the new
   `test/llm.spec.js` and stay green. Focus: `npx vitest run test/llm.spec.js`.
2. **Build:** `npm run build` — must produce `.scaffold/build/*.xpi` and a
   `core.bundle.js` containing the `src/llm.js` exports (grep the bundle for
   `normalizeLLMSettings`).
3. **Manual (dev Zotero, `npm start` with a dedicated profile per
   `.env.example`):**
   - Settings → Obsidian Notes → LLM section: 8 controls show the Ollama-friendly defaults.
   - Auto-run checkbox disabled on first open (blank model).
   - Enter model `llama3` → auto-run checkbox enables; check it; clear model →
     checkbox disables, unchecks, and `Zotero.Prefs.get("…llmAutoRun", true)` is `false`.
   - With Ollama running: "Test connection" → status `LLM connection OK (llama3)`;
     `Zotero.debug` log line for the test contains `model`, `host`, `status`,
     `ms`, `hasApiKey` only (no key, no prompt, no response).
   - Bad base URL → status `LLM connection failed — <sanitized>`; no `Bearer`/key
     in the message; log still metadata-only.
   - Blank model + Test → status `Set LLM base URL and model in Settings first`
     (button-side gating also disables, but the method defends itself).
   - Note pane: blank model → no "Run LLM" button; set model → reopen item →
     button present; click → `LLM execution is not yet available in this beta`.
4. **Integration (optional, only if a mock endpoint exists):**
   `npm run test:zotero` — a new `test/integration/llm.spec.js` could assert
   `Zotero.ZON.testLLMConnection()` shape against a stubbed `Zotero.HTTP`.
   Out of scope for the issue's "outside Zotero" requirement; defer unless CI
   has an endpoint.
5. **CI order** (per `.github/workflows/ci.yml`): `npm test` → `npm run build`
   → upload xpi → `npm run test:zotero`. If the build config or shared
   contracts (`core/core.js`) change, treat as broad-verification — here only
   `core/core.js` gains one export line, so the full CI run is the gate.

## Acceptance checklist

- [ ] Preferences include LLM interpreter settings for base URL, model, optional API key, temperature, max output tokens, max context characters, timeout, and run-on-create/insert.
- [ ] Defaults are Ollama-friendly: base URL `http://localhost:11434/v1`, blank model, blank API key, temperature `0.2`, max output tokens `2048`, max context size `100000`, timeout `60` seconds, auto-run off.
- [ ] API key is optional and is not required for the configured state (`isLLMConfigured` ignores `apiKey`).
- [ ] Run LLM and auto-run controls are gated on non-empty base URL and model (`canRunLLM`/`canAutoRun` + UI gating).
- [ ] Auto-run cannot remain enabled when base URL or model becomes unset (`normalizeLLMSettings` + `preferences.js` `refreshGating`).
- [ ] Test LLM connection sends a minimal OpenAI-compatible Chat Completions request (`buildChatCompletionsPayload` + `Zotero.HTTP.request` POST) and reports success or a sanitized provider error (`sanitizeLLMError`).
- [ ] LLM-related logs include metadata only and never include API keys, prompts, responses, abstracts, annotations, or full text (`llmLogMeta` + `this.log` usage in `testLLMConnection`).
- [ ] Focused Vitest specs cover provider settings validation, default values, request payload construction, optional API key behavior, empty response handling, and sanitized error handling — all outside Zotero (`test/llm.spec.js`).
- [ ] `npm test` passes (new `test/llm.spec.js` included).
- [ ] `npm run build` succeeds with no build config changes.
- [ ] No inline user-visible strings in `bootstrap.js`; all new JS-emitted LLM text via `STRINGS` (XHTML static labels remain inline per existing pane convention — flagged decision point).
- [ ] No `&&` in single-command config fields; FTL `prefixLocaleFiles`/`prefixFluentMessages` untouched.
- [ ] Pure logic in `src/llm.js` with no Zotero/DOM deps.
