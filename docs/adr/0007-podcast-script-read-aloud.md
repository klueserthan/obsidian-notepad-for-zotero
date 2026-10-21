# Podcast Script: a spoken explainer saved as an attachment for Read Aloud (extends ADR-0001 and ADR-0002)

**Make podcast** has the user's configured LLM write the script of a ten-minute
spoken explainer of one paper, from the text Zotero has already indexed for
its PDF. The plugin saves the script as a child attachment of the item, an
HTML page tagged `zps:podcast-script`, and opens it in Zotero's reader, where
Zotero's own **Read Aloud** (headphones button, Zotero 9 and later) reads it
out. The plugin produces no audio itself.

Four decisions follow from that:

- **An attachment, not a note.** Read Aloud runs only in the reader, and the
  reader opens attachments (PDF, EPUB, snapshot), never notes. A stored
  `text/html` file opens as a snapshot, and every reader type offers Read
  Aloud. So this is the first plugin output that is not a Summary Note, and
  ADR-0002's note model does not cover it.
- **Its own action, not a template.** The script is one piece of prose with
  its own system prompt. The ADR-0006 house style (lists and tables only) is
  the opposite of a script, and the Composer's template pipeline (render,
  resolve, strip, convert to note HTML) has nothing to add. The action is a
  Composer button beside Generate, and an item-menu entry for exactly one
  selected item.
- **Create-once, with replacement asked first.** A script is written once and
  never edited. If the item already has one, the plugin asks before the LLM
  call; Cancel stops without a request. Yes moves the old attachment to the
  trash after the new one is saved.
- **Zotero 9 or later.** Read Aloud first shipped in Zotero 9.0, so the
  plugin's minimum version rises from 7.0 to 9.0, and the maximum to 10.*.

ADR-0001 still holds: the call is explicit, BYOK, and fails loudly. Missing
or oversized full text, a reply cut off at the token limit, an empty reply,
or a failed request each shows an error and writes nothing; the full text is
never truncated. The script gets its own output limits (Podcast Max Tokens,
default 4096; Podcast Timeout, default 300 s), because the per-block defaults
are far too small for about 1,500 words. Automatic Mode (ADR-0004) does not
make podcasts.

The script is always English, aimed at a researcher outside the paper's
subfield, and strictly grounded in the paper. It is written for the ear: plain
paragraphs, no markdown, numbers and abbreviations spelled out. Markdown the
model writes anyway is stripped before the page is built, and the page sets
`lang="en"` so Read Aloud picks an English voice.

## Considered Options

- **Save the script as a note** — rejected: Read Aloud cannot read notes.
- **Generate audio with a text-to-speech API** — rejected for now: a second
  paid API, audio files in storage, and no in-reader playback. Two voices
  would need it; one narrator does not.
- **A two-host dialogue** — rejected: Read Aloud has one voice, so speaker
  labels would be read out and both hosts would sound the same.
- **Start playback automatically** — rejected: only private reader internals
  can do it, and they may change in any Zotero release.
- **A podcast template in the Composer picker** — rejected: the output is an
  attachment rather than a note, so it would need its own path out of the
  template pipeline anyway.
- **Hide the action on Zotero 7 and 8 instead of raising the minimum
  version** — rejected in favour of one supported range.
