// Note-type editor — the in-iframe app (plain script, no bundler).
//
// Runs INSIDE the builder overlay's srcdoc iframe, after core.bundle.js (global
// ZONCore) and editor.bundle.js (global ZOSEditorLib) have loaded. bootstrap.js
// polls for window.startBuilder and calls it once with the preview context and a
// bridge of privileged note-type actions (KTD8): list, save, rename, delete and
// reset (each resolving { ok, message, templates, name? }), plus confirm, prompt
// and close.
//
// Layout: note-type list | name and paper type fields over the markdown source
// beside the rendered preview for the selected item. The preview goes through the
// Composer's composePreviewHtml, so {% llm %} blocks show as placeholders and never
// run (KTD11).

(function () {
  "use strict";

  window.startBuilder = function (opts) {
    opts = opts || {};
    var Core = window.ZONCore, Ed = window.ZOSEditorLib;
    if (!Core || !Ed || !Core.previewTemplate) return false;

    var bridge = opts.bridge || {};
    var usingSample = !(opts.previewCtx && opts.previewCtx.itemData);
    var ctx = usingSample
      ? { itemData: Core.SAMPLE_ITEM, annotations: Core.SAMPLE_ANNOTATIONS, citekey: Core.SAMPLE_ITEM.citekey }
      : opts.previewCtx;

    var doc = document;
    var root = doc.getElementById("zon-builder-root") || doc.body;
    root.textContent = "";
    var el = function (tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    var btn = function (label, onClick, cls) {
      var b = el("button", cls || "b-btn", label);
      b.addEventListener("click", function () { onClick(); });
      return b;
    };

    // ---- header -------------------------------------------------------------
    var header = el("div", "b-header");
    var closeX = btn("✕", requestClose, "b-x"); closeX.title = "Close (Esc)";
    header.append(el("span", "b-title", "Note types"), el("span", "b-sub", usingSample
      ? "Previewing with sample data (no item selected)"
      : "Previewing: " + (ctx.itemData.title || ctx.citekey || "selected item")), closeX);

    // ---- toolbar ------------------------------------------------------------
    var toolbar = el("div", "b-toolbar");
    var dupBtn = btn("Duplicate", onDuplicate), renameBtn = btn("Rename", onRename);
    var deleteBtn = btn("Delete", onDelete), resetBtn = btn("Reset to built-in", onReset);
    var insertSel = el("select", "b-select");
    var insertHint = el("option", null, "Insert…"); insertHint.value = "";
    insertSel.append(insertHint);
    Core.INSERT_SNIPPETS.forEach(function (s, i) { var o = el("option", null, s.label); o.value = String(i); insertSel.append(o); });
    insertSel.addEventListener("change", function () {
      var s = Core.INSERT_SNIPPETS[insertSel.value];
      insertSel.value = "";
      if (s) Ed.insertAtCursor(view, s.text);
    });
    var saveBtn = btn("Save", onSave, "b-btn b-primary");
    var status = el("span", "b-status");
    toolbar.append(btn("New", onNew), dupBtn, renameBtn, deleteBtn, resetBtn, insertSel, saveBtn, status, btn("Close", requestClose));

    // ---- body: list | fields over (source | preview) ------------------------
    var body = el("div", "b-body");
    var list = el("div", "b-side");
    var main = el("div", "b-main");
    var empty = el("div", "b-empty", "No note types. Click New to create one.");
    body.append(list, main, empty);

    var fieldsRow = el("div", "b-fields");
    var field = function (label, cls) {
      var lab = el("label", "b-field" + (cls ? " " + cls : ""), label);
      var input = el("input", "b-input"); input.type = "text";
      lab.append(input); fieldsRow.append(lab);
      return input;
    };
    var nameIn = field("Name");
    var labelIn = field("Paper type label");
    var descIn = field("Paper type description", "b-field-wide");

    var split = el("div", "b-split");
    var editorCol = el("div", "b-editor"), editorHost = el("div", "b-editor-host");
    editorCol.append(el("div", "b-colhead", "Markdown"), editorHost);
    var previewCol = el("div", "b-preview"), previewHost = el("div", "b-preview-host zon-preview");
    previewCol.append(el("div", "b-colhead", "Preview"), previewHost);
    split.append(editorCol, previewCol);
    main.append(fieldsRow, split);
    root.append(header, toolbar, body);

    var view = Ed.create({
      parent: editorHost, doc: "", dark: !!opts.dark,
      readMode: false, showMarkers: true, showFrontmatter: true,
      onChange: schedulePreview,
    });

    // ---- preview ------------------------------------------------------------
    // The Composer's render → strip → title → HTML steps; LLM blocks become inert
    // placeholders (composePreviewHtml), nothing executes. The HTML is our own
    // (mdToHtml with html:false + escaped placeholders), realised via DOMParser as
    // the Composer does.
    var previewTimer = null;
    function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 180); }
    function renderPreview() {
      previewHost.textContent = "";
      var r = Core.previewTemplate(Ed.getDoc(view), ctx), html;
      try {
        if (r.error) throw new Error(r.raw);
        html = Core.composePreviewHtml(Core.withSummaryTitle(r.preview, ctx.itemData.title), { model: opts.model });
      } catch (e) {
        previewHost.append(el("div", "zon-preview-error", (e && e.message) || String(e)));
        return;
      }
      var parsed = new DOMParser().parseFromString("<!DOCTYPE html><body>" + html + "</body>", "text/html");
      Array.prototype.slice.call(parsed.body.childNodes).forEach(function (n) { previewHost.append(doc.importNode(n, true)); });
    }

    // ---- state --------------------------------------------------------------
    var entries = [];   // bridge.list(), then the fresh list every action returns
    var current = null; // { name, isNew }; null shows the empty state
    var saved = null;   // fields + buffer as last loaded or saved (KTD14)

    function find(name) { return entries.filter(function (e) { return e.name === name; })[0] || null; }
    function firstDeclared() { var e = entries.filter(function (x) { return !x.needsPaperType; })[0]; return e ? e.name : null; }
    function values() { return { name: nameIn.value, label: labelIn.value, description: descIn.value, body: Ed.getDoc(view) }; }
    function isDirty() {
      if (!current) return false;
      var v = values();
      return v.name !== saved.name || v.label !== saved.label || v.description !== saved.description || v.body !== saved.body;
    }
    // Run `fn` unless there are unsaved edits the researcher declines to discard.
    function guard(fn) {
      if (!isDirty() || bridge.confirm("Discard your unsaved changes to "
        + (current.isNew ? "the new note type" : "‘" + current.name + "’") + "?")) fn();
    }

    function load(state) {
      current = state ? { name: state.name, isNew: !!state.isNew } : null;
      state = state || { name: "", label: "", description: "", body: "" };
      main.style.display = current ? "" : "none";
      empty.style.display = current ? "none" : "";
      nameIn.value = state.name; labelIn.value = state.label; descIn.value = state.description;
      nameIn.readOnly = !(current && current.isNew); // only Rename changes a saved name (KTD8)
      Ed.setDoc(view, state.body);
      saved = values();
      renderPreview(); refresh();
    }
    // The buffer is the markdown without the declaration; the fields carry it,
    // including a shipped copy's inherited one (KTD7).
    function open(name) {
      var e = find(name);
      load(e && { name: e.name, label: e.label, description: e.description, body: Core.splitDeclaration(e.text).body });
    }

    function refresh() {
      var e = current && !current.isNew ? find(current.name) : null;
      dupBtn.disabled = renameBtn.disabled = deleteBtn.disabled = !e;
      resetBtn.style.display = e && e.shipped ? "" : "none";
      saveBtn.disabled = insertSel.disabled = !current;
      list.textContent = "";
      if (current && current.isNew) list.append(el("div", "b-item b-on", "New note type (unsaved)"));
      entries.forEach(function (x) {
        var row = el("button", "b-item" + (x === e ? " b-on" : ""), x.name);
        if (x.needsPaperType) row.append(el("span", "b-flag", "Needs a paper type"));
        if (x.duplicateLabel) row.append(el("span", "b-flag", "Duplicate label: " + x.label));
        if (x.label) row.title = x.label + (x.description ? " — " + x.description : "");
        row.addEventListener("click", function () { if (x !== e) guard(function () { open(x.name); }); });
        list.append(row);
      });
    }

    function flash(msg, isErr) { status.textContent = msg || ""; status.className = "b-status" + (isErr ? " b-err" : ""); }
    // Every bridge action resolves { ok, message, templates, name? }: rebuild the
    // list from the fresh templates, show the message, then run `onOk`.
    function run(result, onOk) {
      flash("Working…");
      Promise.resolve(result).then(function (res) {
        res = res || {};
        if (res.templates) entries = res.templates;
        flash(res.message, !res.ok);
        if (res.ok && onOk) onOk(res);
        refresh();
      }, function (err) { flash("Failed: " + err, true); });
    }

    // ---- actions ------------------------------------------------------------
    function onNew() {
      guard(function () { load({ name: "", isNew: true, label: "", description: "", body: Core.NEW_NOTE_TYPE_SCAFFOLD }); flash(""); nameIn.focus(); });
    }
    // R14: the open note type's saved markdown, with name and paper type empty.
    function onDuplicate() {
      guard(function () { load({ name: "", isNew: true, label: "", description: "", body: saved.body }); flash(""); nameIn.focus(); });
    }
    function onRename() {
      var to = bridge.prompt("Rename note type ‘" + current.name + "’ to:", current.name);
      if (to == null || to === current.name) return;
      run(bridge.rename(current.name, to), function (res) {
        current.name = res.name; saved.name = res.name; nameIn.value = res.name;
      });
    }
    function onDelete() {
      run(bridge.delete(current.name), function () { open(firstDeclared()); });
    }
    function onReset() {
      guard(function () { run(bridge.reset(current.name), function (res) { open(res.name); }); });
    }
    // Client-side check for empty fields only; the bridge re-validates name and
    // label rules and is authoritative (KTD8).
    function onSave() {
      var v = values(), missing = [];
      if (current.isNew && !v.name.trim()) missing.push("Name");
      if (!v.label.trim()) missing.push("Paper type label");
      if (!v.description.trim()) missing.push("Paper type description");
      if (missing.length) { flash("Fill in: " + missing.join(", ") + ".", true); return; }
      run(bridge.save({ name: current.isNew ? v.name : current.name, isNew: current.isNew, label: v.label, description: v.description, body: v.body }), function (res) {
        current = { name: res.name, isNew: false };
        saved = { name: res.name, label: v.label.trim(), description: v.description.trim(), body: v.body };
        nameIn.value = saved.name; labelIn.value = saved.label; descIn.value = saved.description;
        nameIn.readOnly = true;
      });
    }
    function requestClose() {
      guard(function () {
        try { Ed.destroy(view); } catch (e) {}
        if (bridge.close) bridge.close();
      });
    }
    window.builderRequestClose = requestClose; // the overlay backdrop closes through here
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") requestClose(); });

    entries = bridge.list ? bridge.list() : [];
    open(find(opts.initialName) ? opts.initialName : firstDeclared());
    try { view.focus(); } catch (e) {}
    return true;
  };
})();
