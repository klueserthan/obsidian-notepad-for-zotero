// Self-contained frontmatter manifest (v2 Phase B, RFC Option B).
//
// A managed note records, inside its OWN frontmatter, which frontmatter keys are
// kept in sync with Zotero and HOW — as a reserved `zon:` map of
// `key -> single-line Nunjucks expression`. On Refresh the plugin re-renders
// each managed key's expression over the item's data and replaces that key's
// value, leaving unmanaged keys, the `zon:` map itself, and the note body
// untouched. Because the expression lives in the note, editing the template
// later never retroactively changes existing notes (RFC Goal 6 — no surprises).
//
//   ---
//   Title: "Old title"
//   Year: "1999"
//   zon:
//     Title: "\"{{title}}\""
//     Year: "\"{{date | format('YYYY')}}\""
//   ---
//
// Expressions are SINGLE-LINE Nunjucks. Whatever an expression renders becomes
// the key's value — a scalar (`"1999"`) or a YAML flow list (`["[[A]]","[[B]]"]`).
// applyManifest is value-shape-agnostic, so a multi-line block list in an
// existing note collapses to one line only if its key is actually in the
// manifest; keys left out of the manifest are never touched. This is why
// buildManifestFromScaffold only auto-manages single-line (scalar) value
// templates by default — it never silently reformats a user's block lists.
//
// All functions are pure (string in, string out) so they unit-test in Node.

import { makeEnv } from "./render.js";

export const MANIFEST_KEY = "zon";

// Reserved child keys inside the `zon:` map that configure sync behaviour rather
// than naming a frontmatter field to forward-render. They're per-note so each
// note carries its own rules, and are skipped by the forward field-sync
// (applyManifest):
//   tags        — the frontmatter field this note mirrors to Zotero tags
//                 (e.g. "Topics"); different users spell it differently.
//   attachments — the vault-relative folder this note's image annotations are
//                 exported into (e.g. "References/Attachments"); the global
//                 default seeds it, then the note owns its own.
export const SYNC_KEYS = new Set(["tags", "attachments"]);

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
const TOP_KEY_RE = /^([A-Za-z0-9_-]+):(.*)$/;
const CHILD_RE = /^(\s+)([A-Za-z0-9_-]+):\s?(.*)$/;

// ── note <-> frontmatter ────────────────────────────────────────────────────

function splitNote(md) {
  const s = String(md);
  const m = s.match(FM_RE);
  if (!m) return { frontmatter: null, body: s };
  return { frontmatter: m[1], body: s.slice(m[0].length) };
}

function assemble(frontmatter, body) {
  return `---\n${frontmatter}\n---\n${body}`;
}

