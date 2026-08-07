# Core Beliefs

These beliefs adapt the article's recommendations into repository practice.

## Humans Steer, Agents Execute

Humans define goals, taste, constraints, and acceptance criteria. Agents perform
the implementation work and gather context directly from the repository.

## The Repository Is The System Of Record

Important knowledge belongs in versioned files. If future agents need it, write
it down and link it from the appropriate index.

## Legibility Compounds

Code, docs, tests, logs, schemas, and scripts should help agents understand the
system. Prefer boring, inspectable components when they make the system easier
to reason about.

## Enforce Invariants

Do not rely only on prose. When an architecture rule matters, add a check,
test, lint rule, or review checklist.

## Garbage Collect Continuously

Track technical debt in small, specific items. Remove stale docs and obsolete
patterns before they spread.
