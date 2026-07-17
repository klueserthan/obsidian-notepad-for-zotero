import { assert } from "chai";

// Runs INSIDE Zotero via `zotero-plugin test`. Verifies the plugin actually
// loaded and wired its Zotero-side registrations (things the Node/Vitest unit
// tests can't see).

describe("startup", function () {
  it("exposes the plugin handle (Zotero.ZON)", function () {
    assert.ok(Zotero.ZON, "Zotero.ZON should be defined");
  });

  it("registered an item-pane section", function () {
    assert.ok(Zotero.ZON._registeredPaneID, "section pane id should be set");
  });

  it("registers NO Notifier observer (auto-sync was deleted, ADR-0002)", function () {
    // The teardown (#30) removed the annotation auto-sync entirely — startup
    // must no longer register a Zotero.Notifier observer, and the old
    // `_notifierID` handle field is gone with it.
    assert.notOk(Zotero.ZON._notifierID, "no notifier observer should be registered");
    assert.isUndefined(Zotero.ZON.registerNotifier, "registerNotifier should be deleted");
  });
});
