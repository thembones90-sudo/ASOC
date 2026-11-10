# Holiday mode

Open the GM Game Library and select **Holiday mode**. Current library games were confirmed completed by the GM and receive a one-time completed baseline. New games added afterward start unplayed.

1. Add the 17 new games using the existing New Game or Excel import controls. Include four clues and one solution per column, a final solution, story and available background.
2. Create the 17-day calendar (11Ã¢â‚¬â€œ27 November 2026), then fill with unplayed games or select an explicit unique game for each date.
3. Save, check the saved schedule, then activate. Only the authenticated GM can inspect or change the queue. Activation rejects incomplete, repeated, missing, completed or uncertain games.

The server loads at 12:50 Belgrade time, summons and nudges everyone at 12:55, starts with five connected votes at 13:00 (or when the fifth arrives before 13:05), and cancels at 13:05 if fewer than five. An unattended server restart never launches missed days late. Failed signups do not mark games completed.

During an attended game SPECTRA adjudicates without GM review. Exact normalized answers are accepted automatically; uncertain spellings and derived forms are rejected. Multiple target markers ask the player to clarify and retry, without a verdict or review card. Activating Holiday mode clears old review cards. Normal-mode review rules remain unchanged. A correct final completes the game without a GM click. Timer expiry uses the existing loss/scoring path. After an eight-second result hold, the server shows the story, allows a timed rating period and Recount, then returns to the casual menu. The plan stops after every dated slot is resolved. The GM can disable it earlier.

WOMF is hidden and cannot gain charges or be opened during Holiday mode. The existing charge is preserved and restored when the mode is disabled or finishes. Score penalties for failed fields still apply; failure metadata is separate from the paused WOMF counter.

Game history and the plan live in `ASOC_DATA_DIR/holiday-games.json`, use the existing durable persistence layer and survive restarts. Match completion is stored independently of scoreboards and game titles. Completed games never return to automatic selection. Unknown historical records require GM review; manual library Load remains available for intentional replay.

Verification: `tests/holiday-simulation.js`, `tests/hardening-holiday-wire.js`, `tests/holiday-browser.js` and existing SPECTRA schedule/automatic regressions. The simulation covers 17 dated slots and restart/cancellation paths; the wire test runs a complete scheduled no-GM session with five actual WebSocket clients; browser coverage exercises the real GM calendar and player access restrictions.

Full browser rehearsal: run `node tests/hardening-holiday-wire.js` for the winning path, or set `ASOC_HOLIDAY_TEST_LOSS=1` for timeout loss. Both use five voting clients, a real player browser and no connected GM. They verify result, story, working rating buttons, Recount, removal of all post-game overlays, and successful chat after automatic AMUSE return.
