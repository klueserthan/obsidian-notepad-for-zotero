// Loaded into the Zotero preferences window by PreferencePanes.register({scripts}).
// Wires the "Browse…" buttons next to the folder fields to a native folder
// picker. Runs in the prefs-window scope (window / document / Components / Zotero).
{
  const Cc = Components.classes;
  const Ci = Components.interfaces;

  function browse(inputId, prefKey) {
    const input = document.getElementById(inputId);
    let fp;
    try { fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker); }
    catch (e) { return; }
    fp.init(window.browsingContext || window, "Choose a folder", fp.modeGetFolder);
    try {
      const cur = input && input.value;
      if (cur) {
        const d = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        d.initWithPath(cur);
        if (d.exists()) fp.displayDirectory = d;
      }
    } catch (e) {}
    fp.open((rv) => {
      if (rv !== Ci.nsIFilePicker.returnOK || !fp.file) return;
      const path = fp.file.path;
      try { Zotero.Prefs.set(prefKey, path, true); } catch (e) {}
      if (input) {
        input.value = path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  const PREFIX = "extensions.zotero-obsidian-notes.";

  // Wire the Browse… button. The pane's XHTML can be inserted a tick AFTER
  // this script runs (same race as the dropdown below), so retry until the
  // control exists instead of bailing once — otherwise the listener silently
  // never attaches. Flagged so retries don't double-bind.
  function wireControls(tries) {
    const btn = document.getElementById("zon-templates-browse");
    if (!btn) {
      if ((tries || 0) < 40) window.setTimeout(() => wireControls((tries || 0) + 1), 50);
      return;
    }
    if (!btn._zonWired) { btn._zonWired = true; btn.addEventListener("click", () => browse("zon-templates", PREFIX + "templatesDir")); }
  }
  wireControls();

  // Populate the "Default note template" dropdown from the declared note types
  // (Zotero.ZON.prefsTemplateNames(), each declaring a unique paper type) and
  // select the resolved default (Zotero.ZON.defaultNoteTemplate()). The pane's
  // XHTML can be inserted a tick after the script runs, so retry until the
  // <select> exists rather than bailing once (which left it blank — bug b).
  // Go through ZON rather than enumerating the Templates folder directly —
  // IOUtils in the prefs-window scope raced the folder load and left the
  // dropdown stuck on built-ins-only until a Zotero restart.
  async function populateDefaultNote(tries) {
    const sel = document.getElementById("zon-default-note");
    if (!sel) {
      if ((tries || 0) < 40) window.setTimeout(() => populateDefaultNote((tries || 0) + 1), 50);
      return;
    }
    if (sel._zonPopulated) return;
    const ZON = Zotero.ZON;
    if (!ZON || !ZON.prefsTemplateNames) {
      if ((tries || 0) < 40) window.setTimeout(() => populateDefaultNote((tries || 0) + 1), 50);
      return;
    }
    try { await ZON.loadTemplates(); } catch (e) {}
    let names = [];
    let def = "";
    try { names = ZON.prefsTemplateNames() || []; } catch (e) {}
    try { def = ZON.defaultNoteTemplate() || ""; } catch (e) {}
    sel._zonPopulated = true;
    sel.textContent = "";
    if (names.length === 0) {
      const o = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
      o.value = ""; o.textContent = "No note types — add one in the Template Builder";
      o.disabled = true;
      sel.appendChild(o);
      sel.value = "";
      return;
    }
    for (const n of names) {
      const o = document.createElementNS("http://www.w3.org/1999/xhtml", "option");
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    }
    sel.value = def;
    sel.addEventListener("change", () => {
      try { Zotero.Prefs.set(PREFIX + "defaultNoteTemplate", sel.value, true); } catch (e) {}
    });
  }
  populateDefaultNote();

  // Wire the "Test LLM connection" button to call Zotero.ZON.testLLMConnection().
  function wireLLMTest(tries) {
    const testBtn = document.getElementById("zon-llm-test");
    if (!testBtn) {
      if ((tries || 0) < 40) window.setTimeout(() => wireLLMTest((tries || 0) + 1), 50);
      return;
    }
    if (testBtn._zonWired) return;
    testBtn._zonWired = true;
    testBtn.addEventListener("click", async () => {
      const resultEl = document.getElementById("zon-llm-test-result");
      if (resultEl) { resultEl.textContent = "Testing…"; resultEl.style.color = "#888"; }
      testBtn.disabled = true;
      try {
        const baseURLEl = document.getElementById("zon-llm-baseurl");
        const modelEl = document.getElementById("zon-llm-model");
        const apiKeyEl = document.getElementById("zon-llm-apikey");
        const tempEl = document.getElementById("zon-llm-temperature");
        const maxTokensEl = document.getElementById("zon-llm-maxtokens");
        const maxContextEl = document.getElementById("zon-llm-maxcontext");
        const timeoutEl = document.getElementById("zon-llm-timeout");
        const autoRunEl = document.getElementById("zon-llm-autorun");
        const settings = {
          baseURL: baseURLEl ? baseURLEl.value : "",
          model: modelEl ? modelEl.value : "",
          apiKey: apiKeyEl ? apiKeyEl.value : "",
          temperature: tempEl ? parseFloat(tempEl.value) : 0.2,
          maxTokens: maxTokensEl ? parseInt(maxTokensEl.value, 10) : 2048,
          maxContextChars: maxContextEl ? parseInt(maxContextEl.value, 10) : 100000,
          timeoutSeconds: timeoutEl ? parseInt(timeoutEl.value, 10) : 60,
          autoRun: autoRunEl ? autoRunEl.checked : false,
        };
        const result = await Zotero.ZON.testLLMConnection(settings);
        if (resultEl) {
          resultEl.textContent = result.message;
          resultEl.style.color = result.ok ? "#080" : "#c00";
        }
      } catch (e) {
        if (resultEl) {
          resultEl.textContent = "Test failed: " + (e && e.message ? e.message : String(e));
          resultEl.style.color = "#c00";
        }
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  wireLLMTest();

  // Gate the auto-run checkbox: disabled + unchecked when base URL or model is empty.
  function wireLLMAutoRunGate(tries) {
    const baseURLInput = document.getElementById("zon-llm-baseurl");
    const modelInput = document.getElementById("zon-llm-model");
    const autoRunChk = document.getElementById("zon-llm-autorun");
    if (!baseURLInput || !modelInput || !autoRunChk) {
      if ((tries || 0) < 40) window.setTimeout(() => wireLLMAutoRunGate((tries || 0) + 1), 50);
      return;
    }
    if (autoRunChk._zonGated) return;
    autoRunChk._zonGated = true;

    function updateGate() {
      const configured = !!(baseURLInput.value.trim() && modelInput.value.trim());
      if (!configured) {
        autoRunChk.disabled = true;
        if (autoRunChk.checked) {
          autoRunChk.checked = false;
          try { Zotero.Prefs.set(PREFIX + "llmAutoRun", false, true); } catch (e) {}
        }
      } else {
        autoRunChk.disabled = false;
      }
    }

    baseURLInput.addEventListener("input", updateGate);
    modelInput.addEventListener("input", updateGate);
    updateGate();
  }
  wireLLMAutoRunGate();
}
