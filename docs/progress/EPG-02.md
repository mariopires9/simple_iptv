# EPG-02 + EPG-03 — XMLTV import and channel ↔ EPG matching

**Status:** Implemented (2026-10-30), pending review · agent `media-engineer` (worktree, branch `story/EPG-02`)

## Delivered
- **Import (EPG-02)** — worker task `importEpg` (`src/worker/tasks.ts` → `src/providers/xmltv/import.ts`). URLs: the manual guide address from the list settings first, then the list header's `url-tvg`/`x-tvg-url` (first that works). Download through `fetchStream` with `purpose: 'epg'` and the list's data rewriter (`rewritersForSource(...).data`, PRX-01).
- **Decompression** — sniffed from the first bytes (not the extension): gzip → `DecompressionStream('gzip')`; xz → `xz-decompress` (WASM, loaded with a dynamic import into its own worker chunk, 20.4 kB raw; not in the initial JS); otherwise plain XML. A body the browser already decoded (`Content-Encoding: gzip`) is not decoded twice.
- **Parser** — `src/providers/xmltv/parser.ts`, streaming SAX-style tokenizer (no DOMParser): `<channel>`/`<display-name>`, `<programme>` with the first `<title>`/`<desc>`. Predefined XML entities and numeric references decoded, unknown `&name;` kept literally, CDATA verbatim; text only (rendered as React text, never HTML). Lengths capped (title 300, desc 1000). Missing `stop` → next programme's start on that channel. XMLTV times with optional offset (none = UTC).
- **Window and storage** — only programmes overlapping −2 h … +48 h are kept; rows go to the existing `epgPrograms` table (**no schema change**; `channelEpgId` = matched channel's item key) in batches of 5 000 while the feed streams (bounded memory). The first batch replaces the source's guide; a feed that fails before it leaves the stored guide untouched, one that breaks off mid-stream leaves what was written.
- **Refresh/purge (AC4)** — due after 12 h (1 h after a failure); every import first deletes programmes (any source) that ended before the window, and replaces the source's guide. Triggered when Live opens for an M3U list with a guide URL, and by "Update guide" in the list settings.
- **Matching (EPG-03)** — `src/providers/xmltv/match.ts`: exact `tvg-id`, then `tvg-id` ignoring case (unique), then normalized name (no accents, lowercase, without HD/FHD/UHD/4K/HEVC/1080p…, "+1", "PT:", "PT |", "[PT]", punctuation/spaces) against display names and the id without its country suffix. A name fitting several XMLTV channels is not associated. Coverage (channels with ≥ 1 programme in the window / live channels) stored in `source.epgStatus`.
- **UI** — now/next reuses `NowNext` and the channel-row "Now" via `createXmltvEpgService` (`src/features/live/xmltvEpg.ts`, same `EpgService` interface as EPG-01). List settings (M3U): guide address (credentials-bearing URLs rejected), status, coverage, matching note, "Update guide" (`src/features/sources/EpgSettings.tsx`). Diagnostics shows the guide status and % of channels with EPG. Strings in `src/i18n/{en,pt-PT}/sources.ts`.

## Dependency
`xz-decompress` **0.2.3** (exact pin), MIT (bundles xz-embedded, public domain/0BSD, and walloc, MIT), no dependencies, 52 kB unpacked / 20.4 kB in the built worker chunk. `npm run licenses` ok; `npm audit --audit-level=high` clean (4 pre-existing low findings in the PWA tooling). Supports xz CRC32/CRC64 checks (verified with `xz` 5.x defaults in Node 24); SHA-256-checked files are not supported (reported as `corrupt`).

## AC status
| AC | Status | Evidence |
|---|---|---|
| EPG-02 AC1 stream + gzip/xz + SAX in worker | Met | `import.test.ts` (plain, gzip, xz bodies), `parser.test.ts` |
| EPG-02 AC2 −2 h…+48 h only | Met | `import.test.ts` "stores only matched programmes inside the window" |
| EPG-02 AC3 100 MB, UI responsive, worker < 200 MB | Partly measured — browser measurement pending | see below |
| EPG-02 AC4 12 h refresh purges finished | Met | `import.test.ts` "purges finished programmes on refresh" |
| EPG-02 AC5 entities/CDATA as text | Met | `parser.test.ts` |
| EPG-03 AC1–AC3 | Met | `match.test.ts` (table of 60 pairs) |
| EPG-03 AC4 % in diagnostics | Met (pure text helper; no new component test) | `DiagnosticsScreen.tsx`, `epgStatus.ts` |
| EPG-03 AC5 manual association (Could) | Not done | would need a per-channel override store; left out to keep scope |

## Measurement (AC3) — Node only
Node v24.18.0, Intel Core Ultra 7 265H, WSL2; script in the agent scratchpad (not committed). Synthetic 100.8 MB XMLTV (2 000 channels, 228 000 programmes with ~290-char descriptions, all inside the window → 200 000 rows), fed to parser + matcher in 64 kB text chunks, rows released every 5 000 as the import does (IndexedDB writes not included):
- 2.1–2.4 s total; longest single chunk 10–12 ms;
- V8 heap used peak 109 MB (72 MB with `--max-old-space-size=32`, i.e. the live set is small and the rest is collectable garbage); process RSS grew from 84 MB to 263 MB (includes the generator's own 100 MB of strings and Node's TypeScript transform).
Not yet measured: a real browser worker (Chrome/Firefox DevTools memory) with IndexedDB writes. The UI-thread responsiveness follows from the design (all work in the data worker) but has not been profiled.

## Risks / follow-ups
- **CSP and WebAssembly:** the production CSP (`build/csp.ts`) has `script-src 'self'` without `'wasm-unsafe-eval'`. If a browser applies the page's policy to the module worker, xz decoding fails; it is then reported as `xz-unavailable` (gzip/plain unaffected). Needs a check in a real build and, if needed, adding `'wasm-unsafe-eval'` to `script-src` (coordinator decision; not changed here).
- Name fallback uses only `<channel>` elements seen before the first programme.
- Programmes are duplicated per matched channel (e.g. HD and SD variants with the same `tvg-id`).
- Xtream lists keep the short EPG (EPG-01); their `xmltv.php` is not imported.
