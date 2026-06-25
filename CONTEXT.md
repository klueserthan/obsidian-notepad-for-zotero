# Obsidian Notepad for Zotero

This context covers the bridge between Zotero item data and Obsidian literature notes, including template-driven note generation and user-triggered LLM assistance.

## Language

**LLM interpreter**:
A BYOK, OpenAI-compatible template feature that replaces explicit `{% llm %}` placeholders with model-generated markdown using requested Zotero context.
_Avoid_: AI magic, auto-summary, implicit generation

**LLM context**:
The Zotero-derived input source explicitly requested by an LLM placeholder, such as abstract, annotations, or primary-PDF full text.
_Avoid_: prompt data, hidden context

**Unresolved LLM block**:
A preserved `{% llm %}` placeholder in a note that has not yet been replaced by generated markdown.
_Avoid_: failed generation, live block

## Relationships

- An **LLM interpreter** replaces one or more **Unresolved LLM blocks** only during explicit user-triggered actions.
- An **Unresolved LLM block** names one or more **LLM contexts**.
- **LLM context** is never silently substituted: if a requested source is missing, generation fails.

## Example Dialogue

> **Dev:** "Should this research-questions prompt run every time the note refreshes?"
> **Domain expert:** "No. It is an **LLM interpreter** block, so it only runs when I explicitly run LLM generation or enable run-on-create/insert. Normal refresh must not regenerate it."

## Flagged Ambiguities

- "interpreter" means explicit LLM template interpretation, not automatic background summarization.
- "full text" means Zotero-available text for the primary PDF, not custom plugin OCR or fallback annotations.
