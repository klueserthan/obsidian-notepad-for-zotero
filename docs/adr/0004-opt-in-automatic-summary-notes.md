# Opt-in automatic Summary Notes for tagged items (amends ADR-0001)

Automatic Mode is the one exception to ADR-0001's rule that model calls run
only through user-triggered actions: while desktop Zotero is open and the
mode is switched on in Settings (off by default), a periodic sweep finds
personal-library items carrying a trigger tag (default `zps:summarize`) and
runs them through the same render → resolve → create pipeline as Generate,
with no click. Everything else ADR-0001 states about LLM calls — BYOK,
`{% llm %}` blocks, fail loudly, no own PDF extraction — still holds; only
the "user-triggered" clause gets an opt-in exception, and only for this
sweep.

A repeating `nsITimer`, not a `Zotero.Notifier` observer, drives the sweep,
because a Notifier reacts once to a write as it happens and can't express
either the bounded full-text wait (an item with no PDF yet must keep
waiting, not fail on the spot) or catch-up for items tagged while Zotero was
closed. Polling every few minutes covers both with one mechanism, and it's
the same pattern Zotero's own auto-sync runner already uses.

The Zotero tag on the item is the only outcome channel, because it's the
only signal visible on the iPad, where the plugin doesn't run. Success
removes the trigger tag; failure replaces it with one of two failure tags —
one for "no full text after the configured wait," a different one for
everything else — so the researcher can tell them apart and retry by
re-adding the trigger tag. A provider-level failure (a network error, a
timeout, or an HTTP status that points at the endpoint rather than the
request) also pauses the whole sweep for an hour, so a revoked key or an
outage tags roughly one item and then stops instead of tagging the entire
backlog. Failure reasons go to the Error Console as a reason code and HTTP
status only, never the provider's response body or the item's full text,
since a provider error can echo back what was sent.

## Considered Options

- **Queue tagged items for one-click approval** — rejected: the researcher
  is typically away from the desktop when an agent adds a paper, so a queue
  nobody opens defeats the point of automatic summarization.
- **A `Zotero.Notifier` observer instead of a sweep** — rejected: the
  full-text wait and closed-Zotero catch-up both need something that
  re-checks an item later, which a one-shot reaction to a tag-add can't do
  without its own polling underneath anyway.
- **Keep the trigger tag and add a separate status tag** — rejected: two
  tags to reconcile, against one tag whose presence and value already say
  everything the iPad needs to know.
- **Overwrite or add to an existing Summary Note automatically** — rejected:
  ADR-0002's create-once rule stays; an item that already has a Summary Note
  is skipped, not touched.

## Consequences

- ADR-0001's "user-triggered actions" clause now has one opt-in exception,
  gated behind a Settings toggle that defaults off.
- The plugin writes tags on parent items outside of any user action; those
  edits sync like any other tag change. ADR-0002 is unaffected — notes
  themselves stay create-once.
- Anyone with write access to the personal library can trigger a paid LLM
  run by adding the trigger tag, in any number; this is documented (README)
  rather than capped.
- `test/integration/startup.spec.js`'s assertion that no Notifier observer
  is registered stays true — the sweep uses a different mechanism entirely.
