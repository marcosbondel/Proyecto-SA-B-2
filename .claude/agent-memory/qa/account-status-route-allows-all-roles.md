---
name: account-status-route-allows-all-roles
description: POST /api/accounts/:id/status is NOT admin-only — @Roles('ADMINISTRADOR','CAJERO_RECEPTOR','CLIENTE') really does grant a CLIENTE their own account's activate/deactivate. Verify role lists from the controller source, not from memory or a task brief.
metadata:
  type: project
---

`POST /api/accounts/:id/status` (`apps/gateway/src/interfaces/accounts.controller.ts`)
carries `@Roles('ADMINISTRADOR', 'CAJERO_RECEPTOR', 'CLIENTE')` — all three
roles pass the Gateway's role gate. Confirmed empirically: an authenticated
CLIENTE, CAJERO_RECEPTOR and ADMINISTRADOR token each got `202` against a
placeholder account id.

**Why this is worth recording:** a task brief describing this suite's scope
stated the route as "ADMINISTRADOR only", which is wrong. D-06 restricts
account deactivation by *role*, but the role list it grants is all three —
CLIENTE is scoped to "their own accounts" (a scope check the Gateway cannot
make and does not attempt; Account Service is presumably where that scope
would be enforced, unverified here). The controller's own doc comment says as
much: "ADMINISTRADOR, CAJERO_RECEPTOR y CLIENTE (para sus propias cuentas)".

**How to apply:** when a task brief or prior memory states a specific
role×route permission, verify it against the controller's `@Roles(...)`
decorator directly before writing an assertion around it — do not encode the
brief's claim as ground truth. This is the same discipline as checking 403
vs. 404 ordering: test the real behavior, and if it disagrees with the
assumption you were given, record the disagreement as a fact rather than
quietly aligning the test to the (wrong) assumption.
