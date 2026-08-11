# Technical Debt Tracker

Track debt as small, actionable items. Debt arrives here from two places: a
spec's carried debt when it closes, and review findings labelled taste rather
than blocking. Cite the spec it came from — that is what keeps the trail intact
after the spec is archived.

An item that grows past a few lines is not debt, it is a spec. Open one.

| ID | Area | Issue | Impact | Proposed Fix | From | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Documentation | Product scope is not defined yet. | Agents lack product context. | Write the first spec with Spec Kit, once it is initialized. | — | Open |
| TD-002 | Architecture | Runtime and module boundaries are not defined. `apps/web/` is a Nuxt 4 starter, but `ARCHITECTURE.md` is still a placeholder. | Future changes may drift with no recorded boundaries to check them against. | Record the stack and the module boundaries in `ARCHITECTURE.md`. | — | Open |
| TD-003 | Tooling | Spec Kit is not initialized. The home-grown `/spec-*` workflow was removed and nothing replaced it yet. | No spec workflow at all: no phases, no gates, no traceability from intent to proof. | Run Spec Kit's init and document how it is wired in `AGENTS.md`. | — | Open |
| TD-004 | Verification | `apps/web/package.json` defines no test and no lint script. | Nothing can be verified beyond a build; `qa` has no suite to run and `verification-before-completion` has no command to paste. | Add a test runner and wire `@nuxt/eslint` to a `lint` script. | — | Open |
| TD-005 | Harness | The `PreToolUse` hooks that blocked unspecced writes and mutating infra commands were deleted with `scripts/agent-checks/`. | `infra-aws` can now run `terraform apply` and similar; implementing roles can write production code with no approved plan. Enforcement is prose only. | Re-wire the boundaries as hooks once the Spec Kit layout is known. | — | Open |
