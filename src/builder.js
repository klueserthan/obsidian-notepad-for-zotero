// Note-type editor core (pure, Node + Vitest).
//
// Backs the Template Builder overlay, now a note-type editor: the Insert menu's
// snippets, the New scaffold, and the live preview. The preview reuses the SAME
// engine the Generate path uses, then the SAME strip step the Composer applies
// (stripFrontmatter + stripMarkers), so it shows the marker-free, frontmatter-free
// body a Summary Note would carry.

import { syncBlocks } from "./blocks.js";
import { render } from "./render.js";
import { DEFAULT_FORMATS, FIELD_FORMATS } from "./formats.js";
import { stripMarkers, stripFrontmatter } from "./strip-markers.js";

// ------------------------------------------- note-type editor: Insert menu (R12)
//
// The note-type editor's Insert menu pastes one of these snippets at the cursor
// (via the editor's own insertAtCursor) — no configurator, no palette. Order
// matches the menu.
export const INSERT_SNIPPETS = [
  { id: "llm", label: "LLM prompt", text: '{% llm context="fulltext" %}\nWrite the prompt here.\n{% endllm %}' },
  { id: "annotations", label: "Annotations", text: "%% zon kind=annotations colour=all sync=on format=quote %%\n%% /zon %%" },
  { id: "citation", label: "Citation", text: "%% zon kind=field format=citation sync=on %%\n%% /zon %%" },
  { id: "abstract", label: "Abstract", text: "%% zon kind=field format=abstract sync=on %%\n%% /zon %%" },
];

// New (R13): a minimal scaffold with no frontmatter — the paper type lives in
// the editor's own name/label/description fields (KTD7), not in the body.
export const NEW_NOTE_TYPE_SCAFFOLD = `## Notes

## Highlights

%% zon kind=annotations colour=all sync=on format=quote %%
%% /zon %%
`;

// ---------------------------------------------------------------- preview

// Strip a rendered note down to the marker-free, frontmatter-free body the
// Composer's live preview shows — reusing the EXACT strip functions the Generate/
// Composer pipeline uses (stripFrontmatter + stripMarkers). Any leftover
// `{% llm %}` tags survive as literal text — they are never executed in a preview.
export function stripForPreview(markdown) {
  const stripped = stripMarkers(stripFrontmatter(String(markdown == null ? "" : markdown)));
  return stripped
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

// Render a note type's markdown the way the Generate path renders a whole-note
// template, for the editor's live preview. Always whole-note: the editor authors
// only note types (R2), and its buffer has the declaration frontmatter split off,
// so sniffing the template kind would misread a plain body as a per-highlight
// format. ctx = { itemData, annotations, citekey, formats, attachmentFolder }.
// Returns { raw, preview } where `raw` is the faithful engine output (markers +
// frontmatter intact) and `preview` the Composer-consistent stripped view. Never
// throws — a template error comes back with error: true and the message as text.
export function previewTemplate(templateText, ctx = {}) {
  const itemData = ctx.itemData || {};
  let raw;
  try {
    raw = syncBlocks(render(String(templateText || ""), itemData), ctx.annotations || [], {
      citekey: ctx.citekey || itemData.citekey || "",
      formats: { ...DEFAULT_FORMATS, ...FIELD_FORMATS, ...(ctx.formats || {}) },
      itemData,
      attachmentFolder: ctx.attachmentFolder || "References/Attachments",
    });
  } catch (e) {
    raw = `⚠️ Template error:\n${e && e.message ? e.message : String(e)}`;
    return { raw, preview: raw, error: true };
  }
  return { raw, preview: stripForPreview(raw) };
}

// ---------------------------------------------------------------- sample data

// De-personalised fallback for the preview when no item is selected. Shape mirrors
// buildItemData's output + gatherAnnotations' annotation objects.
export const SAMPLE_ITEM = {
  citekey: "doe2023example",
  title: "A Worked Example of Coproduction in Practice",
  date: "2023-05-01",
  dateAdded: "2023-06-12",
  dateModified: "2024-01-08",
  itemType: "journalArticle",
  publicationTitle: "Journal of Sample Studies",
  abstractNote: "A short sample abstract used to preview templates.",
  bibliography: "Doe J and Smith A (2023) A Worked Example of Coproduction in Practice. Journal of Sample Studies.",
  desktopURI: "zotero://select/library/items/SAMPLE01",
  openPdf: "zotero://open-pdf/library/items/SAMPLEPDF",
  pdfZoteroLink: "zotero://open-pdf/library/items/SAMPLEPDF",
  allTags: "coproduction, methods, sample",
  tags: [{ tag: "coproduction" }, { tag: "methods" }, { tag: "sample" }],
  creators: [{ firstName: "Jane", lastName: "Doe" }, { firstName: "Alex", lastName: "Smith" }],
  authors: "Jane Doe, Alex Smith",
  relations: [
    { citekey: "smith2019related", title: "A Closely Related Study", key: "REL00001" },
    { citekey: "jones2021followup", title: "A Follow-up Paper", key: "REL00002" },
  ],
  annotations: [],
};

export const SAMPLE_ANNOTATIONS = [
  {
    key: "SAMP0001", type: "highlight", attachmentKey: "SAMPLEPDF",
    pageLabel: "3", pageIndex: 2, sortIndex: "1",
    annotatedText: "Coproduction reshapes the clinician–patient relationship.",
    comment: "core claim", colourName: "yellow", tags: ["finding", "method"],
  },
  {
    key: "SAMP0002", type: "highlight", attachmentKey: "SAMPLEPDF",
    pageLabel: "5", pageIndex: 4, sortIndex: "2",
    annotatedText: "a clean, quotable sentence worth keeping verbatim",
    comment: "", colourName: "blue", tags: ["quote"],
  },
  {
    key: "SAMP0003", type: "highlight", attachmentKey: "SAMPLEPDF",
    pageLabel: "8", pageIndex: 7, sortIndex: "3",
    annotatedText: "a second yellow point for testing colour routing",
    comment: "compare with ch.2", colourName: "yellow", tags: [],
  },
];
