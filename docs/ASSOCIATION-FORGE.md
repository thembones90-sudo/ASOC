# Association Forge

GM authoring research, inside **LOAD SHELL → Game Creator**, immediately below Final Solution. Expand **ASSOCIATION FORGE**, then explicitly fetch. The research input prefills from Final Solution; USE FINAL resets a manually edited research word. The final answer is never changed by research.

## Server setup

Set the secret `WORD_ASSOCIATIONS_API_KEY` in the server's environment (Railway service Variables in production), then restart/redeploy. Obtain a subscribed key from the official provider. Do not put a key in source, public config, browser storage or screenshots. There is no client-side key setting. No new LLM dependency is used.

`GET /api/word-associations?word=phase` requires the existing `x-gm-token` authentication; players and unauthenticated callers are refused. Other methods are rejected. No gameplay/WebSocket state or player UI is changed.

`association-provider.js` calls the official HTTPS JSON API, English, `type=stimulus`, maximum 300 results: words that evoke the researched word. See [official API contract](https://wordassociations.net/en/api-doc). Provider weights are displayed as supplied, not converted into probabilities. Missing weights/POS stay unknown. Multi-word results and the queried word itself are excluded, matching ASOC's one-word rule. Repeated words merge reported POS and retain the maximum supplied weight. No fabricated domain/synonym classifications.

## Bounds and caching

Normalized lowercase words share a bounded 256-query, 24-hour in-memory cache. Concurrent requests for the same query share one upstream call. Cache is disposable on restart and not stored with private games. New upstream requests have a global 1.5-second minimum interval and at most two concurrent calls; cached queries do not spend quota. A request times out at 10 seconds and responses are limited to 1 MiB. Browser requests time out at 15 seconds. Failures are not cached and upstream URLs/errors/bodies are never exposed or logged. No automatic retries.

## Selection and board safety

Select at most four words, then press A5/B5/C5/D5 on a selected candidate. Empty slots assign directly; occupied slots require a named REPLACE confirmation. Locked Automatic Game Maker columns stay locked. A confirmation is discarded if the draft or target changes while the prompt is open. Assignment calls the existing `setCreatorField`, which updates preview, readiness and the normal browser-local draft. Existing clues, theme, background, metadata and final answer remain intact. Review clues after changing a solution.

Search, POS filtering and strongest-first/alphabetical sorting are local and free of API calls. RED only removes a simplistic suffix-family match. PURPLE additionally removes maximum-weight 100 links. These are deliberately conservative research aids, not synonym detection, polysemy detection or validated puzzle difficulty. Multiple POS are shown as evidence only. No automatic A1–A4 generation or board-building is introduced.

Research state is transient for each open draft; assignments persist through the creator's existing save/autosave/restore workflow. Failed fetches retain prior results and selections. Successful replacement fetches reset selections. Both the results source word and current board final are displayed to avoid mixing research contexts.

## Verification

`node tests/hardening-association-provider.js` — provider normalization, cache, coalescing, limits, timeouts, malformed responses and secret-safe failures; authenticated route and player refusal.

`node tests/hardening-association-forge-browser.js` — actual creator with controlled provider responses, selection/assignment/replacement safety, preserved board, preview, drafts, paste, errors and responsive layout.

These tests use controlled upstream fixtures; they do not establish that a subscription key is configured or that live external calls work. A real keyed PHASE lookup remains a setup smoke test.
