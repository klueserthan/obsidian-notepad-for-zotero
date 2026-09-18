# Extract missing abstracts from the PDF text (extends ADR-0001 and ADR-0004)

Paper-type detection reads only an item's abstract, so an item without one
never gets a real note type. The plugin may therefore fill an empty Abstract
field from the PDF: it sends the start of the text Zotero has already indexed
to the user's configured LLM, asks for the paper's own abstract word for
word, and writes it only if that text actually appears in the paper. Every
abstract written this way gets the tag `zps:abstract-extracted`.

This is the first time an LLM step writes regular-item metadata rather than
a note or a tag. Three rules keep it safe:

- **Verbatim only.** The model's answer is checked against the indexed text
  (ignoring whitespace, line-break hyphenation, and ligatures). A paraphrase,
  a truncated answer, an answer under 20 words, or "no abstract" writes
  nothing. The plugin never writes a generated summary into the field.
- **Never overwrite.** A non-empty abstract is never sent for extraction and
  never replaced, and the field is re-checked right before the write.
- **Zotero's index only.** ADR-0001's "no own PDF extraction or OCR" still
  holds: an item whose PDF isn't indexed reports "no full text".

Extraction runs from three places: the "Extract abstracts" item-menu action,
the bulk dialog's "Detect types" (for rows without an abstract, before
detection), and ADR-0004's Automatic Mode (before detection). The first two
are user-triggered, as ADR-0001 requires; the third falls under ADR-0004's
exception. In the sweep, an extraction provider failure follows ADR-0004's
provider-failure path, and "no abstract found" falls back to the default
note type as a missing abstract always has.

Detection results themselves are still never stored on the item; only the
extracted abstract is.

## Considered Options

- **Use the full text for detection only, without writing the abstract** —
  rejected: a filled Abstract field syncs and helps the iPad, citations, and
  other tools too.
- **Write a generated abstract when the paper has none** — rejected: model
  text in the Abstract field would pass as publisher metadata.
- **Find the abstract by its heading, without an LLM** — rejected: misses
  many layouts (no heading, two columns, abstracts across a page break).
- **Have the LLM return start and end words and cut the span from the
  source** — rejected: breaks on hyphenation and ligature differences in the
  indexed text.
- **Mark extracted abstracts with a line in the Extra field** — rejected: a
  tag is visible on every device, filterable, and removable, and keeps the
  abstract clean.
