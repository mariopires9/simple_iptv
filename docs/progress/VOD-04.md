# VOD-04 — Movie/series classification in M3U sources

**Status:** Done (2026-10-29) · agent `media-engineer` (worktree) · reviews: `/code-review`, security review

## Delivered
- Classifier (`src/providers/m3u/classify.ts`, in the worker parser), first match wins: URL path (`/movie/`, `/series/`, `/live/`) → audio stays live → group rules table (`DEFAULT_M3U_RULES`: leading VOD keyword "VOD/Movies/Filmes/Películas/Series/Séries/TV Shows" vs live words; "24/7"-style words always live) → `media="true"` → file extension (mp4/mkv/avi/mov/m4v) → strong episode marker (S01E02, S01 E02, T01E02, "Temporada 1 Episódio 2", "Season 1 Episode 2"; weak `1x02` only with another VOD signal) → otherwise Live. Rules are a swappable table (no user setting). Documented in ARCHITECTURE.md.
- Grouping: one series row per show (normalised name + group without season tokens), seasons/episodes stored in `seriesDetails` in the same catalogue transaction; episode ids from the entry hash (stable across re-imports). SER-02 AC4 now fully met for M3U (seasons, resume, next episode).
- One-time key migration (`src/core/db/repos/regroup.ts`) moves pre-VOD-04 per-entry series history/favorites to the grouped keys, idempotent, same source only.
- Sync stats/progress count grouped episodes.

## Measurements (Node, noisy — other agents running)
Parse + build 100k: ~+21–30 % (classification ~+12 %, the rest is grouping), linear. Real M3UPT list (930 entries, scratch only): 442 live, 422 movies, 3 shows.

## Review
`/code-review` (medium): 10 findings; 9 fixed with tests (key migration, leading VOD keyword, marker-first names in generic groups, season tokens in groups, episode counts, bare "e"/NFC markers, single marker parser, single audio set, dead `classifyUrl`). Security review: no findings; its correctness note (`groupKeywords` own properties) fixed.
Known limits: episode titles not in the search index; date-only shows (e.g. "Show - 22/10/2026") listed as movies; EXTINF duration unused.
