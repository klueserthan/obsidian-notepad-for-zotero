import { defineConfig } from "vitest/config";

// Node unit tests cover the pure logic in src/ (test/*.spec.js).
// test/integration/ holds Mocha-in-Zotero tests run by `zotero-plugin test`,
// which import chai + use Zotero globals and must NOT run under Vitest.
export default defineConfig({
  test: {
    include: ["test/*.spec.js"],
    exclude: ["test/integration/**", "node_modules/**", ".scaffold/**"],
  },
});
