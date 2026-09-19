# CODEX TASK — MY SINDRAGOSA LITERAL ASSET IMPLEMENTATION

## Mandatory orientation first

Before touching code, read these in order:
1. `AGENTS.md`
2. `.codex/PROJECT_HANDOFF.md`
3. the relevant sections of `README.md`
4. `HANDOFF.md`

Do not begin implementation until you understand the board invariants, server-authority model, Little Hero theme system, bounds rule, foreground/background separation rule, and the sacred rule that player themes never touch the authored game board.

Repo: thembones90-sudo/ASOC
Branch: codex/my-sindragosa-literal-assets

## Goal
Replace the current CSS approximation for the MY SINDRAGOSA theme with the literal six PNG assets committed under:
`assets/themes/my-sindragosa/`

The user explicitly wants the generated pictures themselves used as the skins in their corresponding places. Do NOT redraw, approximate, reinterpret, or replace them with gradients/SVG pseudo-art.

## Exact asset mapping
- `main-shell.png` → player outer shell / MY SINDRAGOSA game-screen atmosphere
- `battle-comms.png` → player Battle Comms container
- `little-hero-status.png` → Little Hero Status module
- `player-message.png` → player-side chat message card
- `gm-message.png` → GM-side chat message row
- `theme-selector.png` → MY SINDRAGOSA theme selector / selected option

## Existing selectors to target
- `#game-screen[data-player-theme="my-sindragosa"]`
- `#game-screen[data-player-theme="my-sindragosa"] .battle-comms-lobby`
- `#game-screen[data-player-theme="my-sindragosa"] .detainee-status-module`
- `.battle-comms-lobby .chat-message[data-theme-id="my-sindragosa"]`
- `.gm-module-chat .gm-chat-message.discord-row[data-theme-id="my-sindragosa"]`
- `.theme-select[data-theme-id="my-sindragosa"] .theme-select-toggle`
- `.theme-option[data-theme-id="my-sindragosa"].selected`

## Non-negotiable implementation rules
1. Use the literal PNGs above as CSS image assets. No procedural substitute.
2. Remove/replace the current MY SINDRAGOSA CSS approximation added around commit `c41b735`.
3. Preserve all live HTML content, controls, usernames, timestamps, verdicts, buttons and interactions above the image skin.
4. Do not flatten functional text/UI into screenshots. The PNG is the visual skin; live content remains live.
5. Keep every decorative skin clipped to its own component bounds with `overflow:hidden` where needed.
6. NEVER allow theme art to escape component bounds.
7. NEVER recolor, tint, overlay, frost, or otherwise modify the authored game-board artwork or clue elements.
8. Background/container art and chat-card art are separate assets. Do not let them visually merge.
9. Preserve verdict styling/logic and player accent logic.
10. Do not change server/scoring/gameplay behavior.

## Sizing / fitting expectation
Treat each PNG as the authoritative visual reference for its corresponding component. Use background sizing/positioning, pseudo-element framing, and inner padding only as needed to fit the existing responsive boxes while preserving the art's proportions and readable live UI. Prefer `background-size: cover` or carefully tuned `100% 100%` only when it best reproduces the asset without cropping critical ornamentation.

The selector asset is a preview treatment, not a reason to enlarge or break the existing compact dropdown.

## Files likely involved
- `join.html`
- `css/asoc.css`
- only touch JS if genuinely required for asset/theme plumbing; it should not be necessary.

## Acceptance criteria
- Selecting MY SINDRAGOSA visibly uses the six committed PNG skins in their six exact roles.
- The result clearly resembles the generated assets themselves, not a CSS-inspired approximation.
- No decoration crosses its component boundary.
- Player message cards remain visually distinct from the Battle Comms background.
- The actual game board remains completely untouched.
- Existing chat verdict states still render correctly.
- Existing theme switching still works.

## Validation
Run:
- `node --check` on any changed JS files
- `git diff --check`
- `npm test`

Expected regression result:
`ALL ASOC REGRESSION TESTS PASSED`

## Delivery
Commit the implementation to this branch and push it. Do not merge directly to `main`. Leave the PR ready for review with a short summary of what changed and any responsive compromises made.
