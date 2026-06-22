// Pre-designed per-annotation formats that ship with the plugin. A block picks
// one via `format=<name>`. Each is a Nunjucks template rendering ONE annotation
// plus a separator used to join them. Fully customisable: users can override
// these or add their own (later, by pointing at a folder of templates).
//
// Available variables per annotation: text, comment, page (= pageLabel),
// pageIndex, key, colour, type, link (zotero://open-pdf deep link), citekey,
// imageBaseName, attachmentFolder.
//
// Image (area) annotations have no `text`; they carry an `imageBaseName` pointing
// at the PNG the plugin exported to `<attachmentFolder>/<citekey>/`. Each format
// emits an Obsidian embed `![[…]]` in that case, and the plain text version
// otherwise — so for text highlights the output is byte-identical to before.
export const DEFAULT_FORMATS = {
  list: {
    item: `- [p.{{page}}]({{link}}) {% if imageBaseName %}![[{{attachmentFolder}}/{{citekey}}/{{imageBaseName}}]]{% else %}"{{text}}"{% endif %}{% if comment %} — *{{comment}}*{% endif %}`,
    sep: "\n",
  },
  quote: {
    item: `> {% if imageBaseName %}![[{{attachmentFolder}}/{{citekey}}/{{imageBaseName}}]]{% else %}{{text}}{% endif %}\n> — [p.{{page}}]({{link}}){% if comment %}\n>\n> {{comment}}{% endif %}`,
    sep: "\n\n",
  },
  callout: {
    item: `> [!quote] p.{{page}}\n> {% if imageBaseName %}![[{{attachmentFolder}}/{{citekey}}/{{imageBaseName}}]]{% else %}{{text}}{% endif %}{% if comment %}\n>\n> {{comment}}{% endif %}`,
    sep: "\n\n",
  },
  compact: {
    item: `- {% if imageBaseName %}![[{{attachmentFolder}}/{{citekey}}/{{imageBaseName}}]]{% else %}"{{text}}"{% endif %} (p.{{page}}){% if comment %} — {{comment}}{% endif %}`,
    sep: "\n",
  },
};

export const DEFAULT_FORMAT_NAME = "list";
