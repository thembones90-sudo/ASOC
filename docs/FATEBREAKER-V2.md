# FATEBREAKER V2 delivery

Verified 2026-10-14, Europe/Belgrade. Local feature branch `codex/asoc-tombola`.

## Economy and ending

| Outcome | Values × quantities | Total |
| --- | --- | --- |
| 17 Blessings | +2×4, +3×5, +5×5, +8×3 | +72 SC |
| 17 Curses | −2×3, −4×4, −6×5, −10×4, −15×1 | −107 SC |
| THE GRAIL | +50×1 | +50 SC |
| Blood Tribute | 1 field | No SC change |

Every new round has exactly 36 randomly shuffled, concealed outcomes.
Grail continues the round; Blood immediately ends it, seals unopened fields,
freezes further SC transactions and creates one existing Black Market obligation.
The theoretical full-board net is +15 SC. Random Blood stopping implies +7.5
expected net and 50% Grail-before-Blood probability, before balance-floor effects.

Only GM can open/start/restart/cancel. Signup remains two minutes, max 10;
players cannot join after start. Each full cycle randomizes the roster and
gives everyone exactly one move. There are no wagers, fees or automatic restarts.

## Visuals

Emerald blessing glint, crimson curse crack, black/crimson Blood pulse and
golden Grail rays/chalice are distinct. The Grail also shows a shared centered
THE GRAIL / +50 SC announcement for at most 1.6 seconds. It cannot intercept
clicks or delay turns. Reduced motion suppresses movement; the announcement
still expires. Curse tiles show actual deducted SC, including zero-floor capping.
Approved board/tile assets and layout are unchanged. No extra audio is introduced.

## Verification

- `npm run test:fatebreaker`: all three engine, real-socket and desktop/mobile
  browser suites pass. Covers exact quantity/value totals, hidden outcomes,
  Grail +50 once, Blood endings at positions 1/18/36, one debt, frozen board,
  GM-only controls, restart/reconnect, ledger attribution/idempotency, all four
  animations, shared readable Grail banner, reduced motion and real tribute upload.
- Passing regressions: gm-minigames, black-market-tribute, lockdown,
  production-readiness, battle-timer-tick, poison-privacy, chat-link-preview,
  hardening and reinforcement.
- 10,000 securely shuffled simulations: +7.4193 mean theoretical stopped-round
  net, 49.57% Grail-before-Blood. These are observations, not forced results.
- Node syntax, package JSON, real app startup and `git diff --check` pass.
  This plain Node/static app has no separate build script.
- Board SHA-256 remains
  `99769F12F5C8434D9923F9F3894EFAE6EDED4E31BBB38906F9BFC46DEABCEF2C`.
  Tile SHA-256 remains
  `9B9AE07BA608607D2882F65D9226704B481060DFFD0B779566B794AF12DA4C4E`.

## Files changed

`tombola.js`, `tombola-server.js`, `js/tombola-ui.js`, `css/tombola.css`,
`index.html`, `join.html`, `package.json`, `tests/tombola.js`,
`tests/black-market-tombola.js`, `tests/tombola-browser.js`,
`tests/lib/browser-harness.js`, `docs/TOMBOLA-QA.md`, and this report.
The browser harness exposes only its local test directory, never a live API
for concealed outcomes. Core chat, association, wallets and Black Market
implementation are not edited.

## Compatibility and release limitations

Already-started V1 saves keep their assigned inventory and original ending
rule; no rewards or outcomes reroll mid-game. Unstarted legacy lobbies upgrade
when GM starts. All newly created rounds are V2. This is the sole intentional
legacy exception. Internal protocol/storage IDs remain compatible.

No V2 focused test failures remain. Previously documented baseline failures
in black-market-tribute-wire and ritual-pipeline are unrelated and not changed.
No production accounts, balances or sessions were modified. Not pushed or
deployed as part of this mission.
