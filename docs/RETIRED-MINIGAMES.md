# Retired mini-games

Šibicar and Unstable Concoction are retired from both GM and player libraries.
Their menu cards and client script/style imports are removed. The GM dispatcher
no longer exposes their launches or opens overlays for historical events.

The server rejects legacy Šibicar sync/start/pick and Unstable Concoction spin
frames with `MINIGAME_RETIRED`, including requests from the GM. Cached clients
cannot restart either game. Stored history, balances and tribute debts are not
deleted. Previously committed pending Concoction results retain their recovery
path; retirement prevents new spins, not fulfillment of an existing obligation.

Regression coverage: `tests/gm-minigames.js` checks the GM entry points;
`tests/black-market-tombola.js` exercises legacy requests against real authenticated
GM/player sockets and checks unchanged balances; `tests/tombola-browser.js`
checks both real menus and confirms FATEBREAKER remains playable.
`tests/sibicar-browser.js` now verifies retirement in both libraries rather
than expecting the removed game to launch. Historical engine/ledger tests
remain in place to guard compatibility with stored records.
