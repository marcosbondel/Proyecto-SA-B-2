# Product Sense

## Product North Star

> **Blocked**: The team has not yet approved a concise north-star statement
> beyond the assignment's distributed banking scope. Owner: Marcos Bonifasi.
> Arrives with: T-02.

## Users

The product serves people and systems that need banking operations to be
traceable and reliable:

- Customers who register, validate their identity, manage accounts, and review
  balances and transactions.
- Operators and reviewers who need payment, notification, and audit events to
  be visible.
- The project team, who uses the system to demonstrate asynchronous
  microservice behavior, distributed workflows, and SRE practices.

## Core Workflows

The assignment defines these product workflows:

1. Register and validate a customer, including identity-document handling.
2. Create and consult a bank account and its balance.
3. Transfer funds between accounts with validation, transaction recording, and
   Saga compensation where required.
4. Process internal or external payments.
5. Send notifications and record audit events for system activity.

The exact user journey, authorization rules, and interaction copy for each
workflow are product decisions for the corresponding feature tickets.

> **Blocked**: Detailed workflow acceptance criteria and the product north
> star are not part of T-01. Owner: Marcos Bonifasi. Arrives with: T-02.

## Product Principles

- Make the current state of a banking operation clear.
- Prefer a safe, traceable action over a fast-looking but ambiguous result.
- Keep service boundaries invisible to the user while preserving their
  reliability guarantees.
- Use the [design system](DESIGN.md) for every interface decision.

## Scope Boundary

T-01 records the domain flows and the system baseline. It does not implement
  customer, account, transaction, payment, notification, or audit behavior.
