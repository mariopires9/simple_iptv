# Implementation plan

## 1. Execution-phase prerequisites (require user action/approval)
| # | Prerequisite | Who | Blocks |
|---|---|---|---|
| R1 | Approve `Proposed` ADRs (or request changes) | User | Everything |
| R2 | Authorize `git init` and npm dependency installation | User | FND-01 |
| R3 | Create the GitHub repository (public) and `gh auth login` (`! gh auth login`) | User | FND-02, DEP-01 |
| R4 | Provide a legitimate IPTV source for the spike (credentials entered at runtime, never in files) | User | S-00 |
| R5 | Confirm the product name (provisional: "Simple IPTV") | User | PWA-01 (non-blocking: can change later) |
| R6 | Approve the first publication to GitHub Pages | User | DEP-01 |

## 2. Milestones

| Milestone | Goal | Stories | Exit criterion |
|---|---|---|---|
| **M0 — Foundations** | Technical base, CI, design system, skeleton deploy | S-00, FND-01..07, PWA-01, SEC-01, QA-01, QA-03, DEP-01, UX-02 | Green CI; skeleton published (if R6); ADR-010 decided |
| **M1 — First channel** (vertical slice) | Add an Xtream/M3U source and watch live TV with zapping | SRC-01..07, SRC-09, PLY-01..04, LIV-01..04, UX-01, UX-06, QA-02 | A real user watches their channels in Chrome Android and desktop (or the blocker is documented and PRX-01 enters the plan) |
| **M2 — Full catalog** | Movies, series, search, favorites, EPG now/next | VOD-*, SER-*, SCH-*, FAV-*, EPG-01, SRC-08 | Complete E2E flows green |
| **M3 — Release v1.0** | Complete PWA, a11y, performance, device validation | PWA-02..05, SRC-10, UX-03, UX-04, DEP-02 | All NFRs measured; compatibility matrix published; user approval |
| M4 — v1.1 | Post-MVP prioritized after feedback | EPG-02/03, PLY-05, SEC-02, EXP-01, MSS-01, PRX-01 (if not already in) | — |

## 3. Wave sequence (parallelism)

| Wave | Stories (can run in parallel with each other) | Notes |
|---|---|---|
| 0 | S-00 ∥ FND-01 | S-00 is manual with the user; FND-01 is sequential (creates shared files) |
| 1 | FND-02 ∥ FND-03 ∥ FND-05 ∥ FND-06 ∥ FND-07 ∥ PWA-01 ∥ SEC-01 ∥ QA-01 | Max. 3 in parallel recommended (review is the bottleneck) |
| 2 | FND-04, UX-02, SRC-01, SRC-02, SRC-04, PLY-01, FAV-01, FAV-02, PWA-02, PWA-05, QA-03, DEP-01 | Prioritize SRC-01/02, PLY-01 (M1 path) |
| 3 | UX-01, UX-06, SRC-03, SRC-05, SRC-06, SRC-07, VOD-04, PLY-02, PLY-04, PWA-03, PWA-04, QA-02 | |
| 4 | SRC-08, SRC-09, SRC-10, LIV-01, VOD-01, PLY-03, SCH-01 | **M1 checkpoint after LIV-02** |
| 5 | LIV-02, LIV-04, VOD-02, SER-01, EPG-01, SCH-02, UX-04 | |
| 6 | LIV-03, VOD-03, SER-02 | |
| 7 | SER-03, FAV-03, UX-03 | Release candidate |
| 8 | DEP-02 | Manual with the user |

Rule: within a wave, the coordinator first picks the stories of the active milestone and of the critical path (see `BACKLOG.md`).

## 4. Checkpoints with the user
1. **After S-00:** ADR-010 decision (proxy/native/accept limitation).
2. **After FND-03:** visual validation (AppShell screenshots in dark/light, 3 sizes) and MUI bundle (ADR-003).
3. **After M1:** demo with the real source; go/no-go for M2.
4. **Before DEP-01 and every relevant public release.**
5. **After DEP-02:** v1.0 release approval.

## 5. Risks

| # | Risk | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| RK1 | User's provider is HTTP-only/without CORS → nothing plays in the browser | **High** | **Critical** | S-00 first; clear diagnostics; PRX-01 / NAT-01 |
| RK2 | AC-3/MP2 audio with no sound in Chrome | Medium | High | Detection + message; prefer HLS (often AAC); document |
| RK3 | iPhone: different MMS/fullscreen/background behavior | Medium | Medium | Native HLS engine on Safari; real tests in DEP-02 |
| RK4 | Huge catalogs (100k+ VOD) exhaust memory on weak phones | Medium | Medium | Worker, bulk writes in batches, per-category sync as plan B |
| RK5 | Variations between Xtream panels | High | Medium | Tolerant schemas, fixtures for several variants |
| RK6 | Safari deletes data of non-installed sites | Medium | Medium | `persist()`, encourage installation |
| RK7 | MUI weight above budget | Low | Low | Measure in FND-03; Radix alternative |
| RK8 | Changes to free plans (Pages) | Low | Low | Static app portable to Cloudflare/Netlify in minutes |
| RK9 | Misuse of the app with unauthorized lists | Medium | Medium (reputational) | No bundled lists, legal notice, no list directories/search |
| RK10 | Parallel agents with conflicting changes | Medium | Medium | Serialized-files policy, worktrees, review (`AGENT_WORKFLOW.md`) |

## 6. Assumptions and open questions
| # | Question | Current assumption | Impact if wrong |
|---|---|---|---|
| Q1 | Does the user's provider support HTTPS/CORS? | Unknown → S-00 | See RK1 |
| Q2 | Main target devices? | Android + desktop; iPhone secondary | Test order in DEP-02 |
| Q3 | Is a public repo acceptable? | Yes (code without secrets) | If not: Cloudflare Pages (accepts private repos) |
| Q4 | Languages besides pt-PT? | **Answered:** English + pt-PT, selectable (ADR-015) | — (UX-06) |
| Q5 | Use the app on an Android TV/box? | Not in the MVP (UX-05 later) | Move UX-05 up |
| Q6 | Name/brand | "Simple IPTV" provisional | Only texts and icons |

## 7. How to start execution (phase 2)
Suggested request to Claude Code:
> "I approve ADR-001 to ADR-009 and 011 to 013. I authorize git init and dependency installation. Run wave 0 (FND-01) following `docs/AGENT_WORKFLOW.md` and prepare the S-00 spike."

Then, per wave or per milestone:
> "Run milestone M1 following the workflow; stop at the checkpoints."
