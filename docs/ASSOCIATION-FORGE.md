# Association Forge

GM authoring research, inside **LOAD SHELL → Game Creator**, immediately below Final Solution. Expand **ASSOCIATION FORGE**, then explicitly fetch. The research input prefills from Final Solution; USE FINAL resets a manually edited research word. The final answer is never changed by research.

## Server setup

Default provider: **Datamuse**, currently keyless. No account, API key, new environment variable or LLM dependency is required. `WORD_ASSOCIATIONS_API_KEY` is no longer used by this feature. The provider has announced future authentication changes in 2027; consult its current official documentation before adding credentials. Never place a future key in client scripts or browser storage.

`GET /api/associations?word=phase&mode=associated` requires the existing `x-gm-token` authentication; players and unauthenticated callers are refused. Modes are `associated` (default) and `means_like`; invalid modes and other HTTP methods are rejected. `/api/word-associations` remains a compatibility alias for the same Datamuse service. No gameplay/WebSocket state or player UI is changed.

`association-provider.js` owns validation, bounded async transport, cache/coalescing and rate protection. `datamuse-provider.js` isolates the official URL/schema: `https://api.datamuse.com/words?rel_trg=phase&max=100&md=p` for ASSOCIATED, or `ml=phase` instead of `rel_trg` for MEANS LIKE. See the [Datamuse API contract and attribution](https://www.datamuse.com/api/). The default English vocabulary is used. Scores are preserved exactly and rank candidates within a query; they are not percentages, calibrated association strengths, or comparable across modes. Metadata tags `n`, `v`, `adj`, `adv` map to real POS; unknown/absent metadata stays unknown. Multi-word results and the queried word itself are excluded. Repeated words merge POS and retain the highest supplied score.

The provider contract is `{ id, source, buildUrl(word, mode), normalizeResponse(data, sourceWord) }`. A future Twinword adapter can implement that contract and be passed to `createAssociationProvider({provider})` without changing the creator. Server-only `configureRequest(url, init)` can inject future documented credentials; no authentication convention has been invented before Datamuse documents one. No Twinword integration or mode-comparison UI is shipped.

## Bounds and caching

Normalized lowercase word + query mode + provider ID form the key of a bounded 256-query, 24-hour in-memory cache. `PHASE`, `phase` and ` Phase ` share a cache entry within the same mode; ASSOCIATED and MEANS LIKE never share an entry. Concurrent identical queries share one upstream call. Cache is disposable on restart and not stored with private games. New upstream requests have a global 1.5-second minimum interval and at most two concurrent calls; cached queries do not spend quota. A request times out at 10 seconds and responses are limited to 1 MiB. Browser requests time out at 15 seconds. Failures are not cached and upstream URLs/errors/bodies are never exposed or logged. No automatic retries, polling, keystroke fetching or mode-change fetching.

## Selection and board safety

Select at most four words, then press A5/B5/C5/D5 on a selected candidate. Empty slots assign directly; occupied slots require a named REPLACE confirmation. Locked Automatic Game Maker columns stay locked. A confirmation is discarded if the draft or target changes while the prompt is open. Assignment calls the existing `setCreatorField`, which updates preview, readiness and the normal browser-local draft. Existing clues, theme, background, metadata and final answer remain intact. Review clues after changing a solution.

Search, POS filtering and score-first/alphabetical sorting are local and free of API calls. RED removes simple suffix-family variants. PURPLE additionally ranks multiple-POS candidates before single-POS/unknown candidates, retaining the selected sort inside each group. These deliberately conservative aids cannot reliably identify synonyms, polysemy, technical domains or objective puzzle difficulty. Multiple POS are evidence only. Datamuse scores are not treated as a fixed 0–100 scale. No automatic A1–A4 generation or board-building is introduced.

Research state is transient for each open draft; assignments persist through the creator's existing save/autosave/restore workflow. Failed fetches retain prior results and selections. Successful replacement fetches reset selections. Both the results source word and current board final are displayed to avoid mixing research contexts.

## Verification

`npm run test:association-forge` runs provider and browser suites. `node tests/hardening-association-provider.js` covers both documented query modes, real schema/score/POS normalization, unknown metadata, mode-sensitive cache/coalescing, limits, timeouts, malformed responses and secret-safe failures; authenticated route, compatibility alias and player refusal.

`node tests/hardening-association-forge-browser.js` — actual creator with controlled provider responses, selection/assignment/replacement safety, preserved board, preview, drafts, paste, errors and responsive layout.

Fixture tests do not depend on the internet. `ASOC_TEST_DATAMUSE_LIVE=1 node tests/association-datamuse-live.js` opts into real Datamuse calls through a temporary local ASOC server and actual GM browser. The live test never writes to production.

Verified 2026-10-16: both fixture suites PASS; existing Forge AI, creator and XLSX round-trip suites PASS. Real PHASE smoke PASS with no key: 29 associated single-word candidates and 99 means-like candidates. The actual creator assigned four returned candidates to A5–D5, preserved PHASE and board data, updated preview, and served a repeat from cache. Counts/rankings may change with provider data. Samples observed: ASSOCIATED — PHASES, AMPLITUDE, MODULATION, DIAGRAM, CLINICAL, TRIALS; MEANS LIKE — STAGE, SEGMENT, PART, PERIOD, SECTION, TRANCHE.
