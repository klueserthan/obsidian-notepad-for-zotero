---
name: github-issue-links
description: Use after `/to-issues` or GitHub issue breakdown work when created issues need native GitHub parent/sub-issue and `blocked by` relationships for Sortie, GitHub Projects, or other automation that ignores markdown-only blocker text.
---

# GitHub Issue Links

Convert markdown issue relationships into native GitHub issue relationships.

Use this after publishing child issues from `/to-issues`, especially when an external agent such as Sortie must not pick up issues that are blocked by unfinished prerequisites.

## Workflow

1. Identify the parent issue number or URL.
2. Run a dry run to discover children and planned native links:

```bash
uv run python .opencode/skills/github-issue-links/scripts/apply_native_issue_links.py 80 --repo owner/repo
```

3. If the plan matches the markdown `## Parent` and `## Blocked by` sections, apply the links:

```bash
uv run python .opencode/skills/github-issue-links/scripts/apply_native_issue_links.py 80 --repo owner/repo --apply
```

4. Report the verified native relationships to the user.

## Behavior

- Discovers child issues whose body references the parent issue URL.
- Adds each discovered child issue as a native GitHub sub-issue of the parent.
- Parses each child issue's `## Blocked by` section for same-repository issue references.
- Adds native GitHub `blockedBy` relationships for those prerequisites.
- Skips relationships that already exist, so repeated runs are safe.
- Verifies `parent` and `blockedBy` fields after applying changes.

## When Discovery Is Not Enough

If children do not include the parent URL in their body, pass them explicitly:

```bash
uv run python .opencode/skills/github-issue-links/scripts/apply_native_issue_links.py 80 --repo owner/repo --children 82,83,84 --apply
```

## Requirements

- Use `gh` authenticated against the target repository.
- Use a token/account that can mutate issues through GitHub GraphQL.
- Use same-repository blockers; the script intentionally ignores cross-repository issue references.
