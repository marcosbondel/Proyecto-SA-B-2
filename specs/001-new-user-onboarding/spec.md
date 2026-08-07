# Spec 001: New User Onboarding

Type: feature
Status: Draft
Owner: TBD
Created: 2026-08-05

> This spec is a **worked example of the format**, carried over from the
> template's original placeholder. Its content is deliberately unresolved — the
> product does not exist yet. Read it for the shape, then replace it with a real
> spec. It is what `/spec-status` will report as "waiting on a human".

## Problem

A new user arrives with no context and no reason to trust the product yet. If
the first session ends without a completed valuable action, they do not come
back, and every later feature is built for users who already left.

## Users

The first-time user, arriving without training, documentation, or a colleague
to ask. Not the returning user, and not the administrator configuring an
account for someone else.

## Goals

- The user completes one genuinely valuable action in their first session.
- The user can state what the product does after that action.
- The user leaves with a clear next step.

## Non-Goals

- Full feature discovery. Onboarding teaches one path, not the product.
- Team or multi-user setup. That is a later slice.
- Personalisation based on role or industry. Later slice.

## User Flow

1. User arrives.
2. User understands what the product does.
3. User completes the smallest valuable action.
4. User sees a clear next step.

## Acceptance Criteria

| ID | Criterion | How it is checked |
| --- | --- | --- |
| AC-01 | A new user completes the first valuable action without external help | Moderated walkthrough with 5 users who have not seen the product |
| AC-02 | Empty, loading, error, and success states are implemented for every step of the flow | Automated UI test per state |
| AC-03 | The flow is reproducible end to end as an automated test | The e2e suite runs it in CI |
| AC-04 | The next step is visible on screen after the first success, without scrolling | Automated UI test at the smallest supported viewport |

## Edge Cases

- User abandons mid-flow and returns later → progress is preserved, not restarted.
- User arrives already holding an invitation → onboarding does not re-ask what the invitation answered.
- The first action fails server-side → the error explains what to do, not what broke.

## Assumptions

- Onboarding is in-product, not an email sequence → if it is email-led, AC-01 and AC-04 are the wrong criteria entirely.
- One onboarding path serves every user type → if roles diverge, this spec splits into several.

## Open Questions

- [ ] What is the first valuable action? Everything here is unresolvable until this is answered.
- [ ] What information is required before the user can start?
- [ ] What should happen after success?
- [ ] Is there an existing product surface to onboard into, or is this greenfield?

## Rejected Alternatives

- A guided product tour over the real UI → teaches where buttons are, not what
  the product is for. Users skip tours and then complete nothing.
