---
name: paper-summarizer-zotero
description: What the `zps:` tags in a Zotero library mean and why they must not be deleted. Use before removing, renaming, merging or "cleaning up" any Zotero tag, and whenever you meet a tag starting with `zps:` on an item or note. The Paper Summarizer for Zotero plugin writes these tags and depends on them.
---

# Paper Summarizer tags in Zotero

The Paper Summarizer for Zotero plugin records its own state as Zotero tags, all starting with `zps:`. They are machine state, not topic labels. Treat them as read-only.

## Rules

- **Never remove or rename a `zps:` tag**, including during tag cleanup, deduplication, normalization or merging. Leave them out of any bulk tag operation.
- `zps:summary-note` and `zps:summary-note:<type>` are **not duplicates** of each other. A Summary Note carries both on purpose.
- Do not add any `zps:` tag yourself, with one exception: you may add the trigger tag (`zps:summarize` by default) to an item when the user asks you to have it summarized.

## What each tag means

| Tag | On | Meaning | If removed |
|---|---|---|---|
| `zps:summary-note` | a note | This note is a Summary Note the plugin generated. The plugin finds its notes only through this tag. | The plugin loses track of the note: Automatic Mode creates a duplicate, and the Composer's stale indicator stops working. |
| `zps:summary-note:<type>` | a note | Which note type generated it, e.g. `zps:summary-note:inferential`, `zps:summary-note:descriptive`. | Filtering Summary Notes by type misses it. |
| `zps:summarize` | an item | A pending request to generate a Summary Note. The plugin removes it itself once it has handled the item. The name can be changed in the plugin's Settings, so a library may use a different trigger tag. | The request is cancelled silently. |
| `zps:summarize-failed` | an item | Automatic generation failed for this item. | The only record of the failure is lost. |
| `zps:summarize-no-fulltext` | an item | Automatic generation gave up because Zotero had no full text for the PDF. | The only record of the failure is lost. |
| `zps:abstract-extracted` | an item | The item's Abstract field was filled in automatically from the PDF text, not by the publisher. | Nobody can tell the abstract was machine-extracted. |

The user retries a failed item by re-adding the trigger tag, and the plugin clears the failure tag itself when it picks the item up again. Leave both failure tags for the user to act on.
