// Template-file parsing.
//
// A template file is one insertable block template (or the whole-note scaffold).
// It is *pure Nunjucks* with one optional first line — a "directive" — that pins
// this template's defaults:
//
//   %%! colour=yellow sync=on sep=blank %%
//   > {{text}}
//   > — [p.{{page}}]({{link}})
//
// The `%%! … %%` line (note the `!`, to distinguish it from a `%% zon %%` block
// marker) is parsed and stripped; the rest is the per-annotation body. Recognised
// directive keys: colour/color, sync (on|off), type, sep (blank|newline).
//
// NOTE: bootstrap.js mirrors this logic in ZON.parseTemplateText() because it
// runs in the privileged scope before the core bundle is guaranteed loaded. Keep
// the two in sync; this copy is the Node-tested source of truth.
import { parseConfig } from "./blocks.js";
import { hasLLMBlocks } from "./llm-blocks.js";

const DIRECTIVE_RE = /^\s*%%!\s*([^%]*?)\s*%%\s*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Shared frontmatter grammar: a leading `---\n…\n---` fence that opens the
// file. Returns the captured YAML body, or null when there's no such block.
function frontmatterBody(text) {
  const m = String(text || "").match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

export function parseTemplateFile(text) {
  const raw = String(text).replace(/\s+$/, "");
  const lines = raw.split("\n");
  let defaults = {};
  let sepMode = null;

  if (lines.length && DIRECTIVE_RE.test(lines[0])) {
    const cfg = parseConfig(lines[0].match(DIRECTIVE_RE)[1]);
    if (cfg.sep) { sepMode = cfg.sep; delete cfg.sep; }
    if (cfg.color && !cfg.colour) { cfg.colour = cfg.color; }
    delete cfg.color;
    defaults = cfg;
    lines.shift();
  }

  const body = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  let sep;
  if (sepMode === "blank") sep = "\n\n";
  else if (sepMode === "newline") sep = "\n";
  else sep = body.includes("\n") ? "\n\n" : "\n";

  return { item: body, sep, defaults };
}

// Classify a template for the unified "Insert / Create from anything" model:
//   - "document": a whole-note template — it has YAML frontmatter and/or contains
//     a `%% zon %%` annotations block. Rendered ONCE with the item's data.
//   - "format": a per-annotation body (no frontmatter, no zon block). Rendered
//     once PER highlight; Insert wraps it in a zon block automatically.
export function templateKind(text) {
  const t = String(text || "");
  // A leading `%%! ... %%` directive marks a template as a block explicitly,
  // overriding content sniffing — lets a template that would otherwise sniff as
  // "document" (e.g. it contains an {% llm %} block) declare itself a reusable
  // building block instead (see the research-questions builtin).
  if (DIRECTIVE_RE.test(t.split("\n")[0])) return "format";
  if (FRONTMATTER_RE.test(t)) return "document";
  if (/%%\s*zon\b/.test(t)) return "document";
  if (hasLLMBlocks(t)) return "document";   // NEW — templates with LLM blocks are once-per-item
  // A whole-note template built from colour-routed highlights() calls (e.g. the
  // frontmatter-free note-by-colour builtin) is rendered once per item too.
  if (/\{\{\s*highlights\s*\(/.test(t)) return "document";
  return "format";
}

// Read one scalar field from a template's leading YAML frontmatter block.
// Reuses the same anchored-at-start frontmatter grammar as templateUserOwnedKeys
// below (and src/strip-markers.js's stripFrontmatter) — a key only counts when
// it's a top-level (non-indented) line inside the `---\n…\n---` fence that opens
// the file; a same-named key in the body, after the closing fence, is ignored.
// Returns the trimmed value with surrounding matching quotes stripped, or null
// when there's no leading frontmatter block or the key isn't in it.
export function frontmatterFieldValue(text, key) {
  const body = frontmatterBody(text);
  if (body === null) return null;
  for (const line of body.split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (km && km[1] === key) {
      return km[2].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
    }
  }
  return null;
}

// A template's declared paper type (KTD4): the label it fits and an optional
// one-line description an LLM can use to pick among candidates (src/paper-type.js,
// a later unit). Label is required — an empty/absent `paperType` means the
// template makes no declaration at all, not a declaration with a blank label.
export function paperTypeDeclaration(text) {
  const label = frontmatterFieldValue(text, "paperType");
  if (!label) return null;
  return { label, description: frontmatterFieldValue(text, "paperTypeDescription") };
}

// Detection candidates (R3, KTD13): only "document"-kind templates that declare
// a paper type take part, in input order, EXCLUDING any label declared by more
// than one note type (see duplicateLabels below) — R4 requires one note type per
// label, so an undecided clash is excluded rather than guessed at. `templates`
// is a list of { name, text }.
export function paperTypeCandidates(templates) {
  const dups = duplicateLabels(templates);
  const out = [];
  for (const t of templates || []) {
    if (templateKind(t.text) !== "document") continue;
    const decl = paperTypeDeclaration(t.text);
    if (!decl || dups.has(decl.label.trim().toLowerCase())) continue;
    out.push({ name: t.name, label: decl.label, description: decl.description });
  }
  return out;
}

// Labels declared by more than one document-kind template (KTD13): a Map from
// the normalised (trimmed, lower-cased) label to every template name sharing it.
// Used by paperTypeCandidates to exclude an undecided clash, and by the editor
// (a later unit) to flag every note type in the group so the researcher can fix
// it. Only labels with 2+ declarations appear.
export function duplicateLabels(templates) {
  const byLabel = new Map();
  for (const t of templates || []) {
    if (templateKind(t.text) !== "document") continue;
    const decl = paperTypeDeclaration(t.text);
    if (!decl) continue;
    const key = decl.label.trim().toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(t.name);
  }
  const out = new Map();
  for (const [key, names] of byLabel) if (names.length > 1) out.set(key, names);
  return out;
}

// One note type's paper-type label conflicting with another's (KTD9, KTD13):
// trims and lower-cases both sides so "Qualitative " collides with "qualitative",
// and excludes `currentName` so re-saving your own label doesn't refuse itself.
// Returns the clashing template's name, or null. `templates` is { name, text }.
export function findLabelClash(label, templates, currentName) {
  const norm = String(label == null ? "" : label).trim().toLowerCase();
  if (!norm) return null;
  for (const t of templates || []) {
    if (t.name === currentName) continue;
    const decl = paperTypeDeclaration(t.text);
    if (decl && decl.label.trim().toLowerCase() === norm) return t.name;
  }
  return null;
}

// Note-type file names reserved for the Templates folder's own machinery
// (KTD9): never offered as a name, case-insensitively.
const RESERVED_NAMES = ["templates", "readme", "archive"];

// Validate a note-type name (KTD9) for New/Duplicate/Rename: non-empty after
// trimming and stripping path separators (so a name can't escape the Templates
// folder), not reserved, and unique among `existingNames` ignoring case.
// Returns { valid: true, name: sanitised } or { valid: false, reason }.
export function validateTemplateName(name, existingNames) {
  const sanitised = String(name == null ? "" : name).trim().replace(/[\\/]/g, "");
  if (!sanitised) return { valid: false, reason: "Name is required." };
  const lower = sanitised.toLowerCase();
  if (RESERVED_NAMES.includes(lower)) return { valid: false, reason: `"${sanitised}" is a reserved name.` };
  const clash = (existingNames || []).find((n) => String(n).toLowerCase() === lower);
  if (clash) return { valid: false, reason: `A note type named "${clash}" already exists.` };
  return { valid: true, name: sanitised };
}

// Split a template's paper-type declaration out of its frontmatter (KTD7), for
// the editor's dedicated name/label/description fields. `body` keeps every
// other frontmatter key untouched with paperType/paperTypeDescription removed;
// an undeclared template (or one with no frontmatter at all) returns empty
// label/description and the text unchanged.
export function splitDeclaration(text) {
  const t = String(text == null ? "" : text);
  const decl = paperTypeDeclaration(t);
  if (!decl) return { label: "", description: "", body: t };
  return { label: decl.label, description: decl.description || "", body: removeFrontmatterKeys(t, ["paperType", "paperTypeDescription"]) };
}

// Compose a declaration back onto a body (KTD7): adds/updates the paperType and
// paperTypeDescription frontmatter keys, appended after any other frontmatter
// keys (or opening a fresh frontmatter block when `body` has none), so Save
// recomposes exactly what an equivalent splitDeclaration would read back.
// Refused (returns null) when the label is empty or the description contains a
// newline — the declaration is a one-line label/description pair.
export function composeDeclaration(body, label, description) {
  const lbl = String(label == null ? "" : label).trim();
  const desc = String(description == null ? "" : description).trim();
  if (!lbl || /[\r\n]/.test(desc)) return null;
  const declLines = ["paperType: " + lbl].concat(desc ? ["paperTypeDescription: " + desc] : []);
  const t = String(body == null ? "" : body);
  const m = t.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/);
  if (!m) return "---\n" + declLines.join("\n") + "\n---\n\n" + t.replace(/^\n+/, "");
  const [, fence1, inner, fence2, rest] = m;
  const trimmedInner = inner.replace(/\s+$/, "");
  const newInner = trimmedInner ? trimmedInner + "\n" + declLines.join("\n") : declLines.join("\n");
  return fence1 + newInner + fence2 + rest;
}

// Remove the given top-level frontmatter keys (and their continuation/loop
// lines) from a template's leading `--- … ---` block; drops the block entirely
// if nothing else is left inside it. Local to splitDeclaration — same grammar
// as frontmatterBody, mirrors src/builder.js's removeFrontmatterField.
function removeFrontmatterKeys(text, keys) {
  const t = String(text);
  const m = t.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/);
  if (!m) return t;
  const [, fence1, inner, fence2, rest] = m;
  const out = [];
  let skipping = false;
  for (const line of inner.split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z0-9_-]+):/);
    if (km) { skipping = keys.includes(km[1]); if (skipping) continue; }
    else if (skipping) continue;
    out.push(line);
  }
  const newInner = out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  if (!newInner) return rest.replace(/^\r?\n/, "");
  return fence1 + newInner + fence2 + rest;
}

// Selective-refresh rule: a frontmatter field AUTO-UPDATES from Zotero if the
// template fills it with an expression (`{{ }}` or `{% %}`); a field written
// plainly (e.g. `KeyIdea:`) is the USER's and must be preserved on refresh.
// Returns the user-owned key names found in the template's frontmatter.
export function templateUserOwnedKeys(text) {
  const body = frontmatterBody(text);
  if (body === null) return [];
  const lines = body.split(/\r?\n/);
  const keys = [];
  let cur = null;
  let hasExpr = false;
  const flush = () => { if (cur && !hasExpr) keys.push(cur); };
  const isExpr = (s) => /\{\{|\{%/.test(s);
  for (const line of lines) {
    const km = line.match(/^([A-Za-z0-9_-]+):/);
    if (km && !/^\s/.test(line)) {
      flush();
      cur = km[1];
      hasExpr = isExpr(line);
    } else if (cur && isExpr(line)) {
      hasExpr = true;
    }
  }
  flush();
  return keys;
}
