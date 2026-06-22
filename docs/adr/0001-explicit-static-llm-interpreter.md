# Explicit Static LLM Interpreter

The LLM interpreter is BYOK and OpenAI-compatible, but model calls are not part of normal note refresh or annotation auto-sync. LLM placeholders use explicit `{% llm context="..." %}` template blocks, run only through user-triggered actions, and are replaced with static markdown so generated prose is never silently regenerated or overwritten.

This favors privacy, cost control, and deterministic Zotero-to-Obsidian syncing over automatic live AI fields. Requested context sources such as abstract, annotations, and primary-PDF full text must be explicit and must fail loudly when unavailable; the plugin does not silently fall back to weaker context or perform its own PDF extraction/OCR.
