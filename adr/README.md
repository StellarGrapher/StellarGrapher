# Architecture Decision Records

An Architecture Decision Record (ADR) captures a single significant design
decision: its context, the decision, and its consequences. ADRs are immutable
once accepted — a reversal is a new ADR that supersedes the old one.

New contributors should read the existing ADRs before proposing structural
changes; they explain *why* the code is shaped the way it is.

## Index

| ADR | Title | Status |
| --- | ----- | ------ |
| [0001](0001-cursor-based-pagination.md) | Cursor-based pagination over offset pagination | Accepted |
| [0002](0002-forward-only-indexer.md) | The indexer is forward-only | Accepted |

## Template

Copy this into `adr/NNNN-short-title.md` (zero-padded, monotonically
increasing number):

```markdown
# NNNN. Title

- Status: proposed | accepted | deprecated | superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Deciders: <names or handles>

## Context

What is the problem? What forces us to make a decision now? Describe the
constraints and the landscape. Keep it factual.

## Decision

What did we decide? State it in the present tense, as a rule the codebase
follows. Be specific about what is in scope and what is not.

## Consequences

What becomes easier or harder as a result? List both positive and negative
consequences, and any follow-up work the decision creates.
```

## Conventions

- One decision per ADR; keep it short (a page is plenty).
- Use the next free number; never reuse or renumber an existing ADR.
- Update an ADR's status only by adding a new ADR that supersedes it, and set
  the old one's status to `superseded by ADR-XXXX`.