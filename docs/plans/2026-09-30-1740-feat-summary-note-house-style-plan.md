---
title: A House Style for LLM-Written Summary Note Sections - Plan
type: feat
date: 2026-09-30
topic: summary-note-house-style
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# A House Style for LLM-Written Summary Note Sections - Plan

## Goal Capsule

**Objective:** A generated Summary Note reads as a compact set of key points: its headings form a strict hierarchy, each fact appears once, and it is roughly a third of today's length.

**Means:** A fixed house style in the instruction every block call shares, an outline of the note in each call, and a heading conversion on each block's output (KTD1, KTD3).

**Product authority:** This Product Contract, from the brainstorm dialogue of 2026-09-30. The Product Contract wins on behavior, the Planning Contract on mechanism.

**Execution profile:** Pure logic in `src/` with Vitest coverage. No change to `addon/bootstrap.js`, `core/core.js`, preferences or shipped templates.

**Stop conditions:** Stop and report if the change cannot stay inside `src/`, or if evidence shows a labeled Key Decision cannot work.

**Open blockers:** None.

**Product Contract preservation:** Product Contract unchanged. Its four questions deferred to planning are resolved in KTD2, KTD4, KTD5 and KTD6.

---

## Product Contract

### Summary

Give every `{% llm %}` block one fixed house style: key points only, bullets and tables, no headings, and only the content that belongs under the block's own heading. The style applies to every Template, including the ones already in a user's Templates folder, and the no-headings rule is enforced by the plugin instead of left to the model.

### Problem Frame

Three Summary Notes generated on 2026-09-30 show the same three faults.

Headings break the hierarchy. The shipped Note Types put each `{% llm %}` block under a `###` heading inside `## Summary`, and the model opens its answer with a heading of its own, usually `##` and once `#`. The note for Taber and Lodge (2006) has `### Hypotheses` followed directly by `## Hypotheses (Taber & Lodge 2006)`.

Sections repeat each other. The same note states its six hypotheses in full three times, under Research Question(s), Hypotheses and Theoretical Framework. The review note for Wood and Quinn (2003) lists its inclusion criteria, search sources and coded variables in two or three sections each.

The notes are long. The Taber and Lodge note runs to about 2,300 words and the review note to about 3,500, because every coefficient and test statistic is listed. One section of the review note ends mid-sentence.

All three faults have one cause. Each block is resolved by its own model call, which receives the paper and that block's task and nothing about the rest of the note. The instruction shared by all calls asks for Markdown and says nothing about length or headings, and nothing inspects the answer before it becomes part of the note.

### Key Decisions

