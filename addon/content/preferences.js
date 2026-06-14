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
  const map = [
    ["zon-vault-browse", "zon-vault", PREFIX + "vaultPath"],
    ["zon-notes-browse", "zon-notes", PREFIX + "notesDir"],
    ["zon-templates-browse", "zon-templates", PREFIX + "templatesDir"],
  ];
  for (const [btnId, inputId, prefKey] of map) {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener("click", () => browse(inputId, prefKey));
  }
}
