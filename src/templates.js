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

// Detection candidates (R3): only "document"-kind templates that declare a
// paper type take part, in input order. `templates` is a list of { name, text }.
export function paperTypeCandidates(templates) {
  const out = [];
  for (const t of templates || []) {
    if (templateKind(t.text) !== "document") continue;
    const decl = paperTypeDeclaration(t.text);
    if (decl) out.push({ name: t.name, label: decl.label, description: decl.description });
  }
  return out;
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
