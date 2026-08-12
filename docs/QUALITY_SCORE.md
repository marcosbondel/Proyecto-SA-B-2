# Quality Score

Scores use a five-point scale:

- **5:** Excellent; verified, documented, and low-risk.
- **4:** Good; a small number of known gaps remain.
- **3:** Usable; meaningful gaps are explicitly tracked.
- **2:** Risky; important behavior is under-specified.
- **1:** Poor; focused repair is required before expansion.

## Current Scores

| Area | Score | Rationale for the post-T-01 assessment |
| --- | ---: | --- |
| Product clarity | 4 | Bank USAC users and five core workflows are recorded; the concise north-star statement and detailed acceptance criteria remain with T-02. |
| Architecture | 4 | Stack, service boundaries, data ownership, asynchronous rules, Saga, Kubernetes, and SRE constraints are documented; backend code and deployment remain future work. |
| Reliability | 3 | Required SRE concerns and correlation tracing are explicit; SLI, SLO, SLA values and runtime evidence arrive with T-03 and T-18. |
| Security | 3 | Assignment-derived data classes and the Gateway/database boundaries are recorded; access control and secret-loading decisions arrive with T-03 and T-06. |
| Documentation | 4 | The project now has an ownership record, methodology, design system, inventory, architecture, and adapted guides; test and lint automation remain TD-004. |

## Review Cadence

Review this file at each milestone boundary and whenever a major architecture,
security, reliability, or delivery decision changes. Update the score with the
evidence that caused the movement.
