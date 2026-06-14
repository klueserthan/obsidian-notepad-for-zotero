// Pure marker-range finder for the Zotero-editor presentation layer (v2 Phase D).
//
// The Zotero CodeMirror editor shows raw note source, so the presentation layer
// hides/chips the invisible provenance markers to mimic Obsidian reading mode —
// WITHOUT changing the file. Computing *where* the markers are is pure string
// work with no CodeMirror dependency, so it lives here and unit-tests in Node;
// editor/editor.js turns these ranges into Decorations (hide / chip /
// reveal-on-cursor / atomic).
//
// Returns character offsets into the text, sorted by `from`. Range types:
//   - "block-open"  — a `%% zon … %%` line  (line:true, carries parsed `config`)
//   - "block-close" — a `%% /zon %%` line   (line:true)
//   - "ann-anchor"  — an inline `%% ann:KEY %%` (carries `key`); includes one
//                     leading space so a trailing anchor hides cleanly
//   - "frontmatter-manifest" — the reserved `zon:` block inside the YAML
//                     frontmatter (line:true), so the manifest can be hidden too
//
// `text.slice(from, to)` is exactly the marker (for ann-anchor, with its leading
// space). The "Show markers" toggle simply stops applying these.

// Inlined (not imported from blocks.js) so this module stays dependency-free and
// can be bundled into the editor without pulling in nunjucks via blocks.js.
function parseConfig(str) {
  const cfg = {};
  for (const tok of String(str).trim().split(/\s+/)) {
    if (!tok) continue;
    const i = tok.indexOf("=");
    if (i > 0) cfg[tok.slice(0, i)] = tok.slice(i + 1);
    else cfg[tok] = true;
  }
  return cfg;
}

const OPEN_RE = /^([ \t]*)(%%[ \t]*zon[ \t]+([^%]*?)[ \t]*%%)[ \t]*$/;
const CLOSE_RE = /^([ \t]*)(%%[ \t]*\/zon[ \t]*%%)[ \t]*$/;
const ANN_RE = /([ \t]?)(%%[ \t]*ann:([A-Za-z0-9]+)[ \t]*%%)/g;

export function findMarkerRanges(text) {
  const s = String(text);
  const out = [];

  // 1. Frontmatter `zon:` manifest block (only inside a leading --- … --- fence).
  const fm = s.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const fmBodyStart = 4; // after the opening "---\n"
    const lines = fm[1].split("\n");
    let off = fmBodyStart;
    for (let i = 0; i < lines.length; i++) {
      if (/^zon:/.test(lines[i])) {
        let to = off + lines[i].length;
        let coff = to + 1;
        for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) {
          to = coff + lines[j].length;
          coff += lines[j].length + 1;
        }
        out.push({ from: off, to, type: "frontmatter-manifest", line: true });
        break;
      }
      off += lines[i].length + 1;
    }
  }

  // 2. Body scan: block open/close lines + inline annotation anchors.
  let offset = 0;
  for (const line of s.split("\n")) {
    let m;
    if ((m = line.match(OPEN_RE))) {
      const from = offset + m[1].length;
      out.push({ from, to: from + m[2].length, type: "block-open", line: true, config: parseConfig(m[3]) });
    } else if ((m = line.match(CLOSE_RE))) {
      const from = offset + m[1].length;
      out.push({ from, to: from + m[2].length, type: "block-close", line: true });
    } else {
      ANN_RE.lastIndex = 0;
      let a;
      while ((a = ANN_RE.exec(line))) {
        const from = offset + a.index; // a[1] is the (optional) leading space
        out.push({ from, to: offset + a.index + a[0].length, type: "ann-anchor", key: a[3] });
      }
    }
    offset += line.length + 1;
  }

  out.sort((x, y) => x.from - y.from || x.to - y.to);
  return out;
}

// Convenience for the reveal-on-cursor behaviour: is the cursor (or any part of
// a selection [selFrom, selTo]) touching this range? Such ranges are shown raw
// for editing rather than hidden. Pure so it tests in Node.
export function rangeRevealed(range, selFrom, selTo = selFrom) {
  return selTo >= range.from && selFrom <= range.to;
}
