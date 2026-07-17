# One final upstream merge, then a permanent hard fork

Before cutting the Obsidian ties (ADR-0002), upstream/main (Acatechnic) is merged into
this fork one last time — primarily to acquire the Template Builder and its live
preview — verified working as-is, and only then is the file/sync machinery stripped.
After that teardown, upstream commits necessarily touch deleted or rewired code, so
merging is over for good: future upstream features are ported by hand or not at all.
Cherry-picking only the Builder commits was rejected because they interleave with
releases and sync fixes; merge-then-strip is less work and keeps full history.

The fork also takes its own identity so upstream releases can never clobber a local
install (the inherited `addonID` plus an `updateURL` resolving to upstream's repo
meant Zotero would have auto-updated this plugin back into the Obsidian version):
new addonName, addonID, homepage/repository, and updateURL. Internal identifiers
(`ZON`/`ZONCore` globals, `zon-` fluent ids, the `extensions.zotero-obsidian-notes`
prefs prefix) are deliberately kept as legacy to avoid a sweeping mechanical rename
across bootstrap during major surgery — and so saved prefs survive.
