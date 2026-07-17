#!/usr/bin/env python3
"""Apply native GitHub parent/sub-issue and blocked-by relationships."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


ISSUE_URL_RE = re.compile(r"https://github\.com/([^/\s]+)/([^/\s]+)/issues/(\d+)")
ISSUE_SHORTHAND_RE = re.compile(r"(?<![\w/])#(\d+)\b")
BLOCKED_BY_SECTION_RE = re.compile(
    r"^##\s+Blocked by\s*$\n(?P<body>.*?)(?=^##\s+|\Z)",
    re.IGNORECASE | re.MULTILINE | re.DOTALL,
)


@dataclass(frozen=True)
class IssueRef:
    """A GitHub issue reference parsed from CLI input or issue body text."""

    repo: str | None
    number: int


@dataclass(frozen=True)
class IssueNode:
    """The GitHub GraphQL fields needed to link and verify an issue."""

    number: int
    title: str
    node_id: str
    body: str
    parent_number: int | None
    blocked_by_numbers: frozenset[int]


@dataclass(frozen=True)
class LinkPlan:
    """Native relationship mutations needed to match markdown issue links."""

    sub_issue_numbers: tuple[int, ...]
    blocked_by_pairs: tuple[tuple[int, int], ...]


def run_gh(args: list[str]) -> str:
    """Run a GitHub CLI command and return stdout."""

    result = subprocess.run(
        ["gh", *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        command = " ".join(["gh", *args])
        raise RuntimeError(f"{command} failed:\n{result.stderr.strip()}")
    return result.stdout


def run_gh_json(args: list[str]) -> Any:
    """Run a GitHub CLI command and parse its JSON stdout."""

    output = run_gh(args)
    return json.loads(output) if output.strip() else None


def parse_issue_ref(value: str) -> IssueRef:
    """Parse an issue number, shorthand, or GitHub issue URL."""

    value = value.strip()
    url_match = ISSUE_URL_RE.search(value)
    if url_match:
        owner, repo, number = url_match.groups()
        return IssueRef(repo=f"{owner}/{repo}", number=int(number))

    number_match = re.fullmatch(r"#?(\d+)", value)
    if number_match:
        return IssueRef(repo=None, number=int(number_match.group(1)))

    raise ValueError(f"Could not parse issue reference: {value}")


def split_repo(repo: str) -> tuple[str, str]:
    """Split an owner/name repository string."""

    try:
        owner, name = repo.split("/", 1)
    except ValueError as error:
        raise ValueError(f"Repository must be owner/name, got: {repo}") from error
    return owner, name


def resolve_repo(repo: str | None, parent_ref: IssueRef) -> str:
    """Resolve the target repository from CLI input, parent URL, or gh context."""

    if repo:
        return repo
    if parent_ref.repo:
        return parent_ref.repo

    data = run_gh_json(["repo", "view", "--json", "nameWithOwner"])
    return str(data["nameWithOwner"])


def issue_url(repo: str, issue_number: int) -> str:
    """Build a canonical GitHub issue URL."""

    return f"https://github.com/{repo}/issues/{issue_number}"


def parse_issue_numbers(values: list[str]) -> tuple[int, ...]:
    """Parse comma-separated and space-separated issue number arguments."""

    numbers: set[int] = set()
    for value in values:
        for part in value.split(","):
            part = part.strip()
            if part:
                numbers.add(parse_issue_ref(part).number)
    return tuple(sorted(numbers))


def discover_children(repo: str, parent_number: int, limit: int) -> tuple[int, ...]:
    """Discover child issues whose body references the parent issue URL."""

    parent_url = issue_url(repo, parent_number)
    data = run_gh_json(
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--limit",
            str(limit),
            "--json",
            "number,title,body",
            "--search",
            f'"{parent_url}" in:body',
        ],
    )
    numbers = {
        int(issue["number"]) for issue in data if int(issue["number"]) != parent_number
    }
    return tuple(sorted(numbers))


def parse_blockers(repo: str, body: str) -> tuple[int, ...]:
    """Parse same-repository issue blockers from a markdown Blocked by section."""

    section_match = BLOCKED_BY_SECTION_RE.search(body or "")
    if not section_match:
        return ()

    section = section_match.group("body")
    blockers: set[int] = set()
    for owner, name, number in ISSUE_URL_RE.findall(section):
        if f"{owner}/{name}" == repo:
            blockers.add(int(number))

    cleaned = ISSUE_URL_RE.sub("", section)
    blockers.update(int(number) for number in ISSUE_SHORTHAND_RE.findall(cleaned))
    return tuple(sorted(blockers))


def graphql_query(
    query: str, variables: dict[str, str] | None = None
) -> dict[str, Any]:
    """Run a GitHub GraphQL query or mutation."""

    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in (variables or {}).items():
        args.extend(["-f", f"{key}={value}"])
    data = run_gh_json(args)
    if data and data.get("errors"):
        raise RuntimeError(json.dumps(data["errors"], indent=2))
    return data


def get_issue_nodes(repo: str, numbers: set[int]) -> dict[int, IssueNode]:
    """Fetch GraphQL IDs and existing native relationships for issues."""

    if not numbers:
        return {}
    owner, name = split_repo(repo)
    fields = "\n".join(
        f"""
        i{number}: issue(number: {number}) {{
          id
          number
          title
          body
          parent {{ ... on Issue {{ number }} }}
          blockedBy(first: 100) {{ nodes {{ number }} }}
        }}
        """
        for number in sorted(numbers)
    )
    query = f"""
    query($owner: String!, $name: String!) {{
      repository(owner: $owner, name: $name) {{
        {fields}
      }}
    }}
    """
    data = graphql_query(query, {"owner": owner, "name": name})
    repository = data["data"]["repository"]
    nodes: dict[int, IssueNode] = {}
    missing: list[int] = []
    for number in sorted(numbers):
        raw = repository[f"i{number}"]
        if raw is None:
            missing.append(number)
            continue
        parent = raw.get("parent")
        blocked_by = raw.get("blockedBy", {}).get("nodes", [])
        nodes[number] = IssueNode(
            number=int(raw["number"]),
            title=str(raw["title"]),
            node_id=str(raw["id"]),
            body=str(raw.get("body") or ""),
            parent_number=int(parent["number"]) if parent else None,
            blocked_by_numbers=frozenset(int(node["number"]) for node in blocked_by),
        )

    if missing:
        raise RuntimeError(
            f"Missing issues in {repo}: {', '.join(f'#{number}' for number in missing)}"
        )
    return nodes


def build_plan(
    parent_number: int,
    children: tuple[int, ...],
    nodes: dict[int, IssueNode],
    repo: str,
) -> LinkPlan:
    """Build the missing native link plan from existing issue bodies and relationships."""

    sub_issues: list[int] = []
    blocked_by_pairs: list[tuple[int, int]] = []
    for child_number in children:
        child = nodes[child_number]
        if child.parent_number != parent_number:
            sub_issues.append(child_number)
        for blocker_number in parse_blockers(repo, child.body):
            if blocker_number == child_number:
                continue
            if blocker_number not in child.blocked_by_numbers:
                blocked_by_pairs.append((child_number, blocker_number))

    return LinkPlan(
        sub_issue_numbers=tuple(sorted(sub_issues)),
        blocked_by_pairs=tuple(sorted(blocked_by_pairs)),
    )


def add_sub_issue(parent_id: str, child_id: str) -> None:
    """Add a native GitHub sub-issue relationship."""

    mutation = """
    mutation($issueId: ID!, $subIssueId: ID!) {
      addSubIssue(input: {issueId: $issueId, subIssueId: $subIssueId, replaceParent: true}) {
        issue { number }
        subIssue { number }
      }
    }
    """
    graphql_query(mutation, {"issueId": parent_id, "subIssueId": child_id})


def add_blocked_by(issue_id: str, blocker_id: str) -> None:
    """Add a native GitHub blocked-by relationship."""

    mutation = """
    mutation($issueId: ID!, $blockingIssueId: ID!) {
      addBlockedBy(input: {issueId: $issueId, blockingIssueId: $blockingIssueId}) {
        issue { number }
        blockingIssue { number }
      }
    }
    """
    graphql_query(mutation, {"issueId": issue_id, "blockingIssueId": blocker_id})


def apply_plan(parent_number: int, plan: LinkPlan, nodes: dict[int, IssueNode]) -> None:
    """Apply all missing native issue relationships in a link plan."""

    parent_id = nodes[parent_number].node_id
    for child_number in plan.sub_issue_numbers:
        add_sub_issue(parent_id, nodes[child_number].node_id)
    for child_number, blocker_number in plan.blocked_by_pairs:
        add_blocked_by(nodes[child_number].node_id, nodes[blocker_number].node_id)


def verify_plan(parent_number: int, children: tuple[int, ...], repo: str) -> None:
    """Verify native parent and blocked-by relationships after mutation."""

    first_pass = get_issue_nodes(repo, {parent_number, *children})
    blocker_numbers = {
        blocker_number
        for child_number in children
        for blocker_number in parse_blockers(repo, first_pass[child_number].body)
    }
    nodes = get_issue_nodes(repo, {parent_number, *children, *blocker_numbers})
    errors: list[str] = []
    for child_number in children:
        child = nodes[child_number]
        if child.parent_number != parent_number:
            errors.append(
                f"#{child_number} parent is {child.parent_number}, expected #{parent_number}"
            )
        for blocker_number in parse_blockers(repo, child.body):
            if blocker_number not in child.blocked_by_numbers:
                errors.append(
                    f"#{child_number} is missing native blockedBy #{blocker_number}"
                )
    if errors:
        raise RuntimeError("Verification failed:\n" + "\n".join(errors))


def print_plan(
    parent_number: int,
    children: tuple[int, ...],
    plan: LinkPlan,
    nodes: dict[int, IssueNode],
) -> None:
    """Print a concise human-readable relationship plan."""

    print(f"Parent: #{parent_number} {nodes[parent_number].title}")
    print(f"Children discovered: {len(children)}")
    for child_number in children:
        print(f"- #{child_number} {nodes[child_number].title}")
    print(f"Sub-issue links to add: {len(plan.sub_issue_numbers)}")
    for child_number in plan.sub_issue_numbers:
        print(f"- #{parent_number} -> #{child_number}")
    print(f"Blocked-by links to add: {len(plan.blocked_by_pairs)}")
    for child_number, blocker_number in plan.blocked_by_pairs:
        print(f"- #{child_number} blocked by #{blocker_number}")


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(
        description="Apply native GitHub sub-issue and blocked-by links from markdown issue bodies.",
    )
    parser.add_argument(
        "parent", help="Parent issue number, #number, or GitHub issue URL."
    )
    parser.add_argument(
        "--repo",
        help="Target repository in owner/name form. Defaults to parent URL or gh repo context.",
    )
    parser.add_argument(
        "--children",
        nargs="*",
        default=[],
        help="Optional child issue numbers or comma-separated issue numbers.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Maximum issues to inspect when auto-discovering children.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply mutations. Without this flag, only print the plan.",
    )
    return parser.parse_args()


def main() -> int:
    """Run the native issue-link synchronization workflow."""

    args = parse_args()
    parent_ref = parse_issue_ref(args.parent)
    repo = resolve_repo(args.repo, parent_ref)
    children = (
        parse_issue_numbers(args.children)
        if args.children
        else discover_children(repo, parent_ref.number, args.limit)
    )
    if not children:
        print(
            "No child issues found. Pass --children if auto-discovery cannot find them.",
            file=sys.stderr,
        )
        return 1

    initial_nodes = get_issue_nodes(repo, {parent_ref.number, *children})
    blocker_numbers = {
        blocker_number
        for child_number in children
        for blocker_number in parse_blockers(repo, initial_nodes[child_number].body)
    }
    nodes = get_issue_nodes(repo, {parent_ref.number, *children, *blocker_numbers})
    plan = build_plan(parent_ref.number, children, nodes, repo)
    print_plan(parent_ref.number, children, plan, nodes)

    if not args.apply:
        print(
            "Dry run only. Re-run with --apply to mutate GitHub native issue relationships."
        )
        return 0

    apply_plan(parent_ref.number, plan, nodes)
    verify_plan(parent_ref.number, children, repo)
    print("Verified native GitHub sub-issue and blocked-by relationships.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
