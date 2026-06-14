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

  it("registered a Notifier observer (for auto-sync)", function () {
    assert.ok(Zotero.ZON._notifierID, "notifier id should be set");
  });
});