// Parse frontmatter text into ordered entries. A top-level entry owns its
// `Key: ...` line plus following indented / non-key continuation lines.
function parseEntries(fm) {
  const lines = String(fm || "").split("\n");
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(TOP_KEY_RE);
    if (m && !/^\s/.test(line)) {
      if (cur) entries.push(cur);
      cur = { key: m[1], lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      entries.push({ key: null, lines: [line] }); // leading non-key line (rare)
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

// ── YAML-ish scalar quoting (we own both ends; Obsidian also parses it) ──────

// Double-quote a value-template so it round-trips through YAML on ONE line: an
// inner `"` (e.g. `"{{title}}"`) is escaped, and a newline (a multi-line field
// like an Author/Topics list) is stored as `\n`. This is a valid YAML
// double-quoted scalar, so Obsidian reads the multi-line value too.
function quoteExpr(expr) {
  return `"${String(expr).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function unquoteExpr(raw) {
  const s = String(raw).trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  const inner = s.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const c = inner[++i];
      out += c === "n" ? "\n" : c; // \\ -> \, \" -> ", \n -> newline
    } else out += inner[i];
  }
  return out;
}

// ── public API ──────────────────────────────────────────────────────────────

// Parse a note's `zon:` manifest -> { entries: [{key, expr}], present }.
export function parseManifest(md) {
  const { frontmatter } = splitNote(md);
  if (frontmatter == null) return { entries: [], present: false };
  const zon = parseEntries(frontmatter).find((e) => e.key === MANIFEST_KEY);
  if (!zon) return { entries: [], present: false };
  const entries = [];
  for (const line of zon.lines.slice(1)) {
    const m = line.match(CHILD_RE);
    if (m) entries.push({ key: m[2], expr: unquoteExpr(m[3]) });
  }
  return { entries, present: true };
}

export function hasManifest(md) {
  return parseManifest(md).present;
}

// Refresh every managed frontmatter key from its stored expression. Unmanaged
// keys, the `zon:` map, and the body are left untouched. A bad/throwing
// expression leaves its key as-is. Idempotent.
export function applyManifest(md, itemData = {}, opts = {}) {
  const { entries: man, present } = parseManifest(md);
  if (!present || man.length === 0) return String(md);
  const env = opts.env || makeEnv();
  const { frontmatter, body } = splitNote(md);
  // Sync-config keys (e.g. `tags`) aren't field expressions — never apply them.
  const manMap = new Map(man.filter((e) => !SYNC_KEYS.has(e.key)).map((e) => [e.key, e.expr]));

  const out = parseEntries(frontmatter).map((e) => {
    if (!e.key || e.key === MANIFEST_KEY || !manMap.has(e.key)) return e;
    const expr = manMap.get(e.key);
    // A multi-line value template starts with a newline (e.g. an Author/Topics
    // list `Author:\n{% for … %}`); a scalar gets the usual `Key: ` space.
    const sep = expr.startsWith("\n") ? "" : " ";
    let rendered;
    try {
      rendered = env.renderString(`${e.key}:${sep}${expr}`, itemData).replace(/\s+$/, "");
    } catch (err) {
      return e; // leave the key untouched on a bad expression
    }
    return { key: e.key, lines: rendered.split("\n") };
  });

  return assemble(out.map((e) => e.lines.join("\n")).join("\n"), body);
}

// Add or replace a managed key's expression in the `zon:` map, creating the map
// if absent. Returns the updated note. (For the insert / "manage this field" UX.)
export function setManifestEntry(md, key, expr) {
  const { frontmatter, body } = splitNote(md);
  if (frontmatter == null) {
    // No frontmatter at all — start one carrying just the manifest.
    return assemble(`${MANIFEST_KEY}:\n  ${key}: ${quoteExpr(expr)}`, String(md));
  }
  const entries = parseEntries(frontmatter);
  let zon = entries.find((e) => e.key === MANIFEST_KEY);
  if (!zon) {
    zon = { key: MANIFEST_KEY, lines: [`${MANIFEST_KEY}:`] };
    entries.push(zon);
  }
  const childIdx = zon.lines.findIndex((l) => {
    const m = l.match(CHILD_RE);
    return m && m[2] === key;
  });
  const childLine = `  ${key}: ${quoteExpr(expr)}`;
  if (childIdx >= 0) zon.lines[childIdx] = childLine;
  else zon.lines.push(childLine);
  return assemble(entries.map((e) => e.lines.join("\n")).join("\n"), body);
}

// Remove a key from the manifest (so it stops syncing). Drops the whole `zon:`
// map if it becomes empty. The key's current value in the frontmatter is left
// as-is (now an ordinary, unmanaged field). Returns the updated note.
export function removeManifestEntry(md, key) {
  const { frontmatter, body } = splitNote(md);
  if (frontmatter == null) return String(md);
  const entries = parseEntries(frontmatter);
  const zon = entries.find((e) => e.key === MANIFEST_KEY);
  if (!zon) return String(md);
  zon.lines = zon.lines.filter((l) => {
    const m = l.match(CHILD_RE);
    return !(m && m[2] === key);
  });
  const remaining = zon.lines.slice(1).some((l) => CHILD_RE.test(l));
  const kept = remaining ? entries : entries.filter((e) => e !== zon);
  return assemble(kept.map((e) => e.lines.join("\n")).join("\n"), body);
}

// Build a manifest from a note.md scaffold's frontmatter — fully template-driven:
// EVERY field whose value contains a Nunjucks expression (`{{ … }}` or `{% … %}`)
// becomes a managed entry, single-line OR multi-line (an Author/Topics list is
// managed with the template's own formatting). Fields with a purely static value
// or an empty value (e.g. a blank `KeyIdea:`) carry no expression, so they are
// left user-owned. No field NAMES are hard-coded — the user's template decides
// what syncs and how (they may call Title something else, format journal links
// their own way, etc.). The stored value is everything after `Key:` (the leading
// `Key: ` space is dropped for scalars and re-added by applyManifest).
// `reserved` keys are skipped (only the manifest key itself, by default).
export function buildManifestFromScaffold(scaffoldMd, opts = {}) {
  const reserved = new Set([...(opts.reserved || [MANIFEST_KEY]), ...SYNC_KEYS]);
  const { frontmatter } = splitNote(scaffoldMd);
  if (frontmatter == null) return {};
  const map = {};
  for (const e of parseEntries(frontmatter)) {
    if (!e.key || reserved.has(e.key)) continue;
    const full = e.lines.join("\n");
    if (!/\{\{|\{%/.test(full)) continue; // no expression -> static/empty -> user-owned
    let value = full.slice(full.indexOf(":") + 1);
    if (value.startsWith(" ")) value = value.slice(1); // drop the scalar `Key: ` space
    map[e.key] = value;
  }
  return map;
}

// Embed a manifest map into a note's frontmatter as the `zon:` block. Existing
// entries are merged (the map wins). Convenience over repeated setManifestEntry.
export function writeManifest(md, map) {
  let out = String(md);
  for (const [key, expr] of Object.entries(map || {})) {
    out = setManifestEntry(out, key, expr);
  }
  return out;
}

// ── reverse-sync field map (per-note) ────────────────────────────────────────

// The frontmatter field this note mirrors to Zotero tags (e.g. "Topics"), read
// from the reserved `zon: tags:` entry. Null if the note hasn't declared one.
export function getTagField(md) {
  const e = parseManifest(md).entries.find((x) => x.key === "tags");
  const v = e ? String(e.expr).trim() : "";
  return v || null;
}

// Record (per-note) which frontmatter field mirrors Zotero tags, in `zon: tags:`.
export function setTagField(md, field) {
  return setManifestEntry(md, "tags", String(field));
}

// Per-note vault-relative folder for exported image annotations (`zon: attachments:`).
// Returns null when unset so the caller can fall back to the global default.
export function getAttachmentFolder(md) {
  const e = parseManifest(md).entries.find((x) => x.key === "attachments");
  const v = e ? String(e.expr).trim() : "";
  return v || null;
}

// Record (per-note) the image-annotation export folder, in `zon: attachments:`.
export function setAttachmentFolder(md, folder) {
  return setManifestEntry(md, "attachments", String(folder));
}
