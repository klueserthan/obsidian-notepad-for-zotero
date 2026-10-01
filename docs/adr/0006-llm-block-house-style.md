# One house style for every LLM block (extends ADR-0001)

Summary Notes came out long, repeated themselves, and broke their own heading
hierarchy: under a template's `### Hypotheses` the model would open with its
own `## Hypotheses`, and three sections would each restate the same six
hypotheses. The cause was the same in every case. Each `{% llm %}` block is
its own model call that sees the paper and its task and nothing about the rest
of the note, and the shared instruction said only "output Markdown".

Every block call now carries one fixed house style:

- **Key points only.** About three to six list items or one table, headline
  results only. The full statistics stay in the paper.
- **Lists and tables, no headings.** The template owns the heading structure.
  A list item may open with a bold label.
- **Its own section only.** The call is given the outline of the note and the
  name of the section it writes. What belongs under another heading is left
  there and referred to by a short label such as `H1`.

Three decisions are deliberate and easy to second-guess later:

- **No opt-out.** The style is part of the instruction in `src/llm-runner.js`,
  not of any template, and no template or block can switch it off. Shipped
  note types are copied into the Templates folder once and never overwritten,
  so a style that lived in template text would not reach the templates people
  already use. A template that wants a long prose answer from the model cannot
  have one; nothing has needed that yet.
- **Headings are converted, not rejected.** The length and scope rules are
  instructions a model may follow loosely. The heading rule is enforced: any
  heading in a block's output is turned into a bold line before the note is
  assembled. ADR-0001's fail-loudly rule still governs everything that affects
  what the note says (missing context, HTTP errors, empty answers); a
  formatting slip is not worth losing a whole run over.
- **Blocks stay independent.** A block knows the outline, not the other
  blocks' text. Writing sections in order with the earlier ones in view, one
  call for the whole note, and an editor pass over the finished note were all
  considered. They cost parallelism, the per-block design of ADR-0001, or the
  guarantee that no fact is silently rewritten. If notes still repeat
  themselves, sequential writing is the next step.
