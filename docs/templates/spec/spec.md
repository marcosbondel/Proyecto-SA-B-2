# Spec NNN: Title

Type: feature
Status: Draft
Owner: TBD
Created: YYYY-MM-DD

> The **what** and the **why**. No stack, no file paths, no implementation —
> those belong in `plan.md`. A spec a competitor could read and still not know
> how you built it is the right shape.

## Problem

What is broken, missing, or costly today? Who feels it, and how often?

## Users

Who this is for. Name the primary user and, if it matters, who it is not for.

## Goals

- Goal

## Non-Goals

Scope is defined by exclusions as much as inclusions. Name what this
deliberately does not do, and which later slice picks it up.

- Non-goal

## User Flow

1. Step

## Acceptance Criteria

Every criterion gets a stable ID. `qa` records evidence against these IDs in
`evidence.md`, and `reviewer` checks the diff against them. A criterion a
machine or a human cannot check is not a criterion — "fast" fails, "P95 under
300ms on the search endpoint" passes.

| ID | Criterion | How it is checked |
| --- | --- | --- |
| AC-01 |  |  |
| AC-02 |  |  |

## Edge Cases

The states that get skipped and then ship broken: empty, loading, error,
offline, permission denied, overflow, concurrent access.

- Case → expected behaviour

## Assumptions

What was assumed because the answer was not available. Each one is a bet; say
what breaks if it is wrong.

- Assumption → what breaks if wrong

## Open Questions

Unresolved items that need a human. Blocking questions go here, not into a
silent guess.

- [ ] Question

## Rejected Alternatives

The reading of the problem that was considered and dropped, and why.

- Alternative → why not
