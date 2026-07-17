// Pure, cross-platform filename helper. NO filesystem access here: callers pass
// strings in, so it stays unit-testable for Windows and POSIX alike. (The old
// Obsidian vault-detection / deep-link / notes-folder path helpers were removed
// with the file-write pipeline — ADR-0002; Summary Notes are native Zotero child
// notes now, so there is no vault to locate or confine writes to.)

// Make a string safe as a single filename component: strip path separators,
// characters illegal on Windows/macOS, control chars, and leading/trailing dots
// or spaces. Never returns "" (so a name can't collapse to nothing). Used to
// neutralise citekeys/keys that come from Better BibTeX or the Extra field when
// naming image-annotation embeds.
export function sanitizeFilename(name) {
  let s = String(name == null ? "" : name);
  s = s.replace(/[\\/]+/g, "-");                       // path separators -> dash
  s = s.replace(/[<>:"|?*]/g, "");                       // chars illegal on Windows/macOS
  s = s.replace(/[\x00-\x1f]/g, "");                    // control characters
  s = s.replace(/^\.+/, "").replace(/[ .]+$/g, "");      // leading dots, trailing dot/space
  s = s.trim();
  return s || "untitled";
}
