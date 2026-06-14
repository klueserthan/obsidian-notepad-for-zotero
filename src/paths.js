// Pure, cross-platform path helpers — locating Obsidian's config and computing
// vault-relative paths. NO filesystem access here: callers (bootstrap) read
// files and pass strings in, so every function is unit-testable for Windows and
// POSIX alike. Zotero's IOUtils/PathUtils handle the actual I/O.

// Split a path into components, tolerating either separator — a notesDir the
// user typed (or pasted) with the "wrong" slash should still resolve.
export function splitPath(p) {
  return String(p || "").split(/[\\/]+/).filter(Boolean);
}

// Vault folder name = its basename. This is what Obsidian's `?vault=` expects.
export function vaultName(vaultPath) {
  const parts = splitPath(vaultPath);
  return parts.length ? parts[parts.length - 1] : "";
}

// The vault-relative, forward-slash, extension-less path of a note — or null if
// the note isn't under the vault. Obsidian's `obsidian://open?file=` always uses
// "/" regardless of OS. Comparison is case-insensitive (Windows + default macOS).
export function vaultRelative(notePath, vaultPath) {
  const v = splitPath(vaultPath);
  const n = splitPath(notePath);
  if (!v.length || n.length <= v.length) return null;
  for (let i = 0; i < v.length; i++) {
    if (String(n[i]).toLowerCase() !== String(v[i]).toLowerCase()) return null;
  }
  return n.slice(v.length).join("/").replace(/\.md$/i, "");
}

// Build the obsidian:// deep link to open a note in a vault.
export function buildObsidianUri(vName, relPath) {
  return "obsidian://open?vault=" + encodeURIComponent(vName)
    + "&file=" + encodeURIComponent(relPath);
}

// Where Obsidian stores its known-vaults list, per OS. `env` carries the
// caller-supplied environment strings so this stays pure/testable:
//   { home, appData, xdgConfigHome }
// os is one of "mac" | "win" | "linux".
export function obsidianConfigPath(os, env = {}) {
  const home = env.home || "";
  if (os === "mac") {
    return joinWith("/", home, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  if (os === "win") {
    const base = env.appData || joinWith("\\", home, "AppData", "Roaming");
    return joinWith("\\", base, "obsidian", "obsidian.json");
  }
  // linux + anything else: XDG spec
  const cfg = env.xdgConfigHome || joinWith("/", home, ".config");
  return joinWith("/", cfg, "obsidian", "obsidian.json");
}

// Parse obsidian.json → [{ path, name, open }]. Tolerant of malformed input.
// Shape: { vaults: { "<id>": { path, ts, open } , … } }
export function parseObsidianVaults(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { return []; }
  const vaults = data && data.vaults;
  if (!vaults || typeof vaults !== "object") return [];
  return Object.keys(vaults)
    .map((id) => {
      const v = vaults[id] || {};
      return { path: v.path || "", name: vaultName(v.path || ""), open: !!v.open };
    })
    .filter((v) => v.path);
}

// Make a string safe as a single filename component: strip path separators,
// characters illegal on Windows/macOS, control chars, and leading/trailing dots
// or spaces. Never returns "" (so a write can't land on a directory). Used to
// neutralise citekeys/titles that come from Better BibTeX or the Extra field.
export function sanitizeFilename(name) {
  let s = String(name == null ? "" : name);
  s = s.replace(/[\\/]+/g, "-");                       // path separators -> dash
  s = s.replace(/[<>:"|?*]/g, "");                       // chars illegal on Windows/macOS
  s = s.replace(/[\x00-\x1f]/g, "");                    // control characters
  s = s.replace(/^\.+/, "").replace(/[ .]+$/g, "");      // leading dots, trailing dot/space
  s = s.trim();
  return s || "untitled";
}

// True if childPath is the same as, or nested under, parentPath. Separator- and
// case-insensitive. Used to confine writes to the configured notes folder so a
// crafted citekey/pattern can never escape it (defence-in-depth on top of
// sanitizeFilename + PathUtils.join).
export function isUnder(childPath, parentPath) {
  const p = splitPath(parentPath);
  const c = splitPath(childPath);
  if (!p.length || c.length < p.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (String(c[i]).toLowerCase() !== String(p[i]).toLowerCase()) return false;
  }
  return true;
}

// Join components with `sep`, trimming any separators already on the pieces so we
// never produce a doubled separator. (We avoid a leading-slash regex so POSIX
// absolute paths keep their leading "/".)
function joinWith(sep, ...parts) {
  const cleaned = parts
    .filter((p) => p != null && p !== "")
    .map((p, i) => {
      let s = String(p);
      if (i > 0) s = s.replace(/^[\\/]+/, "");
      return s.replace(/[\\/]+$/, "");
    });
  return cleaned.join(sep);
}
