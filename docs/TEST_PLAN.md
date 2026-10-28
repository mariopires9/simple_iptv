# Test and quality plan

## 1. Pyramid and tools
| Level | Tool | Target | Where it runs |
|---|---|---|---|
| Unit | Vitest 5 + jsdom | Parsers, normalizers, schemas, redaction, engine selection, resume/zapping logic | Local + CI |
| Component | Testing Library | Forms, lists, player (media mock), states | Local + CI |
| Integration | Vitest + MSW + `fake-indexeddb` | Xtream client → worker → Dexie; M3U import → index | Local + CI |
| Property | fast-check | M3U parser never throws; redaction never lets secrets through | CI |
| E2E | Playwright 1.64 (Chromium, WebKit, Firefox; viewports 390×844, 820×1180, 1440×900) | Critical flows, PWA, offline | CI |
| Accessibility | `@axe-core/playwright` + manual (NVDA, VoiceOver) | All routes | CI + manual |
| Performance | Lighthouse CI, `size-limit`, Playwright traces, Vitest benchmarks (`bench`) | NFR-01..05 | CI (budgets) |
| Security | `npm audit`, licenses, ESLint security rules, XSS tests, `/security-review` | Dependencies and code | CI + per sensitive story |
| Manual | Checklist §5 | Real devices | Before release |

Minimum coverage: 80 % lines in `core/`, `providers/`, `player/select*`; no global target (avoid empty tests).

## 2. Test data
- `fixtures/xtream/`: `auth-ok.json`, `auth-fail.json`, `expired.json`, `live-streams-variantA/B/C.json`, `series-info-episodes-array.json`, `series-info-episodes-object.json`, `short-epg.json` (base64), numbers as strings, `null` fields.
- `fixtures/m3u/`: `basic.m3u`, `attributes-edge-cases.m3u`, `crlf-bom.m3u`, `malicious.m3u` (`javascript:` URLs, `<script>` in names, huge attributes), generator for 50k/200k entries.
- `fixtures/xmltv/`: small, `.gz`, entities/CDATA, time zones.
- Streams: generated with ffmpeg (testsrc + sine), own license; local test server with toggleable CORS and "slow"/"error 500"/"redirect 302" modes.
- **Never** real provider data or URLs in fixtures or CI logs.

## 3. Test matrix by area
| Area | Essential cases |
|---|---|
| M3U parser | quoted/unquoted attributes; commas in the name; EXTGRP; BOM; CRLF; empty; no `#EXTM3U`; invalid URL; 50k performance; partial streaming (chunk splits a line in the middle) |
| Xtream | URL normalization; auth ok/failed/expired/banned; 401/403/404/500/timeout; invalid JSON; HTML instead of JSON; `allowed_output_formats`; `https_port` |
| Network errors | mapping `TypeError`→`blocked` with mixed-content vs cors hint; abort; offline |
| Vault | encrypt/decrypt; unique IV; non-exportable key; wipe; lost key → recovery flow |
| Persistence | atomic replaceForSource; cascading removal; favorites persist after resync; v1→v2 migration (when it exists) |
| Player | `selectEngine` matrix (container × capabilities × browser); destroy without leaks (listener/ObjectURL count); .ts→.m3u8 fallback; AC-3 codec error; retry with backoff; fast zapping aborts requests |
| EPG | base64 UTF-8; timestamps/time zones; missing EPG; (v1.1) XMLTV gz, window, matching |
| Search | accents; prefix; fuzzy; channel numbers; 100k < 100 ms |
| PWA | installability (Lighthouse); precache; offline opens the app; **Cache Storage without URLs containing credentials**; update prompt does not interrupt playback |
| Responsiveness | 3 viewports × main routes (optional visual regression screenshots) |
| A11y | axe per route; keyboard-only flow; visible focus; token contrast |
| Security | malicious M3U does not execute code; CSP present; `no-referrer`; redacted logs (snapshot); no requests to unexpected domains (Playwright `page.on('request')` with allowlist) |

## 4. Measurable criteria (targets)
| Metric | Target | Measurement |
|---|---|---|
| Repeat startup (SW active) | Usable screen < 1.0 s (mid-range Android) / < 0.5 s desktop | Playwright + `performance.mark('app-ready')` with 4× CPU throttling |
| First load | LCP < 2.5 s; TBT < 200 ms | Lighthouse mobile |
| Initial JS | ≤ 200 KB gz | size-limit |
| Screen change (local data) | < 150 ms to content | `performance.measure` |
| Scroll 20k channels | 0 long tasks > 50 ms; ≥ 55 fps | Playwright trace |
| Filter/search | < 100 ms (100k items) | bench |
| M3U parse 50k | < 5 s mid-range Android (≈ < 1.5 s desktop with 4× throttling as a proxy) | bench |
| Zapping (local test stream) | first frame < 1.5 s | E2E (`loadeddata`) |
| Zapping (real provider) | record p50/p75 — **no guaranteed target** | manual DEP-02 |

## 5. Manual checklist per device (DEP-02)
For each: Android Chrome · iPhone Safari (browser) · iPhone installed PWA · Desktop Chrome · Desktop Firefox · (macOS Safari if available).
1. Install the app / add to home screen; correct icon and name; opens in standalone mode.
2. Add a real source; consistent diagnostics.
3. Play 5 channels (TS and HLS if available); measure time to first frame; is there sound?
4. Fast zapping 10×; no crash, no duplicated audio.
5. Fullscreen, rotation, PiP, Android back button.
6. Movie: play, seek, exit, resume.
7. Series: next episode.
8. Search; favorites; recents.
9. Airplane mode: app opens, correct messages.
10. App update with playback in progress.
11. Delete all data.
12. Screen reader (TalkBack/VoiceOver) in the zapping flow.
Record in `docs/progress/compatibility-matrix.md` (date, device, OS, browser, result, notes). **Only what has been tested is declared compatible.**

## 6. Quality gates
| Gate | When | Blocks merge/progress if |
|---|---|---|
| CI | Every PR/commit | lint, typecheck, tests, build, audit high, licenses |
| Review | Stories ≥ 3 pts or sensitive | unresolved critical/high findings |
| E2E + axe | From QA-02 onwards | failure in any browser |
| Budgets | From QA-03 onwards | Lighthouse/size-limit below targets |
| Release | Before v1.0 | DEP-02 incomplete or NFR without measurement |
