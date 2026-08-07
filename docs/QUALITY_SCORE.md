# Quality Score

Track project quality by domain and layer. This document should become more
specific as the codebase grows.

## Scale

- 5: Excellent; verified, documented, and low-risk.
- 4: Good; minor gaps or missing automation.
- 3: Usable; meaningful gaps are known.
- 2: Risky; fragile or under-specified.
- 1: Poor; needs focused repair before expansion.

## Current Scores

| Area | Score | Notes |
| --- | ---: | --- |
| Product clarity | 2 | Initial scope is not documented yet. |
| Architecture | 2 | Scaffold exists; application architecture is not defined. |
| Reliability | 2 | Reliability targets need to be chosen. |
| Security | 2 | Security model needs to be defined. |
| Documentation | 3 | Agent-first structure exists; content needs project specifics. |

## Review Cadence

Review this file whenever a major workflow, architecture boundary, or release
target changes.
