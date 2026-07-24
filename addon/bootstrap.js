"use strict";

// Paper Summarizer for Zotero – renders a Nunjucks template for an item into a
// native Zotero child note (a "Summary Note", ADR-0002) via the Composer pane.
//
// Pane lifecycle/registration patterns are lifted from the citation-links
// plugin (FTL insert-per-window, registerSection, the "find the CONNECTED
// collapsible-section body" trick — the body handed to onRender is often
// detached). The CodeMirror 6 editor (content/editor.bundle.js, global
// ZOSEditorLib { create, getDoc, setDoc, destroy }) now lives only inside the
// Template Builder — the item pane itself no longer edits a note.
//
// See CONTEXT.md for the domain vocabulary (Summary Note, Composer, Create-once,
// Marker Tag, Stale Indicator) and docs/adr/ for the decisions behind this fork.

var ZON = {
  pluginID: "__addonID__", // replaced at build time by scaffold (config.addonID)
  rootURI: null,
  _registeredPaneID: null,

  PREF_TEMPLATES_DIR: "extensions.zotero-obsidian-notes.templatesDir",
  PREF_DEFAULT_NOTE: "extensions.zotero-obsidian-notes.defaultNoteTemplate",
  PREF_COLLAPSED: "extensions.zotero-obsidian-notes.sectionCollapsed",
  PREF_LLM_BASE_URL: "extensions.zotero-obsidian-notes.llmBaseURL",
  PREF_LLM_MODEL: "extensions.zotero-obsidian-notes.llmModel",
  PREF_LLM_API_KEY: "extensions.zotero-obsidian-notes.llmApiKey",
  PREF_LLM_TEMPERATURE: "extensions.zotero-obsidian-notes.llmTemperature",
  PREF_LLM_MAX_TOKENS: "extensions.zotero-obsidian-notes.llmMaxTokens",
  PREF_LLM_MAX_CONTEXT: "extensions.zotero-obsidian-notes.llmMaxContextChars",
  PREF_LLM_TIMEOUT: "extensions.zotero-obsidian-notes.llmTimeoutSeconds",
  PREF_LLM_CONCURRENCY: "extensions.zotero-obsidian-notes.llmConcurrency",
  PREF_LLM_AUTORUN: "extensions.zotero-obsidian-notes.llmAutoRun",
  // One-time migration flag: set after the vault-era templatesDir pref has been
  // cleared so the addon-owned folder (defaultTemplatesDir) takes effect.
  PREF_TEMPLATES_MIGRATED: "extensions.zotero-obsidian-notes.templatesMigrated",
  // Templates folder: holds note.md (whole-note scaffold) + one file per
  // insertable block template. The pref default is intentionally empty —
  // empty means "use the addon-owned folder" (defaultTemplatesDir()).
  DEFAULT_TEMPLATES_DIR: "",
  NOTE_SCAFFOLD_NAME: "note", // <templatesDir>/note.md = the default whole-note scaffold
  DEFAULT_DEFAULT_NOTE: "note", // which note scaffold "Create note" uses by default
  // The Zotero tag stamped on every generated Summary Note (ADR-0002) — the sole
  // mechanism by which the plugin recognizes its own notes. Reused by later slices
  // (already-has-one checks, stale indicator). Body edits never affect it.
  MARKER_TAG: "zps:summary-note",
  DEFAULT_COLLAPSED: false, // section starts expanded; the header chevron folds it (persisted)
  DEFAULT_LLM_BASE_URL: "http://localhost:11434/v1",
  DEFAULT_LLM_MODEL: "",
  DEFAULT_LLM_API_KEY: "",
  DEFAULT_LLM_TEMPERATURE: 0.2,
  DEFAULT_LLM_MAX_TOKENS: 2048,
  DEFAULT_LLM_MAX_CONTEXT: 100000,
  DEFAULT_LLM_TIMEOUT: 60,
  DEFAULT_LLM_CONCURRENCY: 1, // parallel Run-LLM requests; keep 1 for a local serial Ollama
  DEFAULT_LLM_AUTORUN: false,
  DEFAULT_TEMPLATES_MIGRATED: false,
  _templates: null,

  // Starter templates that ship WITH the plugin. They serve two purposes:
  //  1. seedTemplatesFolder() writes any that are MISSING into the addon-owned
  //     templates folder on every startup (existing files are never overwritten),
  //     so the user owns + edits them in the Template Builder;
  //  2. they're a zero-config fallback — even before seeding runs, the Composer
  //     and Builder work out of the box (see loadTemplates / resolveNoteScaffoldText).
  // Keyed by filename stem; written as `<stem>.md`.
  // Kinds are auto-detected (templateKindOf): `note*` = whole-note scaffolds,
  // `abstract` = a field block, the rest = per-annotation block formats.
  // Obsidian-free by design: no YAML frontmatter, no [[wikilinks]], no > [!callouts].
  // No leading H1 either — the generate/preview pipeline prepends the
  // `# Summary: <item title>` heading itself (withSummaryTitle).
  BUILTIN_TEMPLATES: {
    "note": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

> **Abstract:**{% if abstractNote %} {{abstractNote}}{% endif %}

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
    "note-minimal": `[Open in Zotero]({{desktopURI}})

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
    "note-by-colour": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

## Key passages (yellow)
{{ highlights(colour="yellow", format="quote") }}

## Critiques (red)
{{ highlights(colour="red", format="quote") }}

## To follow up (blue)
{{ highlights(colour="blue", format="quote") }}
`,
    "abstract": `%%! kind=field sync=on %%
> **Abstract:**
> {{abstractNote}}
`,
    "critique": `%%! colour=red sync=on sep=blank %%
> **p.{{page}}:** {{text}}{% if comment %}
>
> {{comment}}{% endif %}
`,
    "key-quote": `%%! colour=yellow sync=on sep=blank %%
> {{text}}
> — [p.{{page}}]({{link}})
{% if comment %}>
> {{comment}}{% endif %}
`,
    "highlight": `- [p.{{page}}]({{link}}) "{{text}}"{% if comment %} — *{{comment}}*{% endif %}
`,
    "snapshot": `%%! sync=off %%
- [p.{{page}}]({{link}}) "{{text}}"{% if comment %} — *{{comment}}*{% endif %}
`,
    "research-questions": `%%! kind=section sync=on %%
## Research Questions

{% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}
`,
    "note-quantitative": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

> **Abstract:**{% if abstractNote %} {{abstractNote}}{% endif %}

## Summary
### Research Question(s)
{% llm context="fulltext" %}What is/are the research question(s) the paper answers? Render as concrete bullet points.{% endllm %}

### Hypotheses
{% llm context="fulltext" %}What are the paper's hypotheses? State them verbatim where possible. Render as concrete bullet points.{% endllm %}

### Theoretical Framework
{% llm context="fulltext" %}What core theoretical concepts and arguments does the paper build on or contribute? Render as concrete bullet points.{% endllm %}

### Study Design
{% llm context="fulltext" %}Extract the study design as concrete facts. Cover: Type (classify as one of Experiment, Survey, Content Analysis, Panel, Field Study, or Meta-Analysis); Data source; Sample/setting (N, population, context); Time period.{% endllm %}

### Key Variables
{% llm context="fulltext" %}List the key variables as a markdown table with columns Role, Variable, and Operationalization, with one row each for Independent, Dependent, Moderator, Mediator, and Control. Omit any row that does not apply.{% endllm %}

### Main Findings
{% llm context="fulltext" %}What are the key findings? Render as concrete bullet points, noting the direction of each effect and its statistical significance where stated.{% endllm %}

### Limitations
{% llm context="fulltext" %}What limitations does the paper acknowledge, especially about its analytical approach? Render as concrete bullet points.{% endllm %}

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
    "note-qualitative": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

> **Abstract:**{% if abstractNote %} {{abstractNote}}{% endif %}

## Summary
### Research Question(s)
{% llm context="fulltext" %}What is/are the research question(s) or interpretive aims of this study? Render as concrete bullet points.{% endllm %}

### Theoretical Framing
{% llm context="fulltext" %}What theoretical or conceptual lens frames the analysis? Render as concrete bullet points.{% endllm %}

### Methods & Data
{% llm context="fulltext" %}Extract the qualitative design as concrete facts. Cover: Approach (classify as one of ethnography, grounded theory, case study, interview study, or discourse/content analysis); Data sources; Sampling and setting (who, where, how many); Analytic strategy (e.g. coding, thematic analysis).{% endllm %}

### Key Themes / Findings
{% llm context="fulltext" %}What are the central themes or findings? Render as concrete bullet points, one per theme, each with a short gloss.{% endllm %}

### Interpretation & Contribution
{% llm context="fulltext" %}How does the paper interpret its findings, and what does it claim to contribute theoretically or empirically? Render as concrete bullet points.{% endllm %}

### Trustworthiness & Limitations
{% llm context="fulltext" %}What does the paper say about trustworthiness or rigour (e.g. reflexivity, triangulation, member checking), and what limitations does it acknowledge? Render as concrete bullet points.{% endllm %}

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
    "note-theoretical": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

> **Abstract:**{% if abstractNote %} {{abstractNote}}{% endif %}

## Summary
### Motivating Problem
{% llm context="fulltext" %}What problem, puzzle, or gap motivates this theoretical contribution? Render as concrete bullet points.{% endllm %}

### Core Constructs & Definitions
{% llm context="fulltext" %}What are the central constructs and how does the paper define them? Render as a markdown table with columns Construct and Definition.{% endllm %}

### Central Propositions / Arguments
{% llm context="fulltext" %}What are the paper's key propositions or arguments? State them verbatim or as close paraphrases. Render as a numbered list.{% endllm %}

### Model / Mechanism
{% llm context="fulltext" %}What is the proposed model or causal mechanism, and how do the core constructs relate? Describe it concisely as concrete bullet points.{% endllm %}

### Scope Conditions & Assumptions
{% llm context="fulltext" %}Under what scope conditions or assumptions does the argument hold? Render as concrete bullet points.{% endllm %}

### Contribution & Critique
{% llm context="fulltext" %}What does the paper claim to contribute, and what tensions, boundary cases, or open questions does it leave? Render as concrete bullet points.{% endllm %}

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
    "note-review": `**Citation:** {{bibliography}}

[Open in Zotero]({{desktopURI}}){% if openPdf %} · [Open PDF]({{openPdf}}){% endif %}

> **Abstract:**{% if abstractNote %} {{abstractNote}}{% endif %}

## Summary
### Scope & Review Questions
{% llm context="fulltext" %}What is the scope of this review and what questions does it address? Render as concrete bullet points.{% endllm %}

### Corpus & Method
{% llm context="fulltext" %}Extract the review method as concrete facts. Cover: Review type (classify as one of narrative, systematic, scoping, or meta-analysis); Databases or sources searched; Inclusion and exclusion criteria; Number of studies included; Time span.{% endllm %}

### Organizing Framework
{% llm context="fulltext" %}How does the review organize the literature (e.g. by themes, chronology, theoretical camps, or methods)? Render as concrete bullet points.{% endllm %}

### Key Findings / Debates
{% llm context="fulltext" %}What are the main findings, points of consensus, and unresolved debates in the literature as synthesized here? Render as concrete bullet points.{% endllm %}

### Identified Gaps
{% llm context="fulltext" %}What gaps or limitations in the existing literature does the review identify? Render as concrete bullet points.{% endllm %}

### Future Research Agenda
{% llm context="fulltext" %}What future research directions does the review propose? Render as concrete bullet points.{% endllm %}

## Notes


## Annotations
%% zon kind=annotations colour=all sync=on format=list %%
%% /zon %%
`,
  },


  // ---------------------------------------------------------------- lifecycle

  async init(rootURI) {
    this.rootURI = rootURI;
    try { Zotero.ZON = this; } catch (e) {} // dev handle for console-driven testing
    this.seedDefaults();
    // A fresh init means any existing editor wraps belong to a previous (now
    // defunct) instance — e.g. a hot-reinstall whose shutdown didn't fully tear
    // down. Destroy them up front so we never end up with several CodeMirror
    // views live in the same document (which corrupts the caret while typing).
    try { for (let win of Zotero.getMainWindows()) this.removeWraps(win); } catch (e) {}
    this.migrateTemplatesDir();
    this.seedTemplatesFolder()
      .then(() => this.loadTemplates())
      .catch((e) => this.log("seed/loadTemplates failed: " + e));
    for (let win of Zotero.getMainWindows()) this.addToWindow(win);
    try { this.registerSection(); } catch (e) { this.log("registerSection failed: " + e); }
    try {
      if (Zotero.PreferencePanes && Zotero.PreferencePanes.register) {
        Zotero.PreferencePanes.register({
          pluginID: this.pluginID,
          src: this.rootURI + "content/preferences.xhtml",
          label: "Paper Summarizer",
          image: this.icon,
          scripts: [this.rootURI + "content/preferences.js"],
        });
      }
    } catch (e) { this.log("prefpane register failed: " + e); }
    this.log("initialized");
  },

  uninit() {
    try { if (this._registeredPaneID) Zotero.ItemPaneManager.unregisterSection(this._registeredPaneID); } catch (e) {}
    // Tear down per-window state so a reinstall hot-reloads cleanly: drop our
    // content wraps (incl. shadow DOM), remove the injected bundle <script>, and
    // clear the global so startup re-injects the new one.
    for (let win of Zotero.getMainWindows()) {
      try {
        this.removeWraps(win);
        try { this.removeItemMenu(win); } catch (e) {}
        try { if (win._zonFocusHandler) { win.removeEventListener("focus", win._zonFocusHandler, true); win._zonFocusHandler = null; } } catch (e) {}
        try { if (win._zonThemeMO) win._zonThemeMO.disconnect(); win._zonThemeMO = null; } catch (e) {}
        try { if (win._zonThemeMQ && win._zonThemeMQH) win._zonThemeMQ.removeEventListener("change", win._zonThemeMQH); } catch (e) {}
        for (let id of ["zon-editor-lib", "zon-core-lib", "zon-toolbar-css"]) {
          let s = win.document.getElementById(id);
          if (s) s.remove();
        }
        try { win.ZOSEditorLib = undefined; } catch (e) {}
        try { win.ZONCore = undefined; } catch (e) {}
      } catch (e) {}
    }
    try { Zotero.ZON = undefined; } catch (e) {}
  },

  // Destroy every editor and remove every `.zon-content` wrap in a window
  // (including ones nested in shadow roots). Used by uninit and by init (to
  // clear anything a previous instance left behind).
  removeWraps(win) {
    let walk = (root) => {
      if (!root || !root.querySelectorAll) return;
      let ws;
      try { ws = root.querySelectorAll(".zon-content"); } catch (e) { return; }
      for (let w of ws) {
        try { if (w._zon && w._zon._fitRO) w._zon._fitRO.disconnect(); } catch (e) {}
        try { if (w._zon && w._zon.lib && w._zon.view) w._zon.lib.destroy(w._zon.view); } catch (e) {}
        try { w._zon = null; } catch (e) {}
        try { w.remove(); } catch (e) {}
      }
      try { for (let el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); } catch (e) {}
    };
    walk(win.document);
  },

  addToWindow(win) {
    try {
      let links = win.document.querySelectorAll(
        'link[rel="localization"][href="zotero-obsidian-notes.ftl"]');
      for (let l of links) l.remove();
      win.MozXULElement.insertFTLIfNeeded("zotero-obsidian-notes.ftl");
    } catch (e) { this.log("FTL insert failed: " + e); }
    // Inject the core bundle so window.ZONCore (nunjucks renderer + block engine)
    // is available for create-from-template / annotation sync. The EDITOR bundle
    // is NOT injected here — it loads inside each editor's <iframe> instead, so
    // CodeMirror runs in a real HTML document with a working DOM Selection (see
    // mountEditor).
    this.injectCore(win).catch((e) => this.log("core inject failed: " + e));
    this.watchTheme(win);
    try { this.addItemMenu(win); } catch (e) { this.log("addItemMenu failed: " + e); }
    this.watchWindowFocus(win);
  },

  // Re-read the templates folder on window focus, so template edits made in
  // another app show up without restarting Zotero (the natural moment: you edit
  // a template file elsewhere, then switch back to Zotero). Debounced because
  // focus fires often.
  watchWindowFocus(win) {
    try {
      if (win._zonFocusHandler) win.removeEventListener("focus", win._zonFocusHandler, true);
      let self = this, t = null;
      win._zonFocusHandler = function () {
        try { if (t) win.clearTimeout(t); } catch (e) {}
        t = win.setTimeout(function () {
          self.refreshTemplates().catch(function () {});
        }, 200);
      };
      win.addEventListener("focus", win._zonFocusHandler, true);
    } catch (e) { this.log("watchWindowFocus failed: " + e); }
  },

  // Re-read the templates folder so edits/additions made in another app show up
  // without restarting Zotero. Called on window focus (the natural moment: you
  // edit a template file elsewhere, then switch back to Zotero). Content edits
  // are picked up silently — the next Insert resolves from the refreshed set;
  // when the set of template NAMES changes (added/renamed/removed) the open
  // pickers are repopulated too, so the dropdown stays current. Repopulating
  // only on a name change avoids resetting a manually-chosen colour/sync on
  // every alt-tab (populating re-applies the template's default colour/sync).
  async refreshTemplates() {
    let before = Object.keys(this._templates || {}).sort().join("\n");
    try { await this.loadTemplates(); } catch (e) { return; }
    let after = Object.keys(this._templates || {}).sort().join("\n");
    if (before === after) return;
    for (let rec of this.openRecs()) {
      try { await this.populateComposerTemplates(rec); } catch (e) {}
    }
  },

  // Re-theme live editors when Zotero's light/dark scheme changes. Each editor is
  // in its own iframe and doesn't inherit Zotero's theme, and the colours are
  // chosen at mount; without this, toggling the theme leaves an open editor in the
  // old scheme (e.g. dark text on a now-dark background). We watch both the OS
  // media query (Automatic mode) and attribute changes on the chrome root (an
  // explicit Light/Dark choice in Zotero settings), then re-detect per editor.
  watchTheme(win) {
    let self = this;
    let refresh = function () {
      let walk = function (root) {
        if (!root || !root.querySelectorAll) return;
        let ws;
        try { ws = root.querySelectorAll(".zon-content"); } catch (e) { return; }
        for (let w of ws) {
          let rec = w._zon;
          if (rec && rec.lib && rec.lib.setDark && rec.view) {
            let dk = self.isDarkTheme(win, rec.host);
            if (dk !== rec._lastDark) { rec._lastDark = dk; try { rec.lib.setDark(rec.view, dk); } catch (e) {} }
          }
        }
        try { for (let el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); } catch (e) {}
      };
      walk(win.document);
    };
    // Tear down any watcher from a previous (hot-reloaded) instance first.
    try { if (win._zonThemeMO) win._zonThemeMO.disconnect(); } catch (e) {}
    try { if (win._zonThemeMQ && win._zonThemeMQH) win._zonThemeMQ.removeEventListener("change", win._zonThemeMQH); } catch (e) {}
    try {
      let mq = win.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", refresh);
      win._zonThemeMQ = mq; win._zonThemeMQH = refresh;
    } catch (e) {}
    try {
      let mo = new win.MutationObserver(refresh);
      mo.observe(win.document.documentElement, { attributes: true });
      win._zonThemeMO = mo;
    } catch (e) {}
  },

  log(msg) { try { Zotero.debug("ZON: " + msg); } catch (e) {} },

  // ---------------------------------------------------------------- strings
  // All user-facing text in one place (English). Translation-ready: a future
  // locale can supply a translated map or wire t() to Fluent. (The item-pane
  // section header/sidenav must use Zotero's l10nID mechanism — see the .ftl.)
  STRINGS: {
    "btn.builder": "Template Builder…",
    "tip.builder": "Author a template with a live preview, then save it to your Templates folder — the Composer uses it to generate the note",
    "status.templateSaved": "Saved template ‘{name}’ to your Templates folder",
    "msg.builderOverwrite": "A template named ‘{name}.md’ already exists. Overwrite it?",
    "label.autoSync": "Auto-sync",
    "tip.autoSync": "Automatically pull new highlights into this note as you annotate the PDF (applies to all notes).",
    "menu.title": "Obsidian Notepad",
    "menu.findDOI": "Find DOI (Crossref)",
    "menu.findDOIN": "Find DOIs for {count} items (Crossref)",
    "menu.generateSummary": "Generate summary note…",
    "menu.generateSummaryN": "Generate {count} summary notes…",
    "summary.generatingTitle": "Generating summary notes…",
    "summary.createdSummary": "Summary notes — created {created}, failed {failed}.",
    // Bulk AI summary generation (right-click on a multi-item selection).
    "bulk.dialogTitle": "Generate summary notes for {count} paper(s)",
    "bulk.templateLabel": "Template",
    "bulk.policySkip": "Skip papers that already have a Summary Note (default)",
    "bulk.policyAdditional": "Create an additional Summary Note for every paper",
    "bulk.policyOverwrite": "Overwrite the newest Summary Note (replaces its entire content — hand edits in Better Notes will be lost)",
    "bulk.llmHeadsUp": "Runs the LLM — up to {n} model calls.",
    "bulk.llmNotConfigured": "This template uses the LLM interpreter, which is not configured. Set base URL and model in preferences.",
    "bulk.generate": "Generate",
    "bulk.cancel": "Cancel",
    "bulk.progress": "Summarizing {i}/{n}…",
    "bulk.done": "created {created}, overwritten {overwritten}, skipped {skipped}, failed {failed}",
    "bulk.failureLine": "{title}: {reason}",
    // Composer pane (item-pane section): template picker + live preview + Generate.
    "composer.title": "Composer",
    "btn.generate": "Generate",
    "tip.generate": "Create a Summary Note for this item from the selected template",
    "tip.composerTemplate": "Template used to render this item's Summary Note preview and the note Generate creates",
    "composer.rendering": "Rendering preview…",
    "composer.previewEmpty": "This template renders no visible content for this item.",
    "composer.previewFailed": "Preview failed: {error}",
    "composer.generating": "Generating…",
    "composer.generated": "Summary Note created.",
    "composer.overwritten": "Summary Note overwritten.",
    "composer.generateFailed": "Generate failed: {error}",
    // Note awareness + Stale Indicator (#28) — read-only, never triggers a write.
    "composer.notes.stale": "Stale — annotations newer than the latest summary",
    "composer.notes.empty": "No summary note yet — Generate creates one",
    "composer.notes.untitled": "(untitled)",
    "composer.notes.open": "Open this Summary Note",
    "composer.overwriteChoice": "This item already has {count} Summary Note(s), recognised by tag.\n\nOverwrite the NEWEST one with a fresh render instead of creating an additional note? Overwriting replaces its entire content — hand edits made in Better Notes will be lost.\n\nChoose Cancel to create an additional Summary Note instead.",
    // LLM gating in the Composer (#27, ADR-0001).
    "composer.generateBlocked": "unresolved {% llm %} block(s)",
    "tip.composerRunLLM": "Run the LLM interpreter on this template's {% llm %} blocks so the Summary Note can be generated (requires base URL and model)",
    "err.generateBlocked": "Cannot generate yet — {reason}",
    "err.generateGateUnavailable": "plugin bundle out of date — cannot verify {% llm %} blocks; not generating. Try restarting Zotero.",
    "err.llmRunUnexpected": "LLM run failed unexpectedly — {error}",
    "doi.searching": "Searching Crossref for DOIs…",
    "doi.noneMissing": "All selected items already have a DOI.",
    "doi.summary": "DOIs — found {found}, no confident match {none}, failed {failed}.",
    "btn.testLLM": "Test LLM connection",
    "status.llmTestOk": "LLM connection successful",
    "status.llmTestFail": "LLM connection failed: {error}",
    "status.llmTestEmpty": "LLM connection returned an empty response",
    "status.llmTesting": "Testing…",
    "err.llmNotConfigured": "LLM interpreter is not configured. Set base URL and model in preferences.",
    "err.llmCoreMissing": "LLM core module is not loaded. Try restarting Zotero.",
    "label.llmAutoRun": "Run LLM automatically on note create/insert",
    "tip.llmAutoRun": "Automatically run the LLM interpreter when creating or inserting a note (requires base URL and model)",
    "err.llmBlocksInvalid": "LLM block errors — fix the template before inserting. ({count} error(s))",
    "btn.runLLM": "Run LLM",
    "status.llmRunning": "Running LLM — {i}/{n} done…",
    "status.llmRunDone": "Ran LLM — {count} block(s) updated",
    "status.llmRunNoBlocks": "No {% llm %} blocks to run",
    "err.llmRunFailed": "LLM run failed — {error}",
    "err.llmRunBlock": "LLM block (line {line}): {message}",
    "err.llmRunHttp": "block {i}/{n} failed: {error}",
    "err.llmRunEmpty": "block {i}/{n} returned an empty response",
  },

  // Look up a string by key, interpolating {name} placeholders from `args`.
  t(key, args) {
    let s = this.STRINGS[key];
    if (s == null) return key;
    if (args) for (let k in args) s = s.split("{" + k + "}").join(String(args[k]));
    return s;
  },

  // ---------------------------------------------------------------- prefs

  templatesDir() { return Zotero.Prefs.get(this.PREF_TEMPLATES_DIR, true) || this.defaultTemplatesDir(); },

  // The addon-owned templates folder: lives under the Zotero data directory so the
  // plugin manages its own templates instead of pointing into a (vault-era) user
  // folder. Used whenever the templatesDir pref is blank — the pref still lets a
  // user relocate the folder deliberately via the prefs pane.
  defaultTemplatesDir() {
    try { return PathUtils.join(Zotero.DataDirectory.dir, "paper-summarizer", "templates"); }
    catch (e) { return ""; }
  },

  // One-time migration (issue #41): a vault-era templatesDir pref would keep
  // shadowing the addon-owned folder (its old Obsidian-flavoured files override
  // builtins by name). Clear it once so defaultTemplatesDir takes effect; the old
  // folder itself is left untouched on disk.
  migrateTemplatesDir() {
    try {
      if (Zotero.Prefs.get(this.PREF_TEMPLATES_MIGRATED, true)) return;
      let cur = Zotero.Prefs.get(this.PREF_TEMPLATES_DIR, true);
      if (cur && cur !== this.defaultTemplatesDir()) Zotero.Prefs.set(this.PREF_TEMPLATES_DIR, "", true);
      Zotero.Prefs.set(this.PREF_TEMPLATES_MIGRATED, true, true);
    } catch (e) { this.log("migrateTemplatesDir failed: " + e); }
  },

  // Seed the templates folder with the builtin starters: create the folder and
  // write each builtin as `<name>.md` ONLY if that file is missing — user edits
  // are never overwritten (deleting a seeded file restores it on next startup).
  // Writes go through safeWrite (atomic tmp+rename), same as Builder saves.
  async seedTemplatesFolder() {
    let dir = this.templatesDir();
    if (!dir) return;
    try { await IOUtils.makeDirectory(dir, { ignoreExisting: true, createAncestors: true }); }
    catch (e) { this.log("seedTemplatesFolder mkdir failed: " + e); return; }
    for (let name of Object.keys(this.BUILTIN_TEMPLATES)) {
      try {
        let p = PathUtils.join(dir, name + ".md");
        if (!(await IOUtils.exists(p))) await this.safeWrite(p, this.BUILTIN_TEMPLATES[name]);
      } catch (e) { this.log("seedTemplatesFolder write failed for " + name + ": " + e); }
    }
  },
  defaultNoteTemplate() { return Zotero.Prefs.get(this.PREF_DEFAULT_NOTE, true) || this.DEFAULT_DEFAULT_NOTE; },

  // Whole-note scaffolds available in the Templates folder: every file named
  // `note` or `note-*` (so you can keep several, e.g. note-book / note-article).
  // Returns [{ name, path }], note-scaffold names without the extension.
  async noteTemplates() {
    let out = [];
    let dir = this.templatesDir();
    if (dir) {
      let children;
      try { children = await IOUtils.getChildren(dir); } catch (e) { children = []; }
      for (let p of children) {
        if (!/\.(njk|md|txt)$/i.test(p)) continue;
        let name = PathUtils.filename(p).replace(/\.(njk|md|txt)$/i, "");
        if (/^note(-.*)?$/i.test(name)) out.push({ name, path: p });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  // Resolve the TEXT of a note scaffold by name, in priority order:
  //   user Templates folder file → shipped BUILTIN_TEMPLATES.
  // Guarantees "Create note" / "Manage fields" have a real scaffold even when the
  // Templates folder hasn't been seeded yet (fresh install). Returns "" only if
  // nothing resolves (and the named template isn't a built-in).
  async resolveNoteScaffoldText(name) {
    name = name || this.defaultNoteTemplate() || this.NOTE_SCAFFOLD_NAME;
    let dir = this.templatesDir();
    if (dir) {
      let p = PathUtils.join(dir, name + ".md");
      try { if (await IOUtils.exists(p)) return await IOUtils.readUTF8(p); } catch (e) {}
    }
    if (this.BUILTIN_TEMPLATES[name] != null) return this.BUILTIN_TEMPLATES[name];
    return "";
  },

  // Parse a template file into { item, sep, defaults }. Mirrors
  // src/templates.js parseTemplateFile (kept here because loading runs in the
  // privileged scope before the core bundle is guaranteed present). An optional
  // first line `%%! colour=.. sync=.. sep=blank|newline %%` pins this template's
  // defaults; the rest is the per-annotation Nunjucks body.
  parseTemplateText(text) {
    let raw = String(text).replace(/\s+$/, "");
    let lines = raw.split("\n");
    let defaults = {}, sepMode = null;
    let m = lines.length ? lines[0].match(/^\s*%%!\s*([^%]*?)\s*%%\s*$/) : null;
    if (m) {
      for (let tok of m[1].trim().split(/\s+/)) {
        if (!tok) continue;
        let i = tok.indexOf("=");
        if (i > 0) defaults[tok.slice(0, i)] = tok.slice(i + 1);
        else defaults[tok] = true;
      }
      if (defaults.sep) { sepMode = defaults.sep; delete defaults.sep; }
      if (defaults.color && !defaults.colour) defaults.colour = defaults.color;
      delete defaults.color;
      lines.shift();
    }
    let body = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    let sep = sepMode === "blank" ? "\n\n"
      : sepMode === "newline" ? "\n"
      : (body.includes("\n") ? "\n\n" : "\n");
    return { item: body, sep, defaults };
  },

  // Classify a template (mirrors src/templates.js templateKind): a "document" has
  // YAML frontmatter and/or a `%% zon %%` block (rendered whole, once, with the
  // item's data); a "format" is a per-annotation body (rendered once per highlight,
  // wrapped in a zon block on insert).
  templateKindOf(text) {
    let t = String(text || "");
    // A leading `%%! ... %%` directive marks a template as a block explicitly,
    // overriding content sniffing — lets a template that would otherwise sniff
    // as "document" (e.g. it contains an {% llm %} block) declare itself a
    // reusable building block instead (see the research-questions builtin).
    if (/^\s*%%!\s*[^%]*?\s*%%\s*(\r?\n|$)/.test(t)) return "format";
    if (/^---\r?\n[\s\S]*?\r?\n---/.test(t)) return "document";
    if (/%%\s*zon\b/.test(t)) return "document";
    if (/\{%\s*llm\b/.test(t)) return "document";   // mirrors hasLLMBlocks
    // Whole-note templates built from colour-routed highlights() calls (e.g. the
    // frontmatter-free note-by-colour builtin) render once per item too.
    if (/\{\{\s*highlights\s*\(/.test(t)) return "document";
    return "format";
  },

  // Frontmatter fields the user owns (mirrors src/templates.js): a field with a
  // `{{ }}` / `{% %}` expression auto-updates from Zotero on Refresh; a plain field
  // (e.g. `KeyIdea:`) is preserved.
  templateUserOwnedKeys(text) {
    let m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return [];
    let lines = m[1].split("\n"), keys = [], cur = null, hasExpr = false;
    let isExpr = (s) => /\{\{|\{%/.test(s);
    let flush = () => { if (cur && !hasExpr) keys.push(cur); };
    for (let line of lines) {
      let km = line.match(/^([A-Za-z0-9_-]+):/);
      if (km && !/^\s/.test(line)) { flush(); cur = km[1]; hasExpr = isExpr(line); }
      else if (cur && isExpr(line)) hasExpr = true;
    }
    flush();
    return keys;
  },

  // Load EVERY template from the unified Templates folder (+ legacy formats folder)
  // into one map keyed by filename. Each entry is classified:
  //   document → { kind:'document', text }            (whole-note template)
  //   format   → { kind:'format', item, sep, defaults } (per-annotation body)
  // This is the single source for both the Insert dropdown and the Create picker —
  // any template can be inserted at the cursor OR used to create a whole note.
  async loadTemplates() {
    let out = {};
    let load = async (dir) => {
      if (!dir) return;
      let children;
      try { children = await IOUtils.getChildren(dir); }
      catch (e) { return; } // missing folder is fine — built-ins still apply
      for (let p of children) {
        if (!/\.(njk|md|txt)$/i.test(p)) continue;
        let name = PathUtils.filename(p).replace(/\.(njk|md|txt)$/i, "");
        if (/^(templates|readme)$/i.test(name)) continue; // docs files, not templates
        try {
          let text = await IOUtils.readUTF8(p);
          if (this.templateKindOf(text) === "document") out[name] = { kind: "document", text };
          else out[name] = Object.assign({ kind: "format" }, this.parseTemplateText(text));
        } catch (e) {}
      }
    };
    this.addBuiltins(out);             // shipped starters (lowest priority)
    await load(this.templatesDir());   // templates folder (wins — user files override)
    this._templates = out;
    return out;
  },

  // Seed `out` with the plugin's BUILTIN_TEMPLATES, classified exactly like a
  // loaded file. User-folder files of the same name override these afterwards.
  addBuiltins(out) {
    for (let name of Object.keys(this.BUILTIN_TEMPLATES)) {
      let text = this.BUILTIN_TEMPLATES[name];
      if (this.templateKindOf(text) === "document") out[name] = { kind: "document", text };
      else out[name] = Object.assign({ kind: "format" }, this.parseTemplateText(text));
    }
  },

  // The full unified template list (shipped formats + the user's files), keyed by
  // name. Used to populate the Template dropdown / Create picker.
  allTemplates(win) {
    let defs = (win && win.ZONCore && win.ZONCore.DEFAULT_FORMATS) || {};
    let builtin = {};
    for (let k of Object.keys(defs)) builtin[k] = Object.assign({ kind: "format" }, defs[k]);
    return Object.assign({}, builtin, this._templates || {});
  },

  // Just the FORMAT-kind templates (built-ins + custom), as { name: {item, sep} } —
  // the per-annotation bodies that syncBlocks / makeBlock resolve format names against.
  formatMap(win) {
    let out = {};
    let all = this.allTemplates(win);
    for (let k of Object.keys(all)) if (all[k].kind === "format") out[k] = all[k];
    // Always-available item-field formats (citation/abstract/title/authors) so
    // `kind=field` blocks resolve with zero setup. A same-named Templates-folder
    // file (already in `out`) overrides them.
    let ff = (win && win.ZONCore && win.ZONCore.FIELD_FORMATS) || {};
    for (let k of Object.keys(ff)) if (!out[k]) out[k] = ff[k];
    return out;
  },

  // Order the NOTE-TYPE (document-kind only) template names with the default
  // note scaffold first, then the rest alphabetically — so the Composer picker
  // opens on the user's default. Format-kind building blocks (per-annotation /
  // field bodies) are deliberately excluded: they're not something you generate
  // a whole note from, they're referenced by name from inside a note template
  // via `format=` markers / `highlights(...)`, and remain reachable through the
  // Template Builder's block configurator.
  orderedTemplateNames(win) {
    let all = this.allTemplates(win);
    let names = Object.keys(all).filter((k) => all[k].kind === "document");
    if (!names.length) names = ["note"];
    let def = this.defaultNoteTemplate();
    names.sort((a, b) => (a === def ? -1 : b === def ? 1 : a.localeCompare(b)));
    return names;
  },

  // Window-INDEPENDENT NOTE-TYPE (document-kind only) name list for the Settings
  // "Default note template" dropdown. The prefs-pane script scope can't reliably
  // enumerate the folder (IOUtils/PathUtils aren't dependable globals there —
  // same class of issue as Services), so it asks the plugin instead: this reads
  // `_templates` (already loaded in the privileged main-window scope), filtered
  // to whole-note scaffolds — format-kind building blocks are excluded, same as
  // the Composer picker (orderedTemplateNames).
  prefsTemplateNames() {
    let names = new Set(["note"]);
    for (let k of Object.keys(this._templates || {})) {
      if (/^(templates|readme)$/i.test(k)) continue;
      if (this._templates[k].kind === "document") names.add(k);
    }
    let def = this.defaultNoteTemplate();
    if (def && (!this._templates || !this._templates[def] || this._templates[def].kind === "document")) names.add(def);
    return [...names].sort();
  },

  // Store defaults for any unset pref so the preferences pane shows real values
  // (its inputs bind to the stored pref, which is blank/"undefined" otherwise).
  seedDefaults() {
    let seed = (key, def) => {
      try { if (Zotero.Prefs.get(key, true) === undefined) Zotero.Prefs.set(key, def, true); } catch (e) {}
    };
    seed(this.PREF_TEMPLATES_DIR, this.DEFAULT_TEMPLATES_DIR);
    seed(this.PREF_DEFAULT_NOTE, this.DEFAULT_DEFAULT_NOTE);
    seed(this.PREF_COLLAPSED, this.DEFAULT_COLLAPSED);
    seed(this.PREF_LLM_BASE_URL, this.DEFAULT_LLM_BASE_URL);
    seed(this.PREF_LLM_MODEL, this.DEFAULT_LLM_MODEL);
    seed(this.PREF_LLM_API_KEY, this.DEFAULT_LLM_API_KEY);
    seed(this.PREF_LLM_TEMPERATURE, this.DEFAULT_LLM_TEMPERATURE);
    seed(this.PREF_LLM_MAX_TOKENS, this.DEFAULT_LLM_MAX_TOKENS);
    seed(this.PREF_LLM_MAX_CONTEXT, this.DEFAULT_LLM_MAX_CONTEXT);
    seed(this.PREF_LLM_TIMEOUT, this.DEFAULT_LLM_TIMEOUT);
    seed(this.PREF_LLM_CONCURRENCY, this.DEFAULT_LLM_CONCURRENCY);
    seed(this.PREF_LLM_AUTORUN, this.DEFAULT_LLM_AUTORUN);
    seed(this.PREF_TEMPLATES_MIGRATED, this.DEFAULT_TEMPLATES_MIGRATED);
  },

  sectionCollapsed() {
    try { let v = Zotero.Prefs.get(this.PREF_COLLAPSED, true); return v === undefined ? this.DEFAULT_COLLAPSED : !!v; }
    catch (e) { return this.DEFAULT_COLLAPSED; }
  },
  // ---- LLM prefs
  llmBaseURL() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_BASE_URL, true); return v === undefined ? this.DEFAULT_LLM_BASE_URL : v; }
    catch (e) { return this.DEFAULT_LLM_BASE_URL; }
  },
  llmModel() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_MODEL, true); return v === undefined ? this.DEFAULT_LLM_MODEL : v; }
    catch (e) { return this.DEFAULT_LLM_MODEL; }
  },
  llmApiKey() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_API_KEY, true); return v === undefined ? this.DEFAULT_LLM_API_KEY : v; }
    catch (e) { return this.DEFAULT_LLM_API_KEY; }
  },
  llmTemperature() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_TEMPERATURE, true); return v === undefined ? this.DEFAULT_LLM_TEMPERATURE : v; }
    catch (e) { return this.DEFAULT_LLM_TEMPERATURE; }
  },
  llmMaxTokens() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_MAX_TOKENS, true); return v === undefined ? this.DEFAULT_LLM_MAX_TOKENS : v; }
    catch (e) { return this.DEFAULT_LLM_MAX_TOKENS; }
  },
  llmMaxContextChars() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_MAX_CONTEXT, true); return v === undefined ? this.DEFAULT_LLM_MAX_CONTEXT : v; }
    catch (e) { return this.DEFAULT_LLM_MAX_CONTEXT; }
  },
  llmTimeoutSeconds() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_TIMEOUT, true); return v === undefined ? this.DEFAULT_LLM_TIMEOUT : v; }
    catch (e) { return this.DEFAULT_LLM_TIMEOUT; }
  },
  llmConcurrency() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_CONCURRENCY, true); return v === undefined ? this.DEFAULT_LLM_CONCURRENCY : v; }
    catch (e) { return this.DEFAULT_LLM_CONCURRENCY; }
  },
  llmAutoRunPref() {
    try { let v = Zotero.Prefs.get(this.PREF_LLM_AUTORUN, true); return v === undefined ? this.DEFAULT_LLM_AUTORUN : !!v; }
    catch (e) { return this.DEFAULT_LLM_AUTORUN; }
  },
  llmConfigured() {
    return !!(this.llmBaseURL().trim() && this.llmModel().trim());
  },
  getLLMSettings() {
    return {
      baseURL: this.llmBaseURL(),
      model: this.llmModel(),
      apiKey: this.llmApiKey(),
      temperature: this.llmTemperature(),
      maxTokens: this.llmMaxTokens(),
      maxContextChars: this.llmMaxContextChars(),
      timeoutSeconds: this.llmTimeoutSeconds(),
      concurrency: this.llmConcurrency(),
      autoRun: this.llmAutoRunPref(),
    };
  },
  llmAutoRun() {
    let autoRun = this.llmAutoRunPref();
    if (autoRun && !this.llmConfigured()) {
      autoRun = false;
      try { Zotero.Prefs.set(this.PREF_LLM_AUTORUN, false, true); } catch (e) {}
    }
    return autoRun;
  },
  async testLLMConnection(settings) {
    let win = Zotero.getMainWindow();
    if (!win || !win.ZONCore) {
      return { ok: false, message: this.t("err.llmCoreMissing") };
    }
    let C = win.ZONCore;
    let s = C.sanitizeLLMSettings(settings || this.getLLMSettings());
    if (!C.isLLMConfigured(s)) {
      return { ok: false, message: this.t("err.llmNotConfigured") };
    }
    let url = C.buildChatCompletionsURL(s.baseURL);
    let headers = C.buildLLMHeaders(s);
    let payload = C.buildTestConnectionPayload(s);
    this.log("LLM test connection: " + JSON.stringify(C.sanitizeLogMetadata(s)));
    try {
      let resp = await Zotero.HTTP.request("POST", url, {
        headers: headers,
        body: JSON.stringify(payload),
        responseType: "text",
        timeout: s.timeoutSeconds * 1000,
      });
      let content = C.parseChatCompletionsResponse(resp.responseText);
      if (!content) {
        this.log("LLM test connection: empty response");
        return { ok: false, message: this.t("status.llmTestEmpty") };
      }
      this.log("LLM test connection: success");
      return { ok: true, message: this.t("status.llmTestOk") };
    } catch (e) {
      let status = (e && typeof e.status === "number") ? e.status : null;
      let errStr = status ? ("HTTP " + status) : C.sanitizeError(e);
      this.log("LLM test connection: failed" + (status ? (" (HTTP " + status + ")") : ""));
      return { ok: false, message: this.t("status.llmTestFail", { error: errStr }) };
    }
  },
  // Resolve the image-embed folder for THIS render: a template's own
  // `zon: attachments:` override wins; otherwise "" and the pure render layer
  // falls back to its built-in default. (The global preference was removed —
  // image embeds are vestigial text in a Zotero note anyway.)
  resolveAttachmentFolder(md, win) {
    try {
      let C = win && win.ZONCore;
      let perNote = C && C.getAttachmentFolder ? C.getAttachmentFolder(md || "") : null;
      if (perNote) return perNote.replace(/^\/+|\/+$/g, "");
    } catch (e) {}
    return "";
  },

  // ---------------------------------------------------------------- editor lib

  // Inject a bundle as a <script> into the main window; it runs in window scope
  // and defines window[globalName]. Resolves when loaded (or already present).
  injectScript(win, id, file, globalName) {
    return new Promise((resolve, reject) => {
      try {
        if (win[globalName]) { resolve(); return; }
        let doc = win.document;
        let existing = doc.getElementById(id);
        if (existing) { existing.addEventListener("load", () => resolve()); return; }
        let script = doc.createElementNS("http://www.w3.org/1999/xhtml", "script");
        script.id = id;
        script.setAttribute("type", "text/javascript");
        script.setAttribute("src", this.rootURI + "content/" + file);
        script.addEventListener("load", () => { this.log(id + " loaded"); resolve(); });
        script.addEventListener("error", (e) => reject(new Error("script error: " + e)));
        doc.documentElement.appendChild(script);
      } catch (e) { reject(e); }
    });
  },

  injectCore(win) { return this.injectScript(win, "zon-core-lib", "core.bundle.js", "ZONCore"); },


  // ---------------------------------------------------------------- section

  registerSection() {
    if (!Zotero.ItemPaneManager || !Zotero.ItemPaneManager.registerSection) {
      this.log("ItemPaneManager.registerSection unavailable"); return;
    }
    try { Zotero.ItemPaneManager.unregisterSection("zotero-obsidian-notes-section"); } catch (e) {}
    let self = this;
    this._registeredPaneID = Zotero.ItemPaneManager.registerSection({
      paneID: "zotero-obsidian-notes-section",
      pluginID: this.pluginID,
      header: { l10nID: "zon-header", icon: this.icon },
      sidenav: { l10nID: "zon-sidenav", icon: this.icon },
      onRender: function (props) { self.paintSection(props); },
      onAsyncRender: function (props) { self.paintSection(props); },
      onItemChange: function (props) {
        try { props.setEnabled(!!props.item && props.item.isRegularItem()); } catch (e) {}
      },
    });
  },

  // Obsidian-crystal icon for the section header + right-hand sidenav column.
  // A packaged SVG (context-fill) renders/threads the theme colour more reliably
  // than a data: URI did.
  get icon() {
    return (this.rootURI || "") + "content/icon.svg";
  },

  // Find the LIVE <collapsible-section> element(s) for our pane. The `props.body`
  // the hook hands us is frequently DETACHED (isConnected=false) — painting into
  // it is invisible, and `body.closest("collapsible-section")` then finds nothing.
  // Zotero renders our section as a <collapsible-section data-pane="…notes-section">
  // whose visible body is a slot for its light-DOM children, so we scan every main
  // window (light DOM + shadow roots) for the CONNECTED section and slot our wrap
  // into it. (data-pane may hold the raw or pluginID-namespaced id → match by suffix.)
  connectedSections() {
    let out = [];
    let scan = function (root) {
      if (!root || !root.querySelectorAll) return;
      let secs;
      try { secs = root.querySelectorAll("collapsible-section"); } catch (e) { return; }
      for (let cs of secs) {
        let pane = cs.dataset ? cs.dataset.pane : (cs.getAttribute && cs.getAttribute("data-pane"));
        if (pane && /zotero-obsidian-notes-section$/.test(pane) && cs.isConnected) out.push(cs);
      }
      try { for (let el of root.querySelectorAll("*")) if (el.shadowRoot) scan(el.shadowRoot); } catch (e) {}
    };
    try { for (let win of Zotero.getMainWindows()) if (win && win.document) scan(win.document); } catch (e) {}
    return out;
  },

  // Is this section actually inside the window viewport? Zotero keeps a copy of
  // our section in EVERY open tab's item pane AND in the reader context panes —
  // and those off-screen / collapsed copies still report client rects, so
  // getClientRects().length can't tell them apart. A bounding rect that intersects
  // the viewport can: the off-screen context-pane copies sit at x >= innerWidth and
  // the collapsed ones have zero width. This is how we identify the one pane the
  // user is actually looking at (= the one Zotero just rendered into).
  inViewport(cs, win) {
    try {
      let r = cs.getBoundingClientRect();
      return r.width > 1 && r.height > 1
        && r.left < win.innerWidth && r.right > 0
        && r.top < win.innerHeight && r.bottom > 0;
    } catch (e) { return false; }
  },

  // Is Zotero in dark mode? The editor's iframe is a separate document that does
  // not inherit Zotero's theme, so we detect it and pass it to the editor. We
  // read the resolved background colour of our host (which uses Zotero's
  // --material-background var) and check its luminance; fall back to the OS
  // colour-scheme media query if the host bg is transparent/unavailable.
  isDarkTheme(win, host) {
    try {
      let bg = host ? win.getComputedStyle(host).backgroundColor : "";
      let m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        let p = m[1].split(",").map(function (s) { return parseFloat(s); });
        let a = p.length > 3 ? p[3] : 1;
        if (a > 0.1) {
          let lum = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
          return lum < 0.5;
        }
      }
    } catch (e) {}
    try { return !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) {}
    return false;
  },

  // Find the section that belongs to the ACTIVE tab's pane. There's one copy of
  // our section per open tab (the library item pane + every reader tab's context
  // pane), and viewport geometry can't tell them apart — a background tab's pane
  // keeps non-zero, on-screen-looking geometry. But the active tab is identifiable
  // from the section's ancestor id: the library pane lives under #zotero-item-pane
  // / #zotero-item-details, and a reader tab's context pane under
  // #tab-<tabID>-context. Zotero_Tabs tells us which tab is selected.
  activeTabSection(sections, win) {
    let tabs = win && win.Zotero_Tabs;
    if (!tabs) return null;
    let selType = tabs.selectedType;            // "library" | "reader"
    let selID = tabs.selectedID;                // already "tab-XXXX" for a reader tab
    // The reader context pane's ancestor id is "<selID>-context" (selID already
    // carries the "tab-" prefix — don't add another).
    let wantCtx = selID ? (selID + "-context") : null;
    for (let cs of sections) {
      let n = cs;
      for (let i = 0; i < 14 && n; i++) {
        let id = n.id || "";
        if (selType === "library") {
          if (id === "zotero-item-pane" || id === "zotero-item-details") return cs;
        } else if (wantCtx && id === wantCtx) {
          return cs;
        }
        let p = n.parentNode;
        if (p && p.nodeType === 11) p = p.host; // cross shadow boundary
        n = p;
      }
    }
    return null;
  },

  // Paint into the pane of the ACTIVE tab — the library item pane, or the current
  // reader tab's context pane (the user takes notes while reading a PDF, so this
  // MUST work in reader tabs). We anchor our content wrap to the stable, connected
  // <collapsible-section> for that pane — NOT props.body, which in reader panes is
  // connected only momentarily before Zotero swaps it out — so the editor + cursor
  // survive the pane's churn. Each pane keeps its own editor (iframes isolate the
  // DOM selection, so multiple editors across tabs don't interfere).
  paintSection(props) {
    if (!props || !props.item) return;
    let item = props.item;
    let itemID = item.id;
    let self = this;
    this._lastPaintItemID = itemID;
    let attempt = 0;
    let go = function () {
      if (self._lastPaintItemID !== itemID) return; // user moved to another item while retrying
      let sections = self.connectedSections();
      // Zotero does NOT build its native styled .head for `custom` plugin
      // sections — it just dumps the `label` attribute as a BARE, unstyled text
      // node directly inside the <collapsible-section> (verified: no .head element,
      // childNodes === [TEXT:"Obsidian Notes", div.zon-content]). So we render our
      // OWN header (icon + muted-bold title + chevron, matching Tags/Related)
      // inside .zon-content, and suppress Zotero's dump two ways: (a) keep the
      // label EMPTY so there's nothing to render, and (b) strip any stray
      // non-whitespace text node on every paint (idempotent). (bug 5)
      for (let cs of sections) {
        try { if (cs.getAttribute("label")) cs.setAttribute("label", ""); } catch (e) {}
        try { for (let n of [...cs.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.remove(); } catch (e) {}
      }
      let win = (sections[0] && sections[0].ownerDocument.defaultView) || Zotero.getMainWindows()[0];
      // Prefer the active tab's section; fall back to the viewport-visible one,
      // then (after waiting for layout) the first connected.
      let target = self.activeTabSection(sections, win);
      if (!target && win) {
        let visible = sections.filter(function (cs) { return self.inViewport(cs, win); });
        if (visible.length) {
          target = visible.reduce(function (a, b) {
            return b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a;
          });
        } else if (attempt >= 40 && sections.length) {
          target = sections[0];
        }
      }
      if (target) {
        let doc = target.ownerDocument;
        let wrap = target.querySelector(":scope > .zon-content");
        if (!wrap) {
          wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          wrap.className = "zon-content";
          wrap.style.cssText = "box-sizing:border-box;overflow:hidden;";
          target.appendChild(wrap); // slotted into the collapsible body
        }
        self.renderInto(wrap, item).catch((e) => self.log("render failed: " + e));
        return;
      }
      // The live pane may attach / lay out a little after the hook fires — keep trying.
      if (attempt < 40) {
        attempt++;
        let w = (props.body && props.body.ownerDocument && props.body.ownerDocument.defaultView)
          || win || Zotero.getMainWindows()[0];
        if (w && w.setTimeout) w.setTimeout(go, 150);
      }
    };
    go();
  },

  // ---------------------------------------------------------------- rendering

  // The item pane is the Composer (ADR-0002): a template picker, a live rendered
  // preview of the Summary Note the selected template would produce for this item,
  // and a Generate button that creates it via the #25 pipeline. The old file-backed
  // CodeMirror editor is gone from the pane (the editor survives only in the
  // Template Builder). Preview refreshes on item change and template change,
  // debounced, and NEVER executes {% llm %} blocks (they render as inert
  // placeholders — see src/compose-preview.js). No disk writes happen here.
  async renderInto(wrap, item) {
    let win = wrap.ownerDocument.defaultView;
    let rec = wrap._zon;
    if (!rec) {
      rec = this.buildComposerUI(wrap, win);
      wrap._zon = rec;
      // The picker is built synchronously from the templates known so far; custom
      // folder templates + ZONCore's built-ins may still be loading, so repopulate
      // once they're ready.
      this.populateComposerTemplates(rec).catch((e) => this.log("composer templates failed: " + e));
    }
    rec.item = item;
    this.schedulePreview(rec);
    // Note awareness + Stale Indicator (#28): refresh on every item selection
    // change. Purely reads existing notes/annotations — never writes.
    this.refreshNoteAwareness(rec).catch((e) => this.log("note awareness refresh failed: " + e));
  },

  // Build the Composer pane: styled header, a template picker + Generate + Builder
  // toolbar, a status line, and a scrollable preview area. Returns the `rec` the
  // preview/generate paths operate on.
  buildComposerUI(wrap, win) {
    let doc = wrap.document || win.document;
    let h = (tag, cls) => {
      let el = win.document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (cls) el.className = cls;
      return el;
    };
    wrap.textContent = "";
    this.injectToolbarCSS(win);
    this.injectComposerCSS(win);

    // Our own styled section header (Zotero doesn't give `custom` plugin sections
    // the native icon+title head — see paintSection). Click, Enter or Space
    // collapses/expands; exposed to AT as a button with aria-expanded (kept in
    // sync across every open pane by applyCollapsedAll).
    let header = h("div", "zon-header-bar");
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    let headerIcon = h("img", "zon-header-icon"); headerIcon.src = this.icon;
    headerIcon.setAttribute("alt", ""); // decorative — the title text carries the name
    let headerTitle = h("span", "zon-header-title"); headerTitle.textContent = this.t("composer.title");
    let chevron = h("span", "zon-header-chevron"); chevron.textContent = "⌄";
    chevron.setAttribute("aria-hidden", "true");
    header.append(headerIcon, headerTitle, chevron);
    let toggleCollapsed = () => {
      let collapsed = !wrap.classList.contains("zon-collapsed");
      try { Zotero.Prefs.set(this.PREF_COLLAPSED, collapsed, true); } catch (e) {}
      this.applyCollapsedAll(collapsed);
    };
    header.addEventListener("click", toggleCollapsed);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        toggleCollapsed();
      }
    });

    let toolbar = h("div", "zon-toolbar");

    // Template picker — every template (folder files + built-in formats), default
    // note scaffold first. Changing it re-renders the preview.
    let templateSel = h("select"); templateSel.title = this.t("tip.composerTemplate");
    this.orderedTemplateNames(win).forEach((f) => { let o = h("option"); o.value = f; o.textContent = f; templateSel.appendChild(o); });

    // Run-LLM (ADR-0001): resolves every {% llm %} block once so Generate can run.
    // Hidden until the current render is known to contain blocks (see refreshPreview).
    let runLLMBtn = h("button");
    runLLMBtn.textContent = this.t("btn.runLLM");
    runLLMBtn.title = this.t("tip.composerRunLLM");
    runLLMBtn.style.display = "none";

    let generateBtn = h("button", "zon-primary");
    generateBtn.textContent = this.t("btn.generate");
    generateBtn.title = this.t("tip.generate");

    let builderBtn = h("button");
    builderBtn.textContent = this.t("btn.builder");
    builderBtn.title = this.t("tip.builder");

    let status = h("span", "zon-status");

    let row1 = h("div", "zon-row"); row1.append(templateSel, runLLMBtn, generateBtn, builderBtn);
    // A visible error box for LLM run failures (context assembly, HTTP, etc.) —
    // ADR-0001 fail-loud: never console-only. Hidden until there's something to show.
    let llmError = h("div", "zon-llm-error"); llmError.style.display = "none";
    toolbar.append(row1, status, llmError);

    // Note awareness (#28): existing Summary Notes for this item (recognised
    // ONLY by the Marker Tag — see existingSummaryNotes) plus the read-only
    // Stale Indicator badge. Strictly display-only: nothing here ever writes.
    let notesSection = h("div", "zon-notes-section");
    let staleBadge = h("span", "zon-stale-badge");
    let notesList = h("ul", "zon-notes-list");
    notesSection.append(staleBadge, notesList);

    // Rendered preview of the future Summary Note (marker-free HTML, LLM blocks as
    // placeholders). Scrolls internally so a long note doesn't push the pane.
    let preview = h("div", "zon-preview");

    wrap.append(header, toolbar, notesSection, preview);
    if (this.sectionCollapsed()) wrap.classList.add("zon-collapsed");
    header.setAttribute("aria-expanded", String(!this.sectionCollapsed()));

    let rec = {
      wrap, host: preview, toolbar, templateSel, runLLMBtn, generateBtn, builderBtn,
      statusEl: status, llmError, notesListEl: notesList, staleBadgeEl: staleBadge,
      item: null, previewTimer: null, previewSeq: 0,
      // Compose gating: the current (item+template) render's md and gate state.
      composeMd: "", composeState: null, llmRunning: false,
    };

    templateSel.addEventListener("change", () => this.schedulePreview(rec, { immediate: true }));
    // Fail-loud (ADR-0001): an unexpected exception escaping composerRunLLM must
    // reach the visible error box, never the console alone.
    runLLMBtn.addEventListener("click", () => this.composerRunLLM(rec).catch((e) => {
      this.log("composer run LLM failed: " + e);
      try {
        this.setLLMError(rec, this.t("err.llmRunUnexpected", { error: (e && e.message) ? e.message : String(e) }));
        this.setStatus(rec, "");
      } catch (e2) {}
    }));
    generateBtn.addEventListener("click", () => this.composerGenerate(rec).catch((e) => this.log("composer generate failed: " + e)));
    builderBtn.addEventListener("click", () => { try { this.openTemplateBuilder(win, rec); } catch (e) { this.log("openTemplateBuilder failed: " + e); } });

    return rec;
  },

  // Composer-specific styling (preview typography + the inert LLM placeholder).
  // Kept separate from injectToolbarCSS so the two concerns stay legible.
  injectComposerCSS(win) {
    try {
      let doc = win.document;
      if (doc.getElementById("zon-composer-css")) return;
      let style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "zon-composer-css";
      style.textContent =
        // Note awareness + Stale Indicator (#28) — read-only. The badge exists
        // ONLY in the "stale" state ("fresh" shows nothing; "no-note" is covered
        // by the list's placeholder row instead).
        ".zon-notes-section{margin:0 3px 6px;}"
        + ".zon-stale-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 7px;"
        + "border-radius:10px;margin:0 0 4px;"
        + "background:rgba(224,124,26,.15);color:var(--accent-orange,#b5560a);}"
        + ".zon-stale-badge:empty{display:none;}"
        + ".zon-notes-list{list-style:none;margin:0;padding:0;}"
        + ".zon-notes-list:empty{display:none;}"
        + ".zon-notes-item{font-size:12px;padding:2px 4px;border-radius:4px;cursor:pointer;"
        + "color:var(--fill-secondary,#555);}"
        + ".zon-notes-item:hover,.zon-notes-item:focus{background:var(--fill-quinary,rgba(0,0,0,.06));"
        + "color:var(--fill-primary,#1a1a1a);outline:none;}"
        // Empty-state placeholder row — deliberately non-interactive: default
        // cursor, no hover affordance, never focusable, no click handler.
        + ".zon-notes-placeholder{font-size:12px;padding:2px 4px;cursor:default;"
        + "font-style:italic;color:var(--fill-secondary,#888);}"
        + ".zon-preview{max-height:60vh;overflow:auto;padding:10px 12px;margin:2px 3px 6px;"
        + "border:1px solid var(--fill-quinary,#ddd);border-radius:5px;"
        + "background:var(--material-background,#fff);color:var(--fill-primary,#1a1a1a);"
        + "font-size:13px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;}"
        + ".zon-preview > :first-child{margin-top:0;}"
        + ".zon-preview > :last-child{margin-bottom:0;}"
        + ".zon-preview h1,.zon-preview h2,.zon-preview h3,.zon-preview h4{margin:.8em 0 .35em;line-height:1.25;}"
        + ".zon-preview h1{font-size:1.4em;} .zon-preview h2{font-size:1.22em;} .zon-preview h3{font-size:1.08em;}"
        + ".zon-preview p,.zon-preview ul,.zon-preview ol,.zon-preview blockquote,.zon-preview table{margin:.45em 0;}"
        + ".zon-preview ul,.zon-preview ol{padding-left:1.4em;}"
        + ".zon-preview blockquote{border-left:3px solid var(--fill-quarternary,rgba(0,0,0,.18));"
        + "margin-left:0;padding:.1em .9em;color:var(--fill-secondary,#555);}"
        + ".zon-preview code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;"
        + "background:var(--fill-quinary,rgba(0,0,0,.06));padding:.05em .3em;border-radius:3px;}"
        + ".zon-preview pre{overflow:auto;} .zon-preview pre code{background:none;padding:0;}"
        + ".zon-preview img{max-width:100%;height:auto;}"
        + ".zon-preview table{border-collapse:collapse;} .zon-preview th,.zon-preview td{border:1px solid var(--fill-quinary,rgba(0,0,0,.18));padding:3px 7px;}"
        + ".zon-preview a{color:var(--color-accent,#3367d6);}"
        // Empty / error / loading states.
        + ".zon-preview-empty,.zon-preview-error{color:var(--fill-secondary,#888);font-style:italic;}"
        + ".zon-preview-error{color:var(--accent-red,#c0392b);font-style:normal;white-space:pre-wrap;}"
        // Visible LLM-run error box (ADR-0001 fail-loud) — sits in the toolbar.
        + ".zon-llm-error{margin:4px 3px 2px;padding:7px 9px;border-radius:5px;white-space:pre-wrap;"
        + "font-size:12px;line-height:1.45;color:var(--accent-red,#c0392b);"
        + "border:1px solid var(--accent-red,#c0392b);background:rgba(192,57,43,.08);}"
        // Inert LLM placeholder — clearly not-yet-run, shows model + context + prompt.
        + ".zon-llm-placeholder{border:1px dashed var(--color-accent,#3367d6);border-radius:6px;"
        + "padding:8px 10px;margin:.6em 0;background:var(--fill-quinary,rgba(51,103,214,.06));}"
        + ".zon-llm-placeholder-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px;}"
        + ".zon-llm-placeholder-badge{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;"
        + "padding:1px 6px;border-radius:4px;background:var(--color-accent,#3367d6);color:#fff;}"
        + ".zon-llm-placeholder-meta{font-size:11px;color:var(--fill-secondary,#666);}"
        + ".zon-llm-placeholder-meta code{background:var(--fill-quinary,rgba(0,0,0,.06));padding:.03em .3em;border-radius:3px;}"
        + ".zon-llm-placeholder-note{font-size:11px;font-style:italic;color:var(--fill-secondary,#888);margin-bottom:5px;}"
        + ".zon-llm-placeholder-prompt{margin:0;white-space:pre-wrap;font-size:12px;"
        + "font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--fill-primary,#333);"
        + "background:var(--material-background,#fff);border-radius:4px;padding:6px 8px;overflow:auto;}";
      (doc.head || doc.documentElement).appendChild(style);
    } catch (e) {}
  },

  // (Re)fill the Composer picker from the unified template list once loadTemplates
  // + ZONCore are ready. Default note scaffold first; preserves any selection.
  async populateComposerTemplates(rec) {
    let sel = rec.templateSel;
    if (!sel) return;
    let win = rec.wrap.ownerDocument.defaultView;
    if (!this._templates) { try { await this.loadTemplates(); } catch (e) {} }
    if (!win.ZONCore) { try { await this.injectCore(win); } catch (e) {} }
    let names = this.orderedTemplateNames(win);
    let prev = sel.value;
    let doc = sel.ownerDocument;
    sel.textContent = "";
    for (let n of names) {
      let o = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    }
    sel.value = (prev && names.includes(prev)) ? prev : names[0];
    this.schedulePreview(rec, { immediate: true });
  },

  // Debounced preview refresh. Item switches and template changes both funnel here;
  // `opts.immediate` shortens the debounce for a deliberate template pick.
  schedulePreview(rec, opts = {}) {
    let win = rec.wrap.ownerDocument.defaultView;
    if (rec.previewTimer) { try { win.clearTimeout(rec.previewTimer); } catch (e) {} rec.previewTimer = null; }
    let delay = opts.immediate ? 30 : 180;
    try {
      rec.previewTimer = win.setTimeout(() => {
        rec.previewTimer = null;
        this.refreshPreview(rec).catch((e) => this.log("preview refresh failed: " + e));
      }, delay);
    } catch (e) {
      this.refreshPreview(rec).catch((e2) => this.log("preview refresh failed: " + e2));
    }
  },

  // Compute + display the preview HTML for the current item/template. Guards
  // against stale results (a later item/template change wins). Never writes disk,
  // never calls an LLM. Also (re)builds the compose gate state so Run-LLM /
  // Generate reflect the current render, preserving any resolved LLM output across
  // a same-compose re-render (reconcileComposeState).
  async refreshPreview(rec) {
    let win = rec.wrap.ownerDocument.defaultView;
    let item = rec.item;
    let seq = ++rec.previewSeq;
    let host = rec.host;
    if (!item) {
      host.textContent = "";
      rec.composeMd = ""; rec.composeState = null;
      this.clearLLMError(rec);
      this.updateComposerButtons(rec);
      this.setStatus(rec, "");
      return;
    }
    if (!win.ZONCore) { try { await this.injectCore(win); } catch (e) {} }
    if (!this._templates) { try { await this.loadTemplates(); } catch (e) {} }
    let name = (rec.templateSel && rec.templateSel.value) || this.defaultNoteTemplate();
    this.setStatus(rec, this.t("composer.rendering"));

    // Render the raw Summary-Note markdown (still carries frontmatter, %% zon %%
    // markers and unresolved {% llm %} blocks). This is the SAME text Generate
    // uses; the gate + preview strip/resolve from here.
    let rawMd = null, err = null;
    try {
      rawMd = await this.renderTemplateAsNote(win, item, name, { preview: true });
    } catch (e) {
      err = (e && e.message) ? e.message : String(e);
    }
    // A newer refresh (or item switch) started while we awaited → drop this one.
    if (seq !== rec.previewSeq || rec.item !== item) return;

    if (err != null) {
      // A render failure means we have no trustworthy md — drop the gate state so
      // Generate can't fire against stale text.
      rec.composeMd = ""; rec.composeState = null;
      this.clearLLMError(rec);
      this.updateComposerButtons(rec);
      host.textContent = "";
      let d = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      d.className = "zon-preview-error";
      d.textContent = this.t("composer.previewFailed", { error: err });
      host.appendChild(d);
      this.setStatus(rec, "");
      return;
    }

    // (Re)build the gate state. reconcile carries resolved LLM output forward when
    // the compose (item + template + blocks) is unchanged; a switch of item or
    // template (key change) invalidates the resolution cache.
    let C = win.ZONCore;
    let state = null;
    try {
      state = C.reconcileComposeState(rec.composeState, rawMd, { itemKey: item.key, templateName: name });
    } catch (e) { this.log("reconcileComposeState failed: " + e); }
    rec.composeMd = rawMd;
    rec.composeState = state;
    // A fresh compose (key change) clears any stale Run-LLM error; a same-compose
    // re-render is harmless to clear (no error is set outside a failed run).
    this.clearLLMError(rec);
    this.updateComposerButtons(rec);

    let model = "";
    try { model = this.llmModel() || ""; } catch (e) {}
    let html = null;
    try {
      html = this.composePreviewHtmlFromState(win, rawMd, state, model, item.getField("title"));
    } catch (e) {
      err = (e && e.message) ? e.message : String(e);
    }

    if (err != null) {
      host.textContent = "";
      let d = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      d.className = "zon-preview-error";
      d.textContent = this.t("composer.previewFailed", { error: err });
      host.appendChild(d);
      this.setStatus(rec, "");
      return;
    }

    if (!html || !html.trim()) {
      host.textContent = "";
      let d = win.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      d.className = "zon-preview-empty";
      d.textContent = this.t("composer.previewEmpty");
      host.appendChild(d);
      this.setStatus(rec, "");
      return;
    }

    // Parse the preview HTML with DOMParser and import the nodes, rather than
    // assigning innerHTML (which the privileged chrome document restricts). The
    // markup is our own — mdToHtml output (html:false, a fixed safe tag set) plus
    // the fully-escaped LLM placeholder — so this only realises trusted content.
    try {
      let parser = new win.DOMParser();
      let pdoc = parser.parseFromString("<!DOCTYPE html><body>" + html + "</body>", "text/html");
      host.textContent = "";
      for (let node of Array.from(pdoc.body.childNodes)) {
        host.appendChild(win.document.importNode(node, true));
      }
    } catch (e) {
      host.textContent = "";
      this.log("preview render failed: " + e);
    }
    this.setStatus(rec, "");
  },

  // Turn the compose's raw md + gate state into preview HTML. When every {% llm %}
  // block has been resolved (Run-LLM ran), their static output is substituted in
  // place so the preview shows exactly what Generate will write; otherwise blocks
  // render as inert placeholders. NEVER executes a model call — the substitution
  // uses already-cached outputs only.
  composePreviewHtmlFromState(win, rawMd, state, model, itemTitle) {
    let C = win.ZONCore;
    let md = rawMd;
    if (state && C.composeHasLLMBlocks && C.composeHasLLMBlocks(state) && C.canGenerate(state)) {
      md = C.applyLLMOutputs(rawMd, state.blocks, C.orderedOutputs(state));
    }
    md = C.stripFrontmatter(md);
    md = C.stripMarkers(md);
    // Title is added strictly downstream of the gating fingerprint (which reads
    // rawMd), so it can never invalidate cached LLM resolutions — and Generate
    // applies the identical step, keeping preview == note.
    md = C.withSummaryTitle(md, itemTitle);
    return C.composePreviewHtml(md, { model });
  },

  // Show / hide the visible LLM-run error box (ADR-0001 fail-loud, never
  // console-only). An empty message hides it.
  setLLMError(rec, msg) {
    if (!rec || !rec.llmError) return;
    let text = String(msg == null ? "" : msg);
    rec.llmError.textContent = text;
    rec.llmError.style.display = text ? "" : "none";
  },
  clearLLMError(rec) { this.setLLMError(rec, ""); },

  // Reflect the current gate state on the toolbar: Run-LLM shows only when the
  // render contains {% llm %} blocks; Generate is disabled (with a visible reason)
  // while any block is unresolved.
  updateComposerButtons(rec) {
    try {
      let win = rec.wrap.ownerDocument.defaultView;
      let C = win && win.ZONCore;
      let state = rec.composeState;
      let hasBlocks = !!(C && C.composeHasLLMBlocks && state && C.composeHasLLMBlocks(state));
      if (rec.runLLMBtn) {
        rec.runLLMBtn.style.display = hasBlocks ? "" : "none";
        let configured = this.llmConfigured();
        rec.runLLMBtn.disabled = !configured || !!rec.llmRunning;
        rec.runLLMBtn.title = configured ? this.t("tip.composerRunLLM") : this.t("err.llmNotConfigured");
      }
      if (rec.generateBtn) {
        let can = rec.item && (!state || !(C && C.canGenerate) || C.canGenerate(state));
        rec.generateBtn.disabled = !can || !!rec.llmRunning;
        if (rec.item && !can && C && C.generateBlockedReason) {
          let reason = C.generateBlockedReason(state);
          rec.generateBtn.title = reason || this.t("tip.generate");
        } else {
          rec.generateBtn.title = this.t("tip.generate");
        }
      }
    } catch (e) { this.log("updateComposerButtons failed: " + e); }
  },

  // Run-LLM (Composer): resolve EVERY {% llm %} block in the current render exactly
  // once via the existing runner (BYOK config from prefs), caching the static
  // markdown into the gate state so the preview updates and Generate unlocks. This
  // is the only place the Composer performs a model call — never on preview,
  // template switch, or item switch. All-or-nothing: any failure aborts and is
  // surfaced in the visible error box.
  async composerRunLLM(rec) {
    let item = rec.item;
    if (!item || rec.llmRunning) return;
    rec.llmRunning = true;
    this.updateComposerButtons(rec);
    this.clearLLMError(rec);
    try {
      let win = rec.wrap.ownerDocument.defaultView;
      if (!win.ZONCore) await this.injectCore(win);
      let C = win.ZONCore;

      // Guard: runner + gating exports present (graceful if an old bundle is cached).
      if (!C.prepareLLMRun || !C.applyLLMOutputs || !C.resolveAll || !C.executeLLMBlocks) {
        this.setLLMError(rec, this.t("err.llmCoreMissing"));
        return;
      }
      // Guard: configured (base URL + model).
      let settings = C.sanitizeLLMSettings(this.getLLMSettings());
      if (!C.isLLMConfigured(settings)) {
        this.setLLMError(rec, this.t("err.llmNotConfigured"));
        return;
      }

      // Ensure we hold the current render's md + gate state.
      let name = (rec.templateSel && rec.templateSel.value) || this.defaultNoteTemplate();
      let md = rec.composeMd;
      if (!md) {
        md = await this.renderTemplateAsNote(win, item, name, { preview: true });
        rec.composeMd = md;
        rec.composeState = C.reconcileComposeState(rec.composeState, md, { itemKey: item.key, templateName: name });
      }
      let state = rec.composeState;
      if (!state || !C.composeHasLLMBlocks(state)) {
        this.setStatus(rec, this.t("status.llmRunNoBlocks"));
        return;
      }

      // Gather PDF annotations so context="annotations" blocks can resolve.
      let annotations = [];
      try { annotations = this.gatherAnnotations(item, win); }
      catch (e) { this.log("gatherAnnotations (composer llm) failed: " + e); }

      // Fetch full text only when a block asks for it (avoids needless I/O).
      // LOGGING CONTRACT: never pass fulltext.text to this.log()/Zotero.debug —
      // metadata (title, char count, missing reason) only.
      let needFulltext = false;
      try { needFulltext = state.blocks.some((b) => b.contexts && b.contexts.includes("fulltext")); }
      catch (e) {}
      let fulltext = null;
      if (needFulltext) {
        fulltext = await this.getPrimaryPDFFulltext(item, C);
        if (fulltext && fulltext.ok) {
          this.log("fulltext context: " + (fulltext.attachmentTitle || "(untitled)") + " (" + fulltext.text.length + " chars)");
        } else if (fulltext) {
          this.log("fulltext context missing: " + fulltext.reason);
        }
      }

      // Build item data with parity to renderDocument so prompts can use any field.
      let citekey = this.getCitekey(item);
      let bibliography = await this.getBibliography(item);
      let data = {};
      try { data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString(), annotations, fulltext }); }
      catch (e) { this.log("buildItemData (composer llm) failed: " + e); }

      // Plan + execute through the pure runner. Pre-flight (parse + validate +
      // resolve context + render prompts) happens before any HTTP and aborts
      // loudly; block requests then run through a bounded worker pool
      // (settings.concurrency), all-or-nothing.
      let fetchFn = async (url, headers, payload, timeoutSeconds) => {
        let resp = await Zotero.HTTP.request("POST", url, {
          headers, body: JSON.stringify(payload), responseType: "text",
          timeout: timeoutSeconds * 1000,
        });
        return resp.responseText;
      };
      let onProgress = (done, n) => this.setStatus(rec, this.t("status.llmRunning", { i: done, n }));
      let result = await C.executeLLMBlocks(md, data, settings, fetchFn, onProgress);

      if (!result.ok) {
        if (result.code === C.LLM_RUN_ERRORS.NO_BLOCKS) {
          this.setStatus(rec, this.t("status.llmRunNoBlocks"));
          return;
        }
        if (result.code === C.LLM_RUN_ERRORS.HTTP_FAILED) {
          let e = result.error;
          let status = (e && typeof e.status === "number") ? e.status : null;
          this.log("composer llm http failed (block " + (result.blockIndex + 1) + "/" + result.n + ")"
            + (status ? " (HTTP " + status + ")" : "") + ": "
            + (C.sanitizeError ? C.sanitizeError(e) : (e && e.message ? e.message : e)));
        } else if (result.code === C.LLM_RUN_ERRORS.EMPTY_RESPONSE) {
          this.log("composer llm empty response (block " + (result.blockIndex + 1) + "/" + result.n + ")");
        }
        let first = result.errors && result.errors[0];
        if (first && first.detail) this.log("composer llm pre-flight: " + first.detail);
        this.setLLMError(rec, this.t("err.llmRunFailed", { error: this.describeLLMFailure(result) }));
        this.setStatus(rec, "");
        return;
      }

      // Every block succeeded → cache the static markdown into the gate state.
      // Preview refresh then substitutes it in place and Generate unlocks.
      rec.composeState = C.resolveAll(state, result.outputs);
      this.clearLLMError(rec);
      await this.refreshPreview(rec);
      this.setStatus(rec, this.t("status.llmRunDone", { count: result.outputs.length }));
    } finally {
      rec.llmRunning = false;
      this.updateComposerButtons(rec);
    }
  },

  // Generate a Summary Note for the pane's item from the selected template — the
  // #25 pipeline, gated FIRST by ADR-0001 (#27): it REFUSES (loudly, naming the
  // offending blocks) while any {% llm %} block is unresolved, regardless of
  // existing notes, and feeds the resolved static markdown into the note when
  // Run-LLM has completed.
  // Create-once refinement (#28), applied AFTER the gate passes: when the item
  // already has one or more Summary Notes (recognised ONLY by the Marker Tag),
  // offer a choice via a single confirm dialog — OK overwrites the NEWEST
  // existing note (this dialog IS the required explicit confirmation),
  // Cancel/default creates an additional note. Both paths receive the SAME
  // resolved markdown, so neither can ever write a note with a placeholder hole.
  // No existing note -> straight create, unchanged #25 behaviour.
  async composerGenerate(rec) {
    let win = rec.wrap.ownerDocument.defaultView;
    let item = rec.item;
    if (!item) return;
    if (!win.ZONCore) { try { await this.injectCore(win); } catch (e) {} }
    let C = win.ZONCore;
    let name = (rec.templateSel && rec.templateSel.value) || this.defaultNoteTemplate();

    // Ensure we hold a gate state built from the actual render. If a transient
    // preview error left it null, rebuild here so the ADR-0001 gate can never be
    // bypassed by a missing state (which would otherwise let literal {% llm %}
    // blocks reach the note).
    let state = rec.composeState;
    if ((!state || !rec.composeMd) && C && C.reconcileComposeState) {
      try {
        let md = await this.renderTemplateAsNote(win, item, name, { preview: true });
        state = C.reconcileComposeState(rec.composeState, md, { itemKey: item.key, templateName: name });
        rec.composeMd = md;
        rec.composeState = state;
        this.updateComposerButtons(rec);
      } catch (e) {
        this.setStatus(rec, this.t("composer.generateFailed", { error: (e && e.message) ? e.message : String(e) }));
        this.log("composerGenerate render failed: " + e);
        return;
      }
    }

    // Fail-loud fallback (ADR-0001): if the gating machinery is unavailable — a
    // stale cached core bundle missing reconcileComposeState/canGenerate, or a
    // state that could not be built — we cannot VERIFY the template's {% llm %}
    // blocks, so only a template with ZERO blocks may generate. Detection uses
    // the pure llm-blocks predicate when present, else a conservative inline
    // regex (same pattern as src/llm-blocks.js hasLLMBlocks); a failed render
    // or a thrown check counts as "has blocks" — refuse rather than degrade.
    if (!state || !C || !C.canGenerate || !C.reconcileComposeState) {
      let mdToCheck = rec.composeMd;
      if (typeof mdToCheck !== "string" || !mdToCheck) {
        try {
          mdToCheck = await this.renderTemplateAsNote(win, item, name, { preview: true });
          rec.composeMd = mdToCheck;
        } catch (e) {
          this.setStatus(rec, this.t("composer.generateFailed", { error: (e && e.message) ? e.message : String(e) }));
          this.log("composerGenerate render failed: " + e);
          return;
        }
      }
      let hasBlocks = true; // conservative default: unverifiable ⇒ refuse
      try {
        hasBlocks = (C && C.hasLLMBlocks)
          ? !!C.hasLLMBlocks(mdToCheck)
          : /\{%\s*llm\b/.test(String(mdToCheck || ""));
      } catch (e) { this.log("LLM block check failed (treating as present): " + e); }
      if (hasBlocks) {
        let reason = this.t("err.generateGateUnavailable");
        this.setLLMError(rec, reason);
        this.setStatus(rec, "");
        this.updateComposerButtons(rec);
        throw new Error("composerGenerate refused: " + reason);
      }
    }

    // Hard gate: never produce a note with a hole. The button is disabled while
    // unresolved, but the programmatic path refuses loudly too.
    if (state && C && C.canGenerate && !C.canGenerate(state)) {
      let reason = (C.generateBlockedReason ? C.generateBlockedReason(state) : "") ||
        this.t("composer.generateBlocked");
      this.setLLMError(rec, this.t("err.generateBlocked", { reason }));
      this.setStatus(rec, "");
      this.updateComposerButtons(rec);
      throw new Error("composerGenerate refused: " + reason);
    }

    rec.generateBtn.disabled = true;
    this.setStatus(rec, this.t("composer.generating"));
    try {
      // Prefer the exact md the preview showed (with resolved LLM output baked in)
      // so the note equals the preview; fall back to a fresh render if no compose
      // md is held yet (e.g. Generate raced ahead of the first preview). BOTH the
      // create and the overwrite path below use this — a note can never receive
      // an unresolved {% llm %} placeholder.
      let opts = {};
      if (rec.composeMd) {
        let md = rec.composeMd;
        if (state && C.composeHasLLMBlocks && C.composeHasLLMBlocks(state) && C.canGenerate(state)) {
          md = C.applyLLMOutputs(rec.composeMd, state.blocks, C.orderedOutputs(state));
        }
        opts.md = md;
      }
      // #28 existing-note choice: create an additional note, or (explicitly
      // confirmed) overwrite the newest existing Summary Note.
      let existing = this.existingSummaryNotes(item);
      let overwriteTarget = null;
      if (existing.length) {
        let ok = false;
        try {
          ok = Services.prompt.confirm(win, this.t("menu.title"),
            this.t("composer.overwriteChoice", { count: existing.length }));
        } catch (e) {}
        if (ok) overwriteTarget = this.newestNote(existing);
      }
      if (overwriteTarget) {
        await this.overwriteSummaryNote(win, item, overwriteTarget, name, opts);
        this.setStatus(rec, this.t("composer.overwritten"));
      } else {
        await this.generateSummaryNote(win, item, name, opts);
        this.setStatus(rec, this.t("composer.generated"));
      }
    } catch (e) {
      this.setStatus(rec, this.t("composer.generateFailed", { error: (e && e.message) ? e.message : String(e) }));
      this.log("composerGenerate failed: " + e);
    } finally {
      this.updateComposerButtons(rec);
      // The note list / Stale Indicator may now be out of date either way
      // (a note was added, or the newest one was overwritten).
      this.refreshNoteAwareness(rec).catch((e) => this.log("note awareness refresh failed: " + e));
    }
  },


  // Inject the toolbar/banner stylesheet into the chrome window once. Colours use
  // Zotero's own CSS variables so the controls match the item pane and follow the
  // light/dark theme automatically; fallbacks keep it sane if a var is missing.
  injectToolbarCSS(win) {
    try {
      let doc = win.document;
      if (doc.getElementById("zon-toolbar-css")) return;
      let style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "zon-toolbar-css";
      style.textContent =
        // Section header — matches Zotero's native Tags/Related head (muted, bold,
        // 13px) with our crystal logo. context-fill so the SVG picks up the colour.
        // Header flush-left (no left padding) so the icon + title line up with the
        // native section heads (Tags/Related) above it.
        ".zon-header-bar{display:flex;align-items:center;gap:6px;padding:2px 0 6px 0;cursor:pointer;user-select:none;}"
        + ".zon-header-icon{width:16px;height:16px;opacity:.9;-moz-context-properties:fill,stroke;fill:currentColor;color:var(--fill-secondary,#6a6a6a);}"
        + ".zon-header-title{font-weight:600;font-size:13px;color:var(--fill-secondary,#6a6a6a);}"
        // Collapse chevron — sized + right-aligned to match the native section twisty
        // (a ~20px control at the right edge). Rotates to point right when collapsed.
        + ".zon-header-chevron{margin-left:auto;width:20px;text-align:center;font-size:16px;line-height:1;opacity:.7;color:var(--fill-secondary,#6a6a6a);transition:transform .12s ease;}"
        + ".zon-content.zon-collapsed > :not(.zon-header-bar){display:none;}"
        + ".zon-content.zon-collapsed .zon-header-chevron{transform:rotate(-90deg);}"
        + ".zon-content.zon-collapsed .zon-header-bar{padding-bottom:2px;}"
        + ".zon-toolbar{display:flex;flex-direction:column;gap:7px;padding:4px 3px 9px;}"
        + ".zon-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;}"
        // View toggles sit just above the editor; a hairline + a hair more space
        // separates these presentational switches from the action buttons above.
        + ".zon-row-view{margin-top:1px;padding-top:8px;border-top:1px solid var(--fill-quinary,rgba(0,0,0,.07));}"
        + ".zon-row-view label{color:var(--fill-secondary,#7a7a7a);}"
        + ".zon-toolbar button,.zon-toolbar select,.zon-banner button,.zon-banner select{"
        + "font:inherit;font-size:11px;line-height:1.45;padding:3px 9px;min-height:23px;"
        + "border:1px solid var(--fill-quinary,rgba(0,0,0,.16));border-radius:5px;"
        + "background:var(--material-button,var(--color-background,transparent));"
        + "color:var(--fill-primary,var(--color-text,#1a1a1a));cursor:pointer;"
        + "appearance:none;-moz-appearance:none;box-sizing:border-box;}"
        + ".zon-toolbar select,.zon-banner select{padding:3px 18px 3px 8px;cursor:default;"
        + "background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);"
        + "background-position:calc(100% - 11px) 9px,calc(100% - 7px) 9px;background-size:4px 4px,4px 4px;background-repeat:no-repeat;}"
        + ".zon-toolbar button:hover,.zon-banner button:hover{background:var(--fill-quinary,rgba(0,0,0,.08));}"
        + ".zon-toolbar button:active,.zon-banner button:active{background:var(--fill-quarternary,rgba(0,0,0,.14));}"
        + ".zon-toolbar .zon-primary,.zon-banner .zon-primary{border-color:transparent;font-weight:600;"
        + "background:var(--color-accent,#3367d6);color:#fff;}"
        + ".zon-toolbar .zon-primary:hover,.zon-banner .zon-primary:hover{background:var(--color-accent,#3367d6);filter:brightness(1.08);}"
        + ".zon-toolbar label{display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;"
        + "color:var(--fill-secondary,#6a6a6a);}"
        + ".zon-toolbar .zon-status{font-size:11px;min-height:13px;padding-left:2px;color:var(--fill-secondary,#888);}"
        // "⋯ More" popover (Migrate / Sync Metadata).
        + ".zon-more-wrap{position:relative;display:inline-flex;}"
        + ".zon-more-menu{position:absolute;top:100%;left:0;margin-top:3px;z-index:10;display:flex;flex-direction:column;gap:3px;padding:4px;min-width:140px;"
        + "background:var(--material-background,#fff);border:1px solid var(--fill-quinary,rgba(0,0,0,.18));border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);}"
        + ".zon-more-menu button{width:100%;text-align:left;}"
        + ".zon-banner{padding:14px 4px;font-size:13px;color:var(--fill-secondary,#6a6a6a);}"
        + ".zon-banner-text{margin-bottom:6px;line-height:1.45;}"
        + ".zon-banner button,.zon-banner select{font-size:12px;padding:4px 11px;min-height:26px;}";
      (doc.head || doc.documentElement).appendChild(style);
    } catch (e) {}
  },
  async safeWrite(path, text) {
    // Unique temp path per write: a fixed `<note>.zon.tmp` was shared by every
    // writer, so two concurrent writes could corrupt each other's temp file.
    this._wseq = (this._wseq || 0) + 1;
    await IOUtils.writeUTF8(path, text, { tmpPath: path + "." + this._wseq + ".zon.tmp" });
  },
  setStatus(rec, text) { try { rec.statusEl.textContent = text; } catch (e) {} },


  // ---------------------------------------------------------------- create note

  // Resolve the citekey used for the filename (@<citekey>.md). Prefers Better
  // BibTeX, then a "Citation Key:" line in Extra, then firstAuthor+year.
  getCitekey(item, allowFallback = true) {
    try {
      let bbt = Zotero.BetterBibTeX;
      if (bbt && bbt.KeyManager && bbt.KeyManager.get) {
        let k = bbt.KeyManager.get(item.id);
        let ck = k && (k.citationKey || k.citekey);
        if (ck) return ck;
      }
    } catch (e) {}
    try {
      let m = (item.getField("extra") || "").match(/^\s*Citation Key\s*:\s*(\S+)/im);
      if (m) return m[1];
    } catch (e) {}
    if (!allowFallback) return null;
    try {
      let cs = item.getCreators ? item.getCreators() : [];
      let surname = (cs[0] && (cs[0].lastName || cs[0].name)) || "ref";
      let year = ((item.getField("date") || "").match(/\d{4}/) || [""])[0];
      return (surname + year).replace(/[^A-Za-z0-9]/g, "") || ("ref" + item.id);
    } catch (e) { return "ref" + item.id; }
  },

  // The item's Zotero "Related" items, each with its Better BibTeX citekey, for
  // template use (`{% for r in relations | selectattr("citekey") %}[[{{r.citekey}}]]`).
  // `item.relatedItems` is an array of item KEYS in the same library; resolve each
  // and read its citekey. Sync (getCitekey is sync). Returns [{citekey,title,key}].
  relationsFor(item) {
    try {
      let keys = (item && item.relatedItems) || [];
      let out = [];
      for (let key of keys) {
        let rel = Zotero.Items.getByLibraryAndKey(item.libraryID, key);
        if (!rel) continue;
        out.push({ citekey: this.getCitekey(rel), title: rel.getField("title") || "", key: rel.key });
      }
      return out;
    } catch (e) { this.log("relationsFor failed: " + e); return []; }
  },

  // Render a DOCUMENT template (whole-note) for this item: fill the item-level
  // Nunjucks vars, then fill any `%% zon %%` annotation blocks with the item's
  // highlights. Returns the finished markdown.
  // A formatted reference for the note's {{bibliography}}. Uses the user's
  // QuickCopy citation style if it's set to a bibliography; otherwise falls back
  // to APA. Returns "" (not an error) if Zotero can't produce one.
  async getBibliography(item) {
    try {
      let setting = Zotero.Prefs.get("export.quickCopy.setting");
      let format = setting ? Zotero.QuickCopy.unserializeSetting(setting) : null;
      if (!format || format.mode !== "bibliography") {
        format = { mode: "bibliography", contentType: "text", id: "http://www.zotero.org/styles/apa" };
      }
      let res = await Zotero.QuickCopy.getContentFromItems([item], format);
      return ((res && res.text) || "").trim();
    } catch (e) { this.log("bibliography failed: " + e); return ""; }
  },

  // The opts every syncBlocks / makeBlock call needs: the citekey, the format map,
  // AND the item's data context — so kind=field/section/custom blocks render and
  // refresh from Zotero just like annotation blocks do. `bibliography` is optional:
  // pass it where it has already been computed; the realtime auto-sync path omits
  // it (QuickCopy is comparatively costly and field elements rarely use it).
  syncOpts(win, item, extra = {}) {
    let citekey = item ? this.getCitekey(item) : "";
    let itemData = {};
    if (item && win.ZONCore) {
      try {
        itemData = win.ZONCore.buildItemData(item, {
          citekey,
          bibliography: extra.bibliography || "",
          importDate: new Date().toISOString(),
          pdfAttachmentKey: this.primaryPdfKey(item),
          relations: this.relationsFor(item),
        });
      } catch (e) { this.log("buildItemData failed: " + e); }
    }
    return {
      citekey,
      formats: this.formatMap(win),
      itemData,
      attachmentFolder: extra.attachmentFolder || "",
    };
  },

  // Render a whole-note template for `item`: fill the item-level Nunjucks vars,
  // then fill any `%% zon %%` annotation blocks from the item's annotations. Pure
  // string production — no disk side effects. Returns the finished markdown.
  async renderDocument(win, item, templateText, opts = {}) {
    let citekey = this.getCitekey(item);
    let bibliography = await this.getBibliography(item);
    let data = win.ZONCore.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString(), pdfAttachmentKey: this.primaryPdfKey(item), relations: this.relationsFor(item), isFirstImport: true });
    let md = win.ZONCore.render(templateText, data);
    let anns = this.gatherAnnotations(item, win);
    let attachmentFolder = this.resolveAttachmentFolder(md, win);
    try { md = win.ZONCore.syncBlocks(md, anns, { citekey, formats: this.formatMap(win), itemData: data, attachmentFolder }); } catch (e) {}
    return md;
  },

  // Render template `name` as a whole note. A document template is rendered in
  // full; a per-annotation format becomes a note that's just a filled annotations
  // block (so you really can "start a note that's just a list of annotations").
  async renderTemplateAsNote(win, item, name, opts = {}) {
    let t = this.allTemplates(win)[name];
    if (!t) {
      let text = await this.resolveNoteScaffoldText(name);
      if (text) {
        let v = this.validateLLMTemplate(win, text);
        if (!v.valid) {
          throw new Error(this.t("err.llmBlocksInvalid", { count: v.errors.length })
            + " " + v.errors.map(e => "line " + (e.line != null ? e.line : "?") + ": " + e.message).join("; "));
        }
      }
      return this.renderDocument(win, item, text, opts);
    }
    if (t.kind === "document") {
      if (t.text) {
        let v = this.validateLLMTemplate(win, t.text);
        if (!v.valid) {
          throw new Error(this.t("err.llmBlocksInvalid", { count: v.errors.length })
            + " " + v.errors.map(e => "line " + (e.line != null ? e.line : "?") + ": " + e.message).join("; "));
        }
      }
      return this.renderDocument(win, item, t.text, opts);
    }
    let anns = this.gatherAnnotations(item, win);
    let bibliography = await this.getBibliography(item);
    let blockOpts = this.syncOpts(win, item, { bibliography });
    let cfg = this.blockConfigFor(t, name, {});
    return win.ZONCore.makeBlock(cfg, anns, blockOpts) + "\n";
  },

  // Build a `%% zon %%` block config for inserting/creating from template `t`
  // (named `name`). A template declares its element kind via its `%%! kind=… %%`
  // directive (defaults.kind): "field"/"section"/"custom" render the named body
  // once over the item's data; anything else (incl. the default) is an annotations
  // block filtered by colour. `over` may override colour/sync at insert time.
  blockConfigFor(t, name, over = {}) {
    let d = (t && t.defaults) || {};
    let kind = d.kind && d.kind !== "annotations" ? d.kind : "annotations";
    let sync = over.sync != null
      ? (over.sync === "off" ? "off" : "on")
      : (d.sync === "off" ? "off" : "on");
    if (kind !== "annotations") return { kind, sync, format: name };
    let colour = over.colour || d.colour || "all";
    return { kind: "annotations", colour, sync, format: name };
  },

  // Validate LLM block syntax/placement in a template. Returns { valid, errors }
  // with a safe fallback — a validator crash won't block the user.
  validateLLMTemplate(win, text) {
    try {
      if (!win.ZONCore || !win.ZONCore.validateLLMBlocks) return { valid: true, errors: [] };
      const r = win.ZONCore.validateLLMBlocks(text);
      return { valid: r.valid, errors: r.errors };
    } catch (e) {
      this.log("validateLLMTemplate failed: " + e);
      return { valid: true, errors: [] };
    }
  },


  // ---------------------------------------------------------- item context menu

  // Zotero's center-pane item-list context menu. The id has shifted across
  // versions, so try the known ones and use whichever the window actually has.
  ITEM_MENU_IDS: ["zotero-itemmenu", "zotero-items-tree-context-menu"],

  itemMenuPopup(win) {
    for (let id of this.ITEM_MENU_IDS) {
      let el = win.document.getElementById(id);
      if (el) return el;
    }
    return null;
  },

  // The regular (non-attachment, non-note) items currently selected in the list.
  selectedRegularItems(win) {
    try {
      let zp = win.ZoteroPane;
      let items = (zp && zp.getSelectedItems && zp.getSelectedItems()) || [];
      return items.filter((it) => it && it.isRegularItem && it.isRegularItem());
    } catch (e) { return []; }
  },

  // "has" = already carries a DOI (field or an Extra "DOI:" line); "unsupported" =
  // the item type has no DOI field; otherwise "missing" (a candidate for lookup).
  itemDoiState(item) {
    try {
      if ((item.getField("DOI") || "").trim()) return "has";
      if (/^\s*DOI\s*:/im.test(item.getField("extra") || "")) return "has";
      let ok = false;
      try { ok = Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID("DOI"), item.itemTypeID); } catch (e) {}
      return ok ? "missing" : "unsupported";
    } catch (e) { return "unsupported"; }
  },

  // Add our two actions to the item-list context menu (idempotent per window).
  addItemMenu(win) {
    try {
      let popup = this.itemMenuPopup(win);
      if (!popup || win._zonItemMenu) return;
      let doc = win.document;
      let mk = (id, handler) => {
        let mi = doc.createXULElement("menuitem");
        mi.id = id;
        mi.classList.add("zon-itemmenu");
        mi.addEventListener("command", handler);
        return mi;
      };
      let sep = doc.createXULElement("menuseparator");
      sep.id = "zon-itemmenu-sep";
      sep.classList.add("zon-itemmenu");
      let miSummary = mk("zon-itemmenu-summary", () => this.generateSummaryNotes(win));
      let miDOI = mk("zon-itemmenu-doi", () => this.findDOIsForItems(win));
      popup.appendChild(sep);
      popup.appendChild(miSummary);
      popup.appendChild(miDOI);
      let onShow = () => this.updateItemMenu(win, { sep, miSummary, miDOI });
      popup.addEventListener("popupshowing", onShow);
      win._zonItemMenu = { popup, items: [sep, miSummary, miDOI], onShow };
    } catch (e) { this.log("addItemMenu failed: " + e); }
  },

  // Show/label our menu items based on the live selection (runs on popupshowing).
  updateItemMenu(win, els) {
    try {
      let items = this.selectedRegularItems(win);
      let n = items.length;
      let show = n > 0;
      els.sep.hidden = !show;
      els.miSummary.hidden = !show;
      els.miDOI.hidden = !show;
      if (!show) return;
      els.miSummary.setAttribute("label",
        n === 1 ? this.t("menu.generateSummary") : this.t("menu.generateSummaryN", { count: n }));
      let missing = items.filter((it) => this.itemDoiState(it) === "missing").length;
      els.miDOI.hidden = missing === 0;
      els.miDOI.setAttribute("label",
        missing === 1 ? this.t("menu.findDOI") : this.t("menu.findDOIN", { count: missing }));
    } catch (e) {}
  },

  removeItemMenu(win) {
    try {
      let m = win._zonItemMenu;
      if (!m) return;
      try { m.popup.removeEventListener("popupshowing", m.onShow); } catch (e) {}
      for (let el of m.items) { try { el.remove(); } catch (e) {} }
      win._zonItemMenu = null;
    } catch (e) {}
  },


  // ----------------------------------------------------- Generate summary note

  // Render the DEFAULT template for `item`, strip all live-block delimiters and the
  // file-world frontmatter, convert the clean markdown to Zotero-note-safe HTML, and
  // create a NEW child note stamped with the Marker Tag. Create-once (ADR-0002):
  // every call adds a fresh note; no existing note is ever read or modified, and no
  // markdown file is touched. Returns the saved Zotero.Item (the note).
  // `templateName` selects the template to render (the Composer passes the pane's
  // chosen one); the context-menu path omits it and falls back to the default
  // scaffold, so the #25 behaviour is unchanged.
  async generateSummaryNote(win, item, templateName, opts = {}) {
    if (!win.ZONCore) await this.injectCore(win);
    // Templates folder IO once, not per selected item (loadTemplates caches in
    // _templates — guard like the other call sites).
    if (!this._templates) { try { await this.loadTemplates(); } catch (e) {} }
    // Same data assembly + render pipeline the preview uses, with the chosen (or
    // default) template. The Composer may pass `opts.md` — the exact raw markdown
    // the preview showed, with any {% llm %} output already resolved in place — so
    // the created note equals the preview (ADR-0001 static markdown); otherwise we
    // render fresh (the context-menu path, unchanged from #25).
    let md = (opts && typeof opts.md === "string")
      ? opts.md
      : await this.renderTemplateAsNote(win, item, templateName || this.defaultNoteTemplate());
    // File-world frontmatter first, then every %% zon %% / %% /zon %% / %% ann:KEY %%,
    // then the generic title heading (Zotero titles the note from its first line).
    md = win.ZONCore.stripFrontmatter(md);
    md = win.ZONCore.stripMarkers(md);
    md = win.ZONCore.withSummaryTitle(md, item.getField("title"));
    let html = win.ZONCore.mdToHtml(md);
    let note = new Zotero.Item("note");
    if (item.libraryID) note.libraryID = item.libraryID;
    note.parentID = item.id;
    note.setNote(html);
    note.addTag(this.MARKER_TAG);
    await note.saveTx();
    return note;
  },

  // Create-once refinement (#28): overwrite a SPECIFIC existing Summary Note's
  // body wholesale with a fresh render, replacing its content in place rather
  // than creating a new note. Only ever called after the caller has obtained
  // explicit confirmation (composerGenerate's dialog); never touches any note
  // other than `noteItem`. Still a one-way render — no merge with the old body.
  // Like generateSummaryNote, the Composer may pass `opts.md` — the exact raw
  // markdown of the preview with any {% llm %} output already resolved in place
  // (ADR-0001 static markdown) — so an overwrite never re-renders unresolved
  // {% llm %} blocks into the note.
  async overwriteSummaryNote(win, item, noteItem, templateName, opts = {}) {
    if (!win.ZONCore) await this.injectCore(win);
    if (!this._templates) { try { await this.loadTemplates(); } catch (e) {} }
    let md = (opts && typeof opts.md === "string")
      ? opts.md
      : await this.renderTemplateAsNote(win, item, templateName || this.defaultNoteTemplate());
    md = win.ZONCore.stripFrontmatter(md);
    md = win.ZONCore.stripMarkers(md);
    md = win.ZONCore.withSummaryTitle(md, item.getField("title"));
    let html = win.ZONCore.mdToHtml(md);
    noteItem.setNote(html);
    // Re-stamp defensively — the note already carried the tag (that's how it was
    // found), this just guards against it having been removed by hand.
    try {
      let tags = (noteItem.getTags && noteItem.getTags()) || [];
      if (!tags.some((t) => t && t.tag === this.MARKER_TAG)) noteItem.addTag(this.MARKER_TAG);
    } catch (e) {}
    await noteItem.saveTx();
    return noteItem;
  },

  // Standalone render→gate→resolve helper shared by the bulk generator. Renders
  // `templateName` for `item` in preview mode, builds compose gate state, and —
  // only if the template actually contains {% llm %} blocks — gathers
  // annotations/fulltext context and runs them through the SAME BYOK runner
  // composerRunLLM uses (ADR-0001: never write a note with an unresolved block).
  // Returns:
  //   { ok:true,  md }      — plain rendered md (no blocks) or the resolved
  //                           static md (blocks all ran ok)
  //   { ok:false, failure } — a human-readable, metadata-only reason (from
  //                           describeLLMFailure); NEVER writes a note.
  // No rec, no pane — purely functional over (win, item, templateName).
  async resolveSummaryMdForItem(win, item, templateName) {
    if (!win.ZONCore) await this.injectCore(win);
    let C = win.ZONCore;
    let name = templateName || this.defaultNoteTemplate();

    let md = await this.renderTemplateAsNote(win, item, name, { preview: true });
    let state = C.reconcileComposeState(null, md, { itemKey: item.key, templateName: name });

    if (!state || !C.composeHasLLMBlocks(state)) {
      return { ok: true, md };
    }

    // Guard: runner + gating exports present (graceful if an old bundle is cached).
    if (!C.executeLLMBlocks || !C.applyLLMOutputs) {
      return { ok: false, failure: this.t("err.llmCoreMissing") };
    }
    let settings = C.sanitizeLLMSettings(this.getLLMSettings());
    if (!C.isLLMConfigured(settings)) {
      return { ok: false, failure: this.t("err.llmNotConfigured") };
    }

    // Gather PDF annotations so context="annotations" blocks can resolve.
    let annotations = [];
    try { annotations = this.gatherAnnotations(item, win); }
    catch (e) { this.log("gatherAnnotations (bulk) failed: " + e); }

    // Fetch full text only when a block asks for it (avoids needless I/O).
    // LOGGING CONTRACT: never pass fulltext.text to this.log()/Zotero.debug —
    // metadata (title, char count, missing reason) only.
    let needFulltext = false;
    try { needFulltext = state.blocks.some((b) => b.contexts && b.contexts.includes("fulltext")); }
    catch (e) {}
    let fulltext = null;
    if (needFulltext) {
      fulltext = await this.getPrimaryPDFFulltext(item, C);
      if (fulltext && fulltext.ok) {
        this.log("fulltext context (bulk): " + (fulltext.attachmentTitle || "(untitled)") + " (" + fulltext.text.length + " chars)");
      } else if (fulltext) {
        this.log("fulltext context missing (bulk): " + fulltext.reason);
      }
    }

    // Build item data with parity to renderDocument so prompts can use any field.
    let citekey = this.getCitekey(item);
    let bibliography = await this.getBibliography(item);
    let data = {};
    try { data = C.buildItemData(item, { citekey, bibliography, importDate: new Date().toISOString(), annotations, fulltext }); }
    catch (e) { this.log("buildItemData (bulk) failed: " + e); }

    let fetchFn = async (url, headers, payload, timeoutSeconds) => {
      let resp = await Zotero.HTTP.request("POST", url, {
        headers, body: JSON.stringify(payload), responseType: "text",
        timeout: timeoutSeconds * 1000,
      });
      return resp.responseText;
    };
    let result = await C.executeLLMBlocks(md, data, settings, fetchFn);

    if (!result.ok) {
      return { ok: false, failure: this.describeLLMFailure(result) };
    }
    // executeLLMBlocks already applied the outputs — result.md is the resolved
    // static markdown, so there is nothing to substitute here.
    return { ok: true, md: result.md };
  },

  // Bulk config dialog: an in-window modal overlay (plain DOM, no iframe —
  // unlike openTemplateBuilder there's no editor needed here) gathering the
  // inputs generateSummaryNotes needs: which template, what to do with items
  // that already have a Summary Note, and a go/no-go on whether the LLM is
  // configured for templates that need it. Resolves { templateName, policy }
  // on Generate, or null on Cancel/backdrop/Esc.
  async openBulkDialog(win, count, opts = {}) {
    if (!win.ZONCore) await this.injectCore(win);
    let C = win.ZONCore;
    let NS = "http://www.w3.org/1999/xhtml";
    let h = (tag, cls) => {
      let el = win.document.createElementNS(NS, tag);
      if (cls) el.className = cls;
      return el;
    };
    let dark = this.isDarkTheme(win);

    return new Promise((resolve) => {
      let settled = false;
      let settle = (value) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (e) {}
        try { win.removeEventListener("keydown", onKeydown, true); } catch (e) {}
        resolve(value);
      };

      let overlay = h("div");
      overlay.id = "zon-bulk-overlay";
      overlay.setAttribute("style",
        "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;"
        + "justify-content:center;background:rgba(0,0,0,0.45);");
      let panel = h("div");
      panel.setAttribute("style",
        "width:420px;max-width:92%;border-radius:10px;padding:18px 20px;"
        + "box-shadow:0 10px 40px rgba(0,0,0,0.5);font-size:13px;line-height:1.45;"
        + "background:" + (dark ? "#1e1e1e" : "#ffffff") + ";"
        + "color:" + (dark ? "#e6e6e6" : "#1a1a1a") + ";");

      let title = h("h2");
      title.textContent = this.t("bulk.dialogTitle", { count });
      title.setAttribute("style", "margin:0 0 12px;font-size:15px;");

      // Template picker
      let templateLabel = h("label");
      templateLabel.textContent = this.t("bulk.templateLabel");
      templateLabel.setAttribute("style", "display:block;font-weight:600;margin-bottom:4px;");
      let templateSel = h("select");
      templateSel.setAttribute("style", "width:100%;margin-bottom:14px;padding:4px;");
      let names = this.orderedTemplateNames(win);
      let preselect = (opts && opts.templateName && names.includes(opts.templateName))
        ? opts.templateName : (names[0] || "");
      names.forEach((n) => { let o = h("option"); o.value = n; o.textContent = n; templateSel.appendChild(o); });
      templateSel.value = preselect;

      // Existing-note policy radios
      let policyWrap = h("div");
      policyWrap.setAttribute("style", "margin-bottom:12px;");
      let mkRadio = (value, labelText, checked) => {
        let row = h("label");
        row.setAttribute("style", "display:block;margin-bottom:4px;cursor:pointer;");
        let input = h("input");
        input.type = "radio"; input.name = "zon-bulk-policy"; input.value = value;
        input.checked = !!checked;
        row.append(input, win.document.createTextNode(" " + labelText));
        return { row, input };
      };
      let skipR = mkRadio("skip", this.t("bulk.policySkip"), true);
      let addR = mkRadio("additional", this.t("bulk.policyAdditional"), false);
      let overR = mkRadio("overwrite", this.t("bulk.policyOverwrite"), false);
      policyWrap.append(skipR.row, addR.row, overR.row);

      // Live heads-up line (LLM call count / not-configured warning)
      let headsUp = h("div");
      headsUp.setAttribute("style", "font-size:12px;margin-bottom:14px;min-height:16px;");

      // Buttons
      let btnRow = h("div");
      btnRow.setAttribute("style", "display:flex;justify-content:flex-end;gap:8px;");
      let cancelBtn = h("button");
      cancelBtn.textContent = this.t("bulk.cancel");
      let generateBtn = h("button");
      generateBtn.textContent = this.t("bulk.generate");
      generateBtn.setAttribute("style", "font-weight:600;");
      btnRow.append(cancelBtn, generateBtn);

      panel.append(title, templateLabel, templateSel, policyWrap, headsUp, btnRow);
      overlay.appendChild(panel);

      // Heads-up + Generate-disable refresh: render the currently-selected
      // template in preview mode and regex-check for {% llm %} — kept simple
      // and non-blocking; a failed/slow render just leaves the heads-up blank
      // rather than blocking the dialog. The authoritative per-item gate still
      // happens in resolveSummaryMdForItem during the actual run.
      let refreshHeadsUp = async () => {
        let name = templateSel.value;
        headsUp.textContent = "";
        generateBtn.disabled = false;
        let settings = C.sanitizeLLMSettings(this.getLLMSettings());
        let configured = C.isLLMConfigured(settings);
        try {
          let item0 = (this.selectedRegularItems(win) || [])[0];
          let md = item0 ? await this.renderTemplateAsNote(win, item0, name, { preview: true }) : "";
          let hasLLM = /\{%\s*llm\b/.test(String(md || ""));
          if (hasLLM) {
            if (!configured) {
              headsUp.textContent = this.t("bulk.llmNotConfigured");
              headsUp.style.color = "var(--accent-red,#c0392b)";
              generateBtn.disabled = true;
            } else {
              headsUp.textContent = this.t("bulk.llmHeadsUp", { n: count });
              headsUp.style.color = "";
            }
          }
        } catch (e) { this.log("bulk dialog heads-up render failed: " + e); }
      };
      templateSel.addEventListener("change", () => { refreshHeadsUp(); });
      refreshHeadsUp();

      cancelBtn.addEventListener("click", () => settle(null));
      generateBtn.addEventListener("click", () => {
        if (generateBtn.disabled) return;
        let policy = skipR.input.checked ? "skip" : addR.input.checked ? "additional" : "overwrite";
        settle({ templateName: templateSel.value, policy });
      });
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) settle(null); });
      let onKeydown = (e) => { if (e.key === "Escape") settle(null); };
      win.addEventListener("keydown", onKeydown, true);

      win.document.documentElement.appendChild(overlay);
    });
  },

  // Context-menu action: bulk AI summary generation across the current
  // multi-item selection. Opens a config dialog (template + existing-note
  // policy + LLM heads-up), plans each item's action via the pure
  // win.ZONCore.planBulk, then runs sequentially: skip / render+resolve+create /
  // render+resolve+overwrite. Continue-and-report (locked decision): a per-item
  // failure — including an LLM run failure, per ADR-0001 — records {title,
  // reason} and moves on; it NEVER writes a note with an unresolved {% llm %}
  // block or a partial body. Cross-item work stays sequential; the existing
  // intra-item llmConcurrency pref still parallelises block requests within a
  // single item's run.
  async generateSummaryNotes(win) {
    let items = this.selectedRegularItems(win);
    if (!items.length) return;
    if (!win.ZONCore) await this.injectCore(win);
    if (!this._templates) { try { await this.loadTemplates(); } catch (e) {} }
    let C = win.ZONCore;

    let config = await this.openBulkDialog(win, items.length, { templateName: this.defaultNoteTemplate() });
    if (!config) return;

    // Pre-flight guard (defense in depth — the dialog already disables Generate
    // in this case): never silently degrade to placeholder notes.
    let settings = C.sanitizeLLMSettings(this.getLLMSettings());
    try {
      let probe = await this.renderTemplateAsNote(win, items[0], config.templateName, { preview: true });
      let needsLLM = /\{%\s*llm\b/.test(String(probe || ""));
      if (needsLLM && !C.isLLMConfigured(settings)) {
        this.popup(win, this.t("menu.title"), this.t("bulk.llmNotConfigured"));
        return;
      }
    } catch (e) { this.log("generateSummaryNotes pre-flight probe failed: " + e); }

    let descriptors = items.map((item) => ({
      key: item.key,
      hasExistingNote: this.existingSummaryNotes(item).length > 0,
    }));
    let plan = C.planBulk(descriptors, config.policy);
    let planByKey = new Map(plan.map((p) => [p.key, p.action]));

    let pw = this.progress(win, this.t("summary.generatingTitle"));
    let created = 0, overwritten = 0, skipped = 0, failed = 0;
    let failures = [];

    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      let action = planByKey.get(item.key) || "skip";
      try { if (pw && pw.changeHeadline) pw.changeHeadline(this.t("bulk.progress", { i: i + 1, n: items.length })); } catch (e) {}

      if (action === "skip") { skipped++; continue; }

      try {
        let r = await this.resolveSummaryMdForItem(win, item, config.templateName);
        if (!r.ok) {
          failed++;
          failures.push({ title: item.getField("title") || "", reason: r.failure });
          continue;
        }
        if (action === "overwrite") {
          let target = this.newestNote(this.existingSummaryNotes(item));
          await this.overwriteSummaryNote(win, item, target, config.templateName, { md: r.md });
          overwritten++;
        } else {
          await this.generateSummaryNote(win, item, config.templateName, { md: r.md });
          created++;
        }
      } catch (e) {
        failed++;
        failures.push({ title: item.getField("title") || "", reason: (e && e.message) ? e.message : String(e) });
        this.log("generateSummaryNotes failed for " + (this.getCitekey(item) || item.key) + ": " + e);
      }
    }

    this.finishProgress(pw, C.summarizeBulkResults({ created, overwritten, skipped, failed }));
    if (failures.length) {
      this.log("bulk summary failures:\n" + C.formatBulkFailures(failures));
    }
  },

  // ----------------------------------------------------------- Crossref DOI lookup

  async findDOIsForItems(win) {
    let items = this.selectedRegularItems(win).filter((it) => this.itemDoiState(it) === "missing");
    if (!items.length) { this.popup(win, this.t("menu.title"), this.t("doi.noneMissing")); return; }
    let pw = this.progress(win, this.t("doi.searching"));
    let found = 0, none = 0, failed = 0;
    for (let item of items) {
      try {
        let r = await this.findDOIForItem(win, item);
        if (r === "found") found++; else none++;
      } catch (e) { this.log("findDOIForItem failed: " + e); failed++; }
      // Be polite to the public Crossref pool between requests.
      try { await new Promise((res) => win.setTimeout(res, 200)); } catch (e) {}
    }
    this.finishProgress(pw, this.t("doi.summary", { found, none, failed }));
  },

  // Look up ONE item's DOI on Crossref and write it back if a confident match is
  // found. Returns "found" | "none". Never overwrites an existing DOI (the caller
  // pre-filters to itemDoiState === "missing"); a weak title match writes nothing.
  async findDOIForItem(win, item) {
    if (!win.ZONCore) await this.injectCore(win);
    let title = (item.getField("title") || "").trim();
    if (!title) return "none";
    let creators = item.getCreators ? item.getCreators() : [];
    let author = (creators[0] && (creators[0].lastName || creators[0].name)) || "";
    let year = win.ZONCore.extractYear(item.getField("date") || "");
    let url = win.ZONCore.buildCrossrefURL({ title, author, year });
    let resp = await Zotero.HTTP.request("GET", url, {
      responseType: "text",
      timeout: 15000,
      headers: { "Accept": "application/json" },
    });
    let json;
    try { json = JSON.parse(resp.responseText || resp.response || "{}"); } catch (e) { return "none"; }
    let match = win.ZONCore.pickBestMatch(json, { title, author, year });
    if (!match || !match.doi) return "none";
    item.setField("DOI", match.doi);
    await item.saveTx();
    this.log("DOI set on " + item.key + ": " + match.doi);
    return "found";
  },

  // ------------------------------------------------------------ progress popups

  progress(win, headline) {
    try {
      let pw = new Zotero.ProgressWindow({ window: win });
      pw.changeHeadline(headline);
      pw.show();
      return pw;
    } catch (e) { this.log("progress window failed: " + e); return null; }
  },
  finishProgress(pw, text) {
    try {
      if (!pw) return;
      pw.addDescription(text);
      pw.startCloseTimer(7000);
    } catch (e) {}
  },
  popup(win, headline, text) { this.finishProgress(this.progress(win, headline), text); },

  // ---------------------------------------------------------------- annotations

  // Read all annotations from the item's PDF attachments, mapped to our shape.
  // For image (area) annotations we also assign a stable, citekey-/page-/key-based
  // `imageBaseName` (so the embed filename is deterministic and re-sync is
  // idempotent) and stash the annotation id for exportAnnotationImages to copy
  // the cached PNG out of Zotero. Naming only — the file copy is a separate step.
  gatherAnnotations(item, win) {
    let out = [];
    try {
      let citekey = this.getCitekey(item) || "ref";
      let C = win.ZONCore;
      let ids = item.getAttachments ? item.getAttachments() : [];
      for (let id of ids) {
        let att = Zotero.Items.get(id);
        if (!att) continue;
        let isPDF = att.isPDFAttachment ? att.isPDFAttachment()
          : (att.attachmentContentType === "application/pdf");
        if (!isPDF) continue;
        let anns = att.getAnnotations ? att.getAnnotations() : [];
        for (let a of anns) {
          let m = C.mapZoteroAnnotation(a, att.key);
          if (m.type === "image") {
            let page = (m.pageLabel != null && String(m.pageLabel).trim() !== "")
              ? String(m.pageLabel).trim() : String((m.pageIndex ?? 0) + 1);
            let base = `${citekey}-p${page}-${m.key}`;
            m.imageBaseName = (C.sanitizeFilename ? C.sanitizeFilename(base) : base) + ".png";
            m._annotationID = a.id; // for exportAnnotationImages (not serialised)
          }
          out.push(m);
        }
      }
    } catch (e) { this.log("gatherAnnotations failed: " + e); }
    return out;
  },

  // ------------------------------------------------ note awareness (#28)
  //
  // Existing Summary Notes + the read-only Stale Indicator. Everything here is
  // strictly read-only — it must never create, modify, or delete anything. The
  // only write paths for Summary Notes remain generateSummaryNote (create) and
  // overwriteSummaryNote (explicit-confirmation overwrite), both above.

  // The item's child notes carrying the Marker Tag — the ONLY recognition
  // mechanism for "this is one of ours" (never by title or body content, which
  // are freely hand-edited in Better Notes; see CONTEXT.md "Marker Tag").
  existingSummaryNotes(item) {
    let out = [];
    try {
      let ids = (item && item.getNotes) ? item.getNotes() : [];
      for (let id of ids) {
        let note = Zotero.Items.get(id);
        if (!note) continue;
        let tags = (note.getTags && note.getTags()) || [];
        if (tags.some((t) => t && t.tag === this.MARKER_TAG)) out.push(note);
      }
    } catch (e) { this.log("existingSummaryNotes failed: " + e); }
    return out;
  },

  // dateAdded as epoch ms, defaulting to 0 (oldest) for anything unparseable so
  // sorting/finding-the-newest never throws.
  noteDateAddedMs(note) {
    try {
      let t = new Date(note.dateAdded).getTime();
      return Number.isNaN(t) ? 0 : t;
    } catch (e) { return 0; }
  },

  // The most-recently-added of a list of Summary Note items (for the overwrite
  // target — Create-once only ever overwrites the NEWEST one).
  newestNote(notes) {
    if (!notes || !notes.length) return null;
    return notes.reduce((a, b) => (this.noteDateAddedMs(b) > this.noteDateAddedMs(a) ? b : a));
  },

  // Raw annotation dateModified values across the item's PDF attachments, for
  // the Stale Indicator's date comparison ONLY (src/staleness.js takes plain
  // {dateModified} descriptors). Deliberately separate from gatherAnnotations
  // (which maps to the render shape and does real work per annotation) — this
  // path stays a trivial, read-only date scan.
  annotationModifiedDates(item) {
    let out = [];
    try {
      let ids = (item && item.getAttachments) ? item.getAttachments() : [];
      for (let id of ids) {
        let att = Zotero.Items.get(id);
        if (!att) continue;
        let isPDF = att.isPDFAttachment ? att.isPDFAttachment()
          : (att.attachmentContentType === "application/pdf");
        if (!isPDF) continue;
        let anns = att.getAnnotations ? att.getAnnotations() : [];
        for (let a of anns) out.push({ dateModified: a.dateModified });
      }
    } catch (e) { this.log("annotationModifiedDates failed: " + e); }
    return out;
  },

  // Repaint the Composer's Summary Notes list + Stale Indicator badge for the
  // pane's current item. Called on item selection change and after a Generate
  // (renderInto / composerGenerate). Purely reads item/note/annotation state —
  // NEVER writes, and must stay that way (ADR-0002: the indicator is read-only).
  async refreshNoteAwareness(rec) {
    let notesListEl = rec.notesListEl, badgeEl = rec.staleBadgeEl;
    if (!notesListEl || !badgeEl) return;
    let win = rec.wrap.ownerDocument.defaultView;
    let item = rec.item;
    let doc = win.document;
    let mkLi = (cls, text) => {
      let li = doc.createElementNS("http://www.w3.org/1999/xhtml", "li");
      li.className = cls;
      li.textContent = text;
      return li;
    };

    notesListEl.textContent = "";
    badgeEl.textContent = ""; // hidden via :empty until (and unless) proven stale
    if (!item) return;

    let notes = this.existingSummaryNotes(item);
    // Distinct empty state: a non-interactive placeholder row (no tabindex, no
    // role, no click handler — see .zon-notes-placeholder) instead of a badge.
    if (!notes.length) {
      notesListEl.appendChild(mkLi("zon-notes-placeholder", this.t("composer.notes.empty")));
      return; // state is "no-note" by definition — nothing to compare
    }
    let sorted = notes.slice().sort((a, b) => this.noteDateAddedMs(b) - this.noteDateAddedMs(a));
    for (let note of sorted) {
      let title = "";
      try { title = (note.getNoteTitle && note.getNoteTitle()) || ""; } catch (e) {}
      let dateStr = "";
      try {
        let ms = this.noteDateAddedMs(note);
        if (ms) dateStr = new Date(ms).toLocaleString();
      } catch (e) {}
      let li = mkLi("zon-notes-item", (title || this.t("composer.notes.untitled")) + (dateStr ? " — " + dateStr : ""));
      li.title = this.t("composer.notes.open");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      let openNote = () => { try { win.ZoteroPane.selectItem(note.id); } catch (e) { this.log("open summary note failed: " + e); } };
      li.addEventListener("click", openNote);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); openNote(); }
      });
      notesListEl.appendChild(li);
    }

    // Stale Indicator — read-only comparison via the pure core module. The
    // badge renders ONLY when the state is "stale": "fresh" shows nothing, and
    // "no-note" was handled above by the placeholder row. Any failure here
    // degrades to no badge rather than throwing, since this must never block
    // the rest of the Composer.
    let state = "fresh";
    try {
      if (!win.ZONCore) await this.injectCore(win);
      if (rec.item !== item) return; // item changed while we awaited injectCore
      let noteDescs = notes.map((n) => ({ dateAdded: n.dateAdded }));
      let annDescs = this.annotationModifiedDates(item);
      state = win.ZONCore.summaryNoteStaleness(noteDescs, annDescs);
    } catch (e) { this.log("staleness compute failed: " + e); }
    if (rec.item !== item) return; // stale async result — a later refresh wins

    if (state === "stale") badgeEl.textContent = this.t("composer.notes.stale");
  },


  // Resolve the primary PDF's .zotero-ft-cache full text for LLM context="fulltext"
  // blocks. Builds a real Zotero adapter and delegates to C.resolvePrimaryPDFFulltext.
  // Returns {ok:true, attachmentTitle, text} or {ok:false, reason}.
  // LOGGING CONTRACT: Never log the returned text to this.log() or Zotero.debug.
  // Only metadata (attachment title, char count, missing reason) is loggable.
  async getPrimaryPDFFulltext(item, C) {
    const adapter = {
      getBestAttachment: async (it) => it.getBestAttachment(),
      isPDFAttachment: (att) => att.isPDFAttachment(),
      fileExists: (att) => att.fileExists(),
      getCacheFile: (att) => {
        try { let f = Zotero.Fulltext.getItemCacheFile(att); return f ? f.path : null; }
        catch (e) { return null; }
      },
      exists: (p) => IOUtils.exists(p),
      readUTF8: (p) => IOUtils.readUTF8(p),
      getAttachmentTitle: (att) => {
        try { return att.getField("title") || ""; }
        catch (e) { return ""; }
      },
    };
    try {
      return await C.resolvePrimaryPDFFulltext(item, adapter);
    } catch (e) {
      this.log("fulltext resolver threw: " + (e && e.message ? e.message : e));
      return { ok: false, reason: "fetchError" };
    }
  },

  // Key of the item's first PDF attachment, for the `{{openPdf}}` template var
  // (a reader deep link). "" when none — buildItemData then yields openPdf="".
  primaryPdfKey(item) {
    try {
      for (let id of (item && item.getAttachments ? item.getAttachments() : [])) {
        let att = Zotero.Items.get(id);
        if (att && (att.isPDFAttachment ? att.isPDFAttachment() : att.attachmentContentType === "application/pdf")) return att.key;
      }
    } catch (e) {}
    return "";
  },

  // Collapse/expand every open section's body (everything but the header) to match
  // the global collapsed pref. Toggled by clicking the section header. Also keeps
  // each header's aria-expanded in step for assistive tech.
  applyCollapsedAll(collapsed) {
    for (let rec of this.openRecs()) {
      try { if (rec.wrap) rec.wrap.classList.toggle("zon-collapsed", !!collapsed); } catch (e) {}
      try {
        let hb = rec.wrap && rec.wrap.querySelector(".zon-header-bar");
        if (hb) hb.setAttribute("aria-expanded", String(!collapsed));
      } catch (e) {}
    }
  },

  // Every currently-open editor rec across all main windows (light + shadow DOM).
  openRecs() {
    let out = [];
    let walk = (root) => {
      if (!root || !root.querySelectorAll) return;
      let ws;
      try { ws = root.querySelectorAll(".zon-content"); } catch (e) { return; }
      for (let w of ws) if (w._zon) out.push(w._zon);
      try { for (let el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); } catch (e) {}
    };
    try { for (let win of Zotero.getMainWindows()) walk(win.document); } catch (e) {}
    return out;
  },

  // describeLLMFailure: map C.executeLLMBlocks result.code to a human-readable
  // error string using existing err.llmRun* STRINGS keys. Never includes prompt
  // or response bodies (metadata-only). Returns "" for NO_BLOCKS (caller handles).
  describeLLMFailure(result) {
    if (!result || !result.code) return this.t("err.llmRunFailed", { error: "unknown" });

    // Prefer the canonical exported codes to avoid drift from string literals.
    let C;
    try { C = Zotero.getMainWindow && Zotero.getMainWindow().ZONCore; } catch (e) { C = null; }
    const E = C && C.LLM_RUN_ERRORS;

    const code = result.code;
    if (E && code === E.HTTP_FAILED) {
      let e = result.error;
      let status = (e && typeof e.status === "number") ? e.status : null;
      let errStr = status ? ("HTTP " + status) : "network error";
      return this.t("err.llmRunHttp", { i: result.blockIndex + 1, n: result.n, error: errStr });
    }
    if (E && code === E.EMPTY_RESPONSE) {
      return this.t("err.llmRunEmpty", { i: result.blockIndex + 1, n: result.n });
    }
    if (E && (code === E.CONTEXT_UNSUPPORTED || code === E.CONTEXT_MISSING
        || code === E.CONTEXT_TOO_LARGE || code === E.RENDER_FAILED)) {
      let first = result.errors && result.errors[0];
      return this.t("err.llmRunBlock",
        { line: first && first.line != null ? (first.line + 1) : "?", message: first ? first.message : "unknown" });
    }
    if (E && code === E.PARSE_ERRORS) {
      return this.t("err.llmBlocksInvalid", { count: result.errors ? result.errors.length : 0 });
    }
    if (E && code === E.NO_BLOCKS) return "";

    // Fallback: show the raw code (still metadata-only).
    return this.t("err.llmRunFailed", { error: code || "error" });
  },
  // --------------------------------------------------------- Template Builder
  // A dedicated builder surface: a full-window modal overlay (in the main window)
  // hosting ONE srcdoc iframe that loads core.bundle.js + editor.bundle.js +
  // builder-app.js. The iframe runs the whole builder UI (CM editor + palette +
  // live preview, all over ZONCore — the same pure engine the write paths use);
  // this glue gathers the preview context from the selected item, opens/tears
  // down the overlay, and provides the privileged insert/save bridge.
  async openTemplateBuilder(win, rec) {
    win = win || Zotero.getMainWindows()[0];
    if (!win) return;
    if (!win.ZONCore) await this.injectCore(win);
    this.closeTemplateBuilder(win); // only one at a time

    let item = (rec && rec.item) || (this.selectedRegularItems(win)[0] || null);
    let ctx = await this.gatherPreviewContext(win, item);
    let dark = this.isDarkTheme(win, rec && rec.host);
    // Name → raw text map of existing templates, for the builder's "Edit existing".
    // Plus the per-annotation format names (built-ins + custom, EXCLUDING field/
    // section/custom directive templates) for the block configurator's dropdown.
    let templates = {};
    let formatNames = [];
    try {
      await this.loadTemplates();
      let all = this.allTemplates(win) || {};
      for (let name in all) {
        let t = all[name];
        if (t && typeof t.text === "string") templates[name] = t.text;
        let dk = t && t.defaults && t.defaults.kind;
        if (t && t.kind === "format" && (!dk || dk === "annotations")) formatNames.push(name);
      }
      formatNames.sort();
    } catch (e) { this.log("builder: template list failed: " + e); }

    let NS = "http://www.w3.org/1999/xhtml";
    let overlay = win.document.createElementNS(NS, "div");
    overlay.id = "zon-builder-overlay";
    overlay.setAttribute("style",
      "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;"
      + "justify-content:center;background:rgba(0,0,0,0.45);");
    let panel = win.document.createElementNS(NS, "div");
    panel.setAttribute("style",
      "width:92%;height:88%;max-width:1180px;max-height:840px;border-radius:10px;"
      + "overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.5);background:"
      + (dark ? "#1e1e1e" : "#ffffff") + ";");
    let iframe = win.document.createElementNS(NS, "iframe");
    iframe.setAttribute("style", "width:100%;height:100%;border:0;display:block;background:transparent;");
    iframe.srcdoc = this.builderPageHTML(
      this.rootURI + "content/core.bundle.js",
      this.rootURI + "content/editor.bundle.js",
      this.rootURI + "content/builder-app.js",
      dark,
    );
    panel.appendChild(iframe);
    overlay.appendChild(panel);
    // Click the dimmed backdrop (not the panel) to close.
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) this.closeTemplateBuilder(win); });
    win.document.documentElement.appendChild(overlay);

    let self = this;
    let bridge = {
      // Templates only — the Builder never writes an item note file. Saving hands
      // off to the Composer (rec) so it selects the just-saved template.
      save: (name, text, setDefault) => self.builderSaveTemplate(win, rec, name, text, setDefault),
      close: () => self.closeTemplateBuilder(win),
    };
    // The Builder is a pure template-authoring surface. Seed the editor with the
    // TEMPLATE currently selected in the Composer's picker (falling back to the
    // default template), never a note file — and prefill the Save-as name with it so
    // saving updates that template.
    let initialName = (rec && rec.templateSel && rec.templateSel.value) || this.defaultNoteTemplate() || "";
    let initialDoc = null;
    try {
      let t = initialName ? (this.allTemplates(win) || {})[initialName] : null;
      if (t && typeof t.text === "string") initialDoc = t.text;         // folder template
      else if (t && typeof t.item === "string") initialDoc = t.item;    // built-in format body
      else initialDoc = await this.resolveNoteScaffoldText(initialName || undefined); // scaffold / default
    } catch (e) {}
    // Poll the (srcdoc-swapped) contentWindow for the app entry + both bundles,
    // then start it — same robustness trick the note editor iframe uses.
    let tries = 0;
    let waitForApp = function () {
      let fw = iframe.contentWindow;
      if (fw && fw.startBuilder && fw.ZONCore && fw.ZOSEditorLib) {
        try { fw.startBuilder({ previewCtx: ctx, bridge, dark, templates, formatNames, initialDoc, initialName }); }
        catch (e) { self.log("startBuilder failed: " + e); }
        return;
      }
      if (tries++ < 250) { try { win.setTimeout(waitForApp, 20); } catch (e) {} }
      else self.log("builder: app never appeared");
    };
    waitForApp();
  },

  closeTemplateBuilder(win) {
    try { let o = win.document.getElementById("zon-builder-overlay"); if (o) o.remove(); } catch (e) {}
  },

  // Build preview data for the selected item; null when nothing usable is selected
  // (the builder app then falls back to ZONCore's bundled sample data).
  async gatherPreviewContext(win, item) {
    if (!item) return null;
    try {
      let citekey = this.getCitekey(item) || "";
      let bibliography = "";
      try { bibliography = await this.getBibliography(item); } catch (e) {}
      let itemData = win.ZONCore.buildItemData(item, {
        citekey, bibliography,
        importDate: new Date().toISOString(),
        pdfAttachmentKey: this.primaryPdfKey(item),
        relations: this.relationsFor(item),
      });
      let annotations = this.gatherAnnotations(item, win);
      // Pass the full format map so the preview can render the user's custom
      // formats (and field formats), not just the built-ins.
      return { itemData, annotations, citekey, formats: this.formatMap(win) };
    } catch (e) { this.log("gatherPreviewContext failed: " + e); return null; }
  },

  // The srcdoc page: minimal markup + styles, then the three bundles (absolute
  // jar: URLs — Gecko loads <script src> from jar: fine, even though it won't
  // navigate the iframe document itself to jar:). builder-app.js builds the UI.
  builderPageHTML(coreURL, edURL, appURL, dark) {
    let bg = dark ? "#1e1e1e" : "#ffffff";
    let fg = dark ? "#e6e6e6" : "#1a1a1a";
    let muted = dark ? "#9aa0a6" : "#666";
    let border = dark ? "#3a3a3a" : "#ddd";
    let pane = dark ? "#252526" : "#f6f6f6";
    let accent = "#7048e8";
    let css = "html,body{margin:0;height:100%;background:" + bg + ";color:" + fg + ";font:13px/1.4 -apple-system,system-ui,sans-serif;}"
      + "#zon-builder-root{display:flex;flex-direction:column;height:100%;}"
      + ".b-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid " + border + ";}"
      + ".b-title{font-weight:600;font-size:14px;}.b-sub{color:" + muted + ";font-size:12px;flex:1;}"
      + ".b-x{margin-left:auto;border:0;background:transparent;color:" + muted + ";font-size:15px;cursor:pointer;}"
      + ".b-toggle{display:flex;align-items:center;gap:4px;font-size:11px;color:" + muted + ";cursor:pointer;white-space:nowrap;}"
      + ".b-help{padding:6px 14px;font-size:11px;color:" + muted + ";background:" + pane + ";border-bottom:1px solid " + border + ";}"
      + ".b-body{flex:1;display:flex;min-height:0;}"
      + ".b-side{width:300px;border-right:1px solid " + border + ";overflow:auto;padding:8px 10px;background:" + pane + ";}"
      + ".b-pal-head{font-weight:600;color:" + muted + ";font-size:11px;text-transform:uppercase;margin:12px 2px 5px;}"
      + ".b-section{font-weight:700;color:" + fg + ";font-size:13px;text-transform:uppercase;letter-spacing:.02em;margin:14px 0 6px;padding-top:10px;border-top:2px solid " + border + ";}"
      + ".b-ctx{font-size:11px;color:" + accent + ";background:rgba(112,72,232,0.10);border-radius:5px;padding:5px 8px;margin:2px 0 8px;}"
      + ".b-pal-group{display:flex;flex-wrap:wrap;gap:4px;}"
      + ".b-chip{border:1px solid " + border + ";background:" + bg + ";color:" + fg + ";border-radius:5px;padding:3px 7px;font-size:11px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
      + ".b-chip:hover{border-color:" + accent + ";color:" + accent + ";}.b-chip-l{pointer-events:none;}"
      + ".b-chip.b-on{border-color:" + accent + ";color:" + accent + ";background:rgba(112,72,232,0.12);font-weight:600;}"
      + ".b-col{text-transform:capitalize;}.b-rm{color:#d33;font-weight:600;}"
      // guided chooser + compose form
      + ".b-chooser{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}"
      + ".b-chooser-q{font-size:18px;font-weight:600;margin-bottom:20px;}"
      + ".b-cards{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;max-width:760px;}"
      + ".b-card{width:220px;border:1px solid " + border + ";border-radius:10px;padding:16px;cursor:pointer;background:" + pane + ";transition:border-color .1s;}"
      + ".b-card:hover{border-color:" + accent + ";}.b-card-off{opacity:.45;cursor:default;}.b-card-off:hover{border-color:" + border + ";}"
      + ".b-card-t{font-weight:600;font-size:14px;margin-bottom:6px;}.b-card-d{color:" + muted + ";font-size:12px;line-height:1.45;}"
      + ".b-back{border:0;background:transparent;color:" + accent + ";cursor:pointer;font-size:12px;padding:0 6px 0 0;}"
      + ".b-form{display:flex;flex-direction:column;gap:6px;margin:2px 0 8px;}"
      + ".b-form-h{font-weight:600;font-size:11px;color:" + muted + ";margin:8px 0 2px;}"
      + ".b-checks{display:flex;flex-wrap:wrap;gap:2px 12px;}"
      + ".b-check{display:flex;align-items:center;gap:5px;font-size:12px;width:46%;cursor:pointer;}"
      + ".b-form-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:3px 0;}"
      + ".b-form-rl{font-size:12px;color:" + fg + ";}"
      + ".b-select{border:1px solid " + border + ";border-radius:5px;padding:3px 6px;background:" + bg + ";color:" + fg + ";font-size:12px;max-width:170px;}"
      + ".b-gen{width:100%;margin:6px 0 2px;}"
      + ".b-hint{color:" + muted + ";font-size:11px;line-height:1.4;margin:4px 2px 8px;}"
      + ".b-editor,.b-preview{flex:1;display:flex;flex-direction:column;min-width:0;}"
      + ".b-editor{border-right:1px solid " + border + ";}"
      + ".b-colhead{font-weight:600;color:" + muted + ";font-size:11px;text-transform:uppercase;padding:8px 12px;display:flex;align-items:center;gap:8px;}"
      + ".b-editor-host{flex:1;min-height:0;overflow:auto;}.cm-editor{height:100%;}"
      + ".b-kind{font-weight:500;text-transform:none;color:" + accent + ";border:1px solid " + accent + ";border-radius:4px;padding:0 6px;font-size:10px;}"
      + ".b-kind-err{color:#d33;border-color:#d33;}"
      + ".b-preview-out{flex:1;margin:0;padding:10px 14px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,monospace;}"
      + ".b-preview-out.b-err{color:#d33;}"
      + ".b-preview-host{flex:1;min-height:0;overflow:auto;}"
      + ".b-footer{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid " + border + ";background:" + pane + ";}"
      + ".b-name-label{color:" + muted + ";}.b-name{border:1px solid " + border + ";border-radius:5px;padding:4px 8px;background:" + bg + ";color:" + fg + ";width:160px;}"
      + ".b-btn{border:1px solid " + border + ";background:" + bg + ";color:" + fg + ";border-radius:6px;padding:5px 12px;cursor:pointer;}"
      + ".b-btn:hover{border-color:" + accent + ";}.b-primary{background:" + accent + ";color:#fff;border-color:" + accent + ";}"
      + ".b-btn:disabled{opacity:0.4;cursor:not-allowed;border-color:" + border + ";background:" + bg + ";color:" + fg + ";}"
      + ".b-status{margin-left:auto;color:" + muted + ";}.b-status.b-err{color:#d33;}";
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css + '</style></head>'
      + '<body><div id="zon-builder-root"></div>'
      + '<script src="' + coreURL + '"></scr' + 'ipt>'
      + '<script src="' + edURL + '"></scr' + 'ipt>'
      + '<script src="' + appURL + '"></scr' + 'ipt>'
      + '</body></html>';
  },

  // Bridge OUT: write the builder's template SOURCE to the Templates folder
  // (idempotent — confirms before overwriting; always the templates folder via the
  // atomic safeWrite path, NEVER an item note file), then refresh the template list
  // and hand off to the Composer — select the just-saved template and refresh its
  // preview — so closing the Builder lands on the new template ready to Generate.
  async builderSaveTemplate(win, rec, name, text, setDefault) {
    let safe = String(name || "").trim().replace(/\.md$/i, "").replace(/[\/\\:*?"<>|]+/g, "-");
    if (!safe) throw new Error("empty name");
    let dir = this.templatesDir();
    try { await IOUtils.makeDirectory(dir, { ignoreExisting: true }); } catch (e) {}
    let path = PathUtils.join(dir, safe + ".md");
    if (await IOUtils.exists(path)) {
      let ok = Services.prompt.confirm(win, "Obsidian Notepad", this.t("msg.builderOverwrite", { name: safe }));
      if (!ok) return "Save cancelled";
    }
    await this.safeWrite(path, String(text || ""));
    try { await this.refreshTemplates(); } catch (e) {}
    // Optionally make this the template the Composer selects by default.
    if (setDefault) { try { Zotero.Prefs.set(this.PREF_DEFAULT_NOTE, safe, true); } catch (e) {} }
    // Hand off to the Composer that opened the Builder: point its picker at the
    // just-saved template and refresh the preview.
    try { await this.selectComposerTemplate(rec, safe); } catch (e) { this.log("builder handoff failed: " + e); }
    return this.t("status.templateSaved", { name: safe }) + (setDefault ? " — set as default" : "");
  },

  // Point a Composer pane's template picker at `name` and refresh its preview.
  // Used by the Builder handoff so a just-saved template is selected in the Composer.
  async selectComposerTemplate(rec, name) {
    if (!rec || !rec.templateSel) return;
    try { await this.populateComposerTemplates(rec); } catch (e) {}
    let sel = rec.templateSel;
    if (name && Array.prototype.some.call(sel.options, (o) => o.value === name)) {
      sel.value = name;
      this.schedulePreview(rec, { immediate: true });
    }
  },
};

// ---------------------------------------------------------------- bootstrap

function install() {}
function uninstall() {}

function startup({ rootURI }) {
  try {
    Zotero.initializationPromise.then(function () {
      ZON.init(rootURI).catch(function (e) { try { Zotero.debug("ZON init failed: " + e); } catch (e2) {} });
    });
  } catch (e) {}
}

function shutdown() { try { ZON.uninit(); } catch (e) {} }
function onMainWindowLoad({ window }) { ZON.addToWindow(window); }
function onMainWindowUnload() {}