- **Key points only.** Sections carry headline results, and the full statistics stay in the paper. Governs R4, R5. (session-settled: user-approved — chosen over removing repeats while keeping today's detail, and over a one-minute skim card: the note is a working summary, not a results archive and not a teaser)
- **The LLM writes no headings.** The Template owns the heading structure. Governs R1. (session-settled: user-directed — chosen over allowing one sub-heading level below the Template's: with 3-6 bullets per section there is nothing left for a sub-heading to organise)
- **Bullets, tables and bold lead-ins inside a section.** Governs R2. (session-settled: user-approved — chosen over strictly flat bullets: a findings section covering several hypotheses keeps its grouping through a bold label on each bullet)
- **One style for every Template, no opt-out.** Governs R9. (session-settled: user-approved — chosen over a per-block opt-out and over changing only the shipped Note Types: shipped templates are copied into the Templates folder once and never overwritten, so rewording them would not reach the templates in use, and nothing needs an opt-out today)
- **Each section knows its remit.** Governs R6, R7, R8. (session-settled: user-approved — chosen over writing sections in order with earlier output in view, one call for the whole note, and an editor pass over the finished note: it removes the cause seen in the notes at today's speed and cost and keeps blocks independent)
- **A stray heading is converted, not rejected.** Governs R3. (session-settled: user-approved — chosen over failing the run: a formatting slip should not cost the user a whole LLM run)

### Requirements

**Format**

- R1. The output of a `{% llm %}` block contains no Markdown heading at any level.
- R2. Block output consists of lists and tables only, and a list is numbered only when the block's task asks for one. A list item may open with a bold label, and one level of nesting is allowed; prose paragraphs and standalone bold lines used as headings are not.
- R3. The plugin enforces R1 on every block's output before the Summary Note is created: a heading line loses its heading status and keeps its text as a bold label, and the run does not fail. This fallback is the one case where a standalone bold line may appear despite R2.

**Length**

- R4. Block output is limited to key points: about 3-6 top-level bullets, or one table when the block's task asks for a table. This is an instruction to the model; the plugin neither truncates nor rejects a longer answer.
- R5. A block reports the headline result for each finding or hypothesis and leaves exhaustive coefficients and test statistics in the paper.

**Repetition**

- R6. Every block call is told the outline of the note it belongs to and which section of that outline it is writing.
- R7. A block writes only what belongs under its own heading. Content that belongs to another section stays there, and the block refers to it by a short label such as `H1` when it needs to.
- R8. Blocks remain independent calls; no block receives another block's output.

**Reach**

- R9. R1-R7 apply to every `{% llm %}` block in every Template with no opt-out, including Template files already present in the Templates folder, which need no edit.
- R10. R1-R7 hold equally for a Summary Note generated through the Composer and one generated by Automatic Mode.

### Acceptance Examples

- AE1. **Covers R1, R3.**
  - **Given:** a Template section headed `### Hypotheses` whose block the model answers with a first line `## Hypotheses (Taber & Lodge 2006)` followed by bullets.
  - **Then:** the Summary Note is created, the section contains no heading besides the Template's `### Hypotheses`, and the model's line survives only as a bold label.
- AE2. **Covers R6, R7.**
  - **Given:** the inferential Note Type and a paper with six hypotheses.
  - **Then:** the hypotheses are stated in full under Hypotheses only, and Main Findings refers to them as `H1` to `H6`.
- AE3. **Covers R9.**
  - **Given:** a Template file that was seeded into the Templates folder before this change and has not been edited.
  - **Then:** a Summary Note generated from it follows R1-R7.
- AE4. **Covers R4.**
  - **Given:** a block the model answers with nine bullets.
  - **Then:** the Summary Note is created with all nine bullets.

### Success Criteria

- Regenerating the Taber and Lodge (2006) note with the inferential Note Type gives LLM-written sections of roughly 600-800 words in total, down from about 2,300, with each hypothesis stated in full once.
- Regenerating the Wood and Quinn (2003) note with the review Note Type states the inclusion criteria, the search sources and the coded variables in one section each, and no section ends mid-sentence.
- Neither regenerated note contains a heading the Template did not write.

### Scope Boundaries

- Existing Summary Notes are not rewritten. A note gets the new style only when the user regenerates it (create-once, `docs/adr/0002-zotero-child-notes-one-way-create-once.md`).
- No per-Template or per-block switch turns the house style off.
- Writing sections in order, each with the earlier sections in view, is deferred. It is the next step if regenerated notes still repeat under R7.
- The plugin does not cap, truncate or reject block output by length.
- The empty `## Notes` and `## Annotations` headings at the end of a note stay as they are.
- Detecting a section that was cut off by the output limit is not part of this work.
- The Template's own text, its headings and its annotation blocks are untouched.

Considered during planning and not built:

- Dropping a converted heading that only repeats the Template's section title. It stays a bold line per KTD4; regenerated notes that routinely show such a redundant line would change the call.
- Keeping annotation text out of the outline. A PDF comment line that starts with `# ` would appear as one extra outline entry, which misleads no section; a note whose outline is visibly polluted would change the call.
- Setext headings in the outline. Templates are written with `#` headings; a Template in use that relies on underlined headings would change the call.
- A length cap on outline entries. Headings come from the Template author, not from the paper.

### Dependencies / Assumptions

- The model is the user's own choice. R1 is guaranteed by R3; R2, R4, R5 and R7 depend on how well that model follows instructions.
- The repetition seen in the notes is assumed to come mainly from blocks not knowing the rest of the note exists. If R6 and R7 do not remove it, the deferred sequential approach is the remedy.

### Sources / Research

- `src/llm-runner.js:19-28` holds the instruction shared by all block calls, and `src/llm-runner.js:46-54` assembles the context-then-task message.
- `src/llm-runner.js:196-206` builds one task per block and `src/llm-runner.js:263-276` makes one call per task; `src/llm-runner.js:211-222` writes block output into the note text unchanged.
- `src/md-html.js:28-35` converts Markdown to HTML and passes headings through as written.
- `src/llm.js:30` sets the default output limit of 2048 tokens per block, a user preference. The block path has no check for an answer cut off at that limit (`src/llm.js:94-111`, `src/llm-runner.js:61-64`).
- `addon/bootstrap.js:111-290` holds the five shipped Note Types; `addon/bootstrap.js:741-757` seeds them once per Templates folder without overwriting.
- The Composer (`addon/bootstrap.js:1844`) and the unattended path (`addon/bootstrap.js:2520`) both resolve blocks through the same shared function, which is where R10 is satisfied.
- `docs/TEMPLATES.md:399-404` describes the byte-identical request prefix that blocks sharing a context rely on for caching; R6 adds per-call text and planning should keep that prefix intact.
- `docs/adr/0001-explicit-static-llm-interpreter.md` sets the fail-loudly rule for LLM calls, which R3 deliberately does not extend to formatting slips.
- Evidence notes in the user's Zotero library: `LBNAZ3TC` (Taber and Lodge 2006, inferential), `U7KSDSSW` (Wood and Quinn 2003, review), `IYKPB4J4` (Friestad and Wright 1994, theoretical).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The rules go in the shared instruction, the outline between context and task, the section name after `Task:`.** The house-style rules of R1, R2, R4, R5 and R7 are constant text in `GROUNDING_SYSTEM_PROMPT`. The outline of R6 is the same for every block of a note and sits in the user message after the context. The name of the block's own section is the only per-block addition and sits in the task tail. This keeps the system message and the context-plus-outline prefix byte-identical across blocks that share a context, which is what prompt caching relies on. (session-settled: user-approved — chosen over sequential calls, one call for the whole note, and an editor pass: blocks stay independent per R8)
- KTD2. **The outline is read from the rendered note text.** `prepareLLMRun` already receives the post-render markdown, so conditional headings are resolved. The outline is every `#` heading line outside the leading YAML frontmatter, outside fenced code and outside the blocks' own line ranges, written as a plain nested list without `#` marks so it does not invite headings. A block's section is the nearest heading above it. A block above the first heading gets the outline and no section name. A note with no headings gets neither, so its messages stay byte-identical to today's.
- KTD3. **Headings in block output are found with the renderer's own parser.** The conversion asks the same markdown-it configuration that `mdToHtml` uses which lines are headings, so fenced code, underlined headings and headings nested in list items or blockquotes follow exactly the rules that would otherwise turn them into heading tags. It runs once per block inside `executeLLMBlocks`, after the empty-response check, so the Composer's cached outputs, its preview, Generate and the unattended path all receive converted text. `normalizeLLMOutput` and `applyLLMOutputs` stay unchanged.
- KTD4. **Every converted heading becomes a bold paragraph of its own.** The heading marker and any underline are removed, emphasis marks already inside the text are stripped before wrapping, and a top-level converted line is separated by blank lines so it cannot merge into a neighbouring list item or paragraph. A heading nested in a list item or blockquote keeps its prefix. A heading with no text is removed. This includes a heading that only repeats the section title, which keeps AE1 as written.
- KTD5. **The insufficient-context reply becomes a single list item.** The instruction's "brief Markdown note" wording changes so that reply also satisfies R2. Nothing downstream detects this reply today and that stays so.
- KTD6. **The shipped Note Type prompts are not reworded.** They already ask for bullet points, tables or a numbered list, and rewording would reach only newly seeded Templates folders while KTD1 reaches every folder.

### Assumptions

- An output that is empty after conversion, which requires a heading with no text and nothing else, is reported as the existing empty-response failure. R3 forbids failing because of a heading, not accepting an empty section.
- Two blocks under one heading receive the same section name and may repeat each other. The Template documentation says so; no code prevents it.
- Success Criteria are checked by the user after merge by regenerating the two named notes, because the model and its key are the user's own.

### System-Wide Impact

- Every user-written Template changes behavior on upgrade: LLM sections become shorter and lose headings with no setting to restore the old output. The changelog entry states this.
- Each block call grows by the outline, a few lines per note. The cached prefix per context set is unchanged in kind.
- The Composer's gating keys on a block's context and body, which this work does not change, so previously resolved blocks stay resolved within a session.

---

## Implementation Units

### U1. House-style instruction and outline-aware messages

**Goal:** Every block call carries the house-style rules, the note's outline and the name of the section it writes.

**Requirements:** R2, R4, R5, R6, R7, R8, R9, R10; KTD1, KTD2, KTD5.

**Dependencies:** None.

**Files:**
- `src/llm-runner.js`
- `test/llm-runner.spec.js`

**Approach:**
1. Extend `GROUNDING_SYSTEM_PROMPT` with the rules KTD1 assigns to it and the rewording of KTD5. Keep the phrases the existing prompt test checks for: "research assistant", "Markdown", "context", and "no preface" or "no commentary".
2. In `prepareLLMRun`, derive the outline once from `text` and the parsed blocks per KTD2, then pass the outline and each block's section name into message assembly.
3. Extend `buildLLMMessages` so the outline follows the context and the section name opens the task. With no outline and no section name its output is unchanged.

**Patterns to follow:** The context cache and the prefix comment above `buildLLMMessages` in `src/llm-runner.js`; the prefix tests in the "prompt caching" group of `test/llm-runner.spec.js`.

**Test scenarios:**
- A template with `## Summary`, `### Hypotheses` and `### Main Findings`, each `###` holding one block: both user messages contain the outline with all three headings, and each task tail names its own section.
- Covers AE2. The same template: the two user messages are identical up to and including `Task:\n`, and the system messages are identical.
- A template without headings: the user message equals `Context:\n<context>\n\nTask:\n<task>` exactly as before.
- A block above the first heading of a template that has headings: the message contains the outline and no section name.
- A line starting with `# ` inside a fenced code block in the template, and one inside a multi-line block body, do not appear in the outline.
- A template that opens with a frontmatter block containing a `# comment` line: neither that line nor the frontmatter keys appear in the outline.
- Two blocks under one heading both receive that heading as their section name.
- Covers AE3. A template body in the pre-change shipped wording, with no mention of style, produces messages whose system instruction contains the house-style rules.
- The system instruction forbids headings, limits output to lists and tables, asks for key points, and tells the model to leave other sections' content to them.
- The outline contains no `#` character for plain headings.

**Verification:** The existing pinned message strings in `test/llm-runner.spec.js` pass unmodified, and the new scenarios pass.

### U2. Heading conversion on block output

**Goal:** No heading written by the model reaches a Summary Note.

**Requirements:** R1, R3, R9, R10; KTD3, KTD4.

**Dependencies:** None.

**Files:**
- `src/md-html.js`
- `src/llm-runner.js`
- `test/md-html.spec.js`
- `test/llm-runner.spec.js`

**Approach:**
1. Add a pure conversion function beside `mdToHtml` in `src/md-html.js`, using the module's existing markdown-it instance to locate headings per KTD3 and rewriting those lines per KTD4.
2. Call it in the `task` step of `executeLLMBlocks` on the classified output, and treat an output that is empty afterwards as an empty response.
3. It is used only inside `src/`, so `core/core.js` needs no new export.

**Execution note:** Write the conversion test-first against the invariant below; the line rewriting has several small cases that are easy to get subtly wrong.

**Patterns to follow:** The fixed, explicit markdown-it setup and its tests in `src/md-html.js` and `test/md-html.spec.js`.

**Test scenarios:**
- Covers AE1. `## Hypotheses (Taber & Lodge 2006)` followed by a bullet list becomes a bold line, a blank line and the unchanged list; rendered through `mdToHtml` it contains no heading tag.
- `# Title` and `###### Deep` are both converted; `#hashtag` and `#` inside a table cell are left alone.
- A heading line inside a fenced code block is left alone.
- `Some line` followed by `---` becomes a bold `Some line` and the underline is gone; a three-line underlined heading becomes one bold paragraph.
- `- # Nested` keeps its list marker and loses the `#`; `> ## Quoted` keeps its quote marker.
- A heading directly after a list item, and one directly before a paragraph, each end up as a separate paragraph in the rendered HTML.
- `## **Bold** title` becomes one bold line without doubled asterisks.
- An empty `##` line is removed.
- Output without headings is returned byte-identical.
- Invariant over all fixtures above: `mdToHtml` of the converted text contains no `<h1>` to `<h6>`.
- Covers AE1. `executeLLMBlocks` with a fake fetch that returns a heading-led answer: `outputs` and `md` contain no model heading, the template's own `###` heading is intact, and the result is `ok`.
- Covers AE4. A nine-bullet answer passes through unchanged and the result is `ok`.
- A fake fetch that returns only `##` yields the empty-response failure for that block.

**Verification:** The invariant holds for every fixture, and an end-to-end run through `executeLLMBlocks` on a shipped Note Type with heading-led fake answers renders, after `stripMarkers` and `mdToHtml`, only the headings the Template wrote plus the title line.

### U3. Documentation

**Goal:** A Template author knows what every `{% llm %}` block now does to the model's answer and why there is no switch.

**Requirements:** R9; KTD1, KTD4.

**Dependencies:** U1, U2.

**Files:**
- `docs/TEMPLATES.md`
- `docs/adr/0006-llm-block-house-style.md`
- `CONTEXT.md`
- `CHANGELOG.md`
- `README.md` only if it describes LLM block output

**Approach:**
1. Add a subsection under "LLM-assisted templates" in `docs/TEMPLATES.md`: the house style, the outline each call receives, the heading conversion, and the note that two blocks under one heading share a section name. Update the description of the request shape next to the prefix-caching paragraph.
2. Write ADR-0006 recording the house style, the absence of an opt-out, and that formatting slips are converted while ADR-0001's fail-loudly rule still governs everything else.
3. Add the term for the house style to `CONTEXT.md` in the existing entry format.
4. Add a changelog entry under `## [Unreleased]` in the existing narrative style, stating that existing Templates change behavior.

**Test expectation:** none -- documentation only.

**Verification:** Each of the four documents describes behavior that matches U1 and U2 as built.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | U1, U2 |
| Build | `npm run build` | U1, U2 |
| Integration tests | `npm run test:zotero` | Not required locally: `addon/bootstrap.js` is untouched. CI runs it. |

After merge the user regenerates the Taber and Lodge (2006) and Wood and Quinn (2003) notes and compares them with the Success Criteria.

---

## Definition of Done

- U1, U2 and U3 meet their Verification lines.
- `npm test` and `npm run build` pass.
- `addon/bootstrap.js`, `core/core.js`, `addon/content/preferences.xhtml` and the shipped templates are unchanged.
- No abandoned approach or unused helper remains in the diff.
