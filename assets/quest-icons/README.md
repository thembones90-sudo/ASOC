# ASOC Quest Sigils

`quest-sigils.svg` is the expanded design-source sprite. The app ships the optimized runtime sprite at `assets/ui/quest-icons.svg`. Use a runtime symbol with:

```html
<svg class="quest-icon quest-icon-forge" viewBox="0 0 64 64" aria-hidden="true">
  <use href="assets/ui/quest-icons.svg#quest-forge"></use>
</svg>
```

Available IDs:

- `forge`, `active`, `archive`, `daily`
- `bounty`, `time`
- `private`, `classified`, `public`
- `complete`, `failed`, `purge`
- `attendance`, `threefold`, `lastword`

Suggested hierarchy:

- Navigation: `forge`, `active`, `archive`, `daily`
- Contract metadata: `bounty`, `time`, and the matching visibility icon
- Contract state: `active`; replace with `complete` or `failed` after resolution
- Daily ledger: `attendance`, `threefold`, `lastword`, with `purge` for the meta-contract

Load `css/quest-icon-system.css` after `css/asoc.css`. It sizes and lights each sigil according to its Quest Ledger context on both GM and player screens.
