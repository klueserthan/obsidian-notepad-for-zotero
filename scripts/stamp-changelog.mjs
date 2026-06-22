// At release time, move the accumulated `## [Unreleased]` notes under a dated
// version heading and leave a fresh empty `## [Unreleased]` on top. Wired into
// `release:build` (which runs after the version bump, so package.json already
// holds the new version). Idempotent + safe:
//   - does nothing if a `## [<version>]` heading already exists (re-run / resume)
//   - does nothing if `[Unreleased]` has no content yet (won't create an empty
//     version section)
// Keeps the changelog from drifting (released content stranded under Unreleased).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const path = join(root, "CHANGELOG.md");
let md = readFileSync(path, "utf8");

if (md.includes(`## [${version}]`)) {
  console.log(`[stamp-changelog] [${version}] already present — no change.`);
  process.exit(0);
}

// Body of the Unreleased section = everything up to the next "## [" heading (or EOF).
const m = md.match(/## \[Unreleased\][^\n]*\n([\s\S]*?)(?=\n## \[|$)/);
if (!m || !m[1].trim()) {
  console.log("[stamp-changelog] [Unreleased] empty or absent — no change.");
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (release machine local UTC)
md = md.replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${version}] — ${date}\n`);
writeFileSync(path, md);
console.log(`[stamp-changelog] stamped [Unreleased] → [${version}] — ${date}.`);
