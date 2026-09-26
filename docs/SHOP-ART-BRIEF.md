# SHADOW MARKET — item list + art brief for Skynet

Everything below is **cosmetic only**. Shadow Coin (SC) never buys gameplay.
Prices are V1 placeholders.

## Part 1 — The shop, as it stands (48 items)

### Avatar looks (drawn live in CSS, no art needed)
| Item | SC | What it does |
|---|---|---|
| NOIR | 3 | Monochrome interrogation-room contrast |
| SPECTRAL | 5 | Violet afterimage |
| DAMAGED | 5 | Scratched, cracked portrait |

### Avatar effects (live CSS)
| Item | SC | What it does |
|---|---|---|
| VOID EYE (5 tiers) | 4 / 6 / 8 / 10 / 14 | Glow → pulse → particles → glitch → Final-solve animation |
| SMOKE | 6 | Grey smoke curling off the frame |
| FIRE | 8 | Portrait engulfed in slight flames, embers |
| FROST | 8 | Cold light, creeping rime |
| CORRUPTION | 10 | Dark red rot rotating in |
| GLITCH | 10 | RGB signal tearing |
| LOVESTRUCK | 8 | Pink heartbeat glow, little hearts floating up |

### Frames (live CSS)
| Item | SC |
|---|---|
| GILDED FRAME | 5 |
| BLOOD FRAME | 5 |
| CIRCUIT FRAME | 6 |

### Titles (text badge beside the name)
| Item | SC | Gate |
|---|---|---|
| Little Heretic | 3 | — |
| Void-Touched | 8 | — |
| WOMF Survivor | 8 | Survive WOMF once |
| Pattern Seeker | 6 | Solve 25 columns |
| Final Witness | 15 | Solve 10 Finals |
| Shadow Broker's Mistake | relic | Granted by the GM (`/relic @Name`) |

### Name styles (live CSS)
EMBER 4 · FROST 4 · GILDED 6 · VOID 6 · BURNT 5

### Sigils (mark after the name — currently plain glyphs)
EYE 3 · SKULL 3 · CROWN 5 · DAGGER 3 · COIN 4

### Cosmetic /commands (chat card + screen effect, 20s shared cooldown)
| Command | SC | Effect |
|---|---|---|
| /smite @Name | 6 | Strike of judgement, gold flash |
| /freeze @Name | 5 | Theatrical ice |
| /glitch @Name | 5 | Signal tear |
| /omen | 7 | A bad sign for the room |
| /rupture | 8 | Reality cracks open |
| /vanish | 4 | Disappears in smoke |
| /love [@Name] | 4 | Colourful hearts fly over the chat |

### Correct-answer celebrations (play on your accepted answers)
| Item | SC | Gate |
|---|---|---|
| THE BROKER'S NOD | 6 | — gold ACCEPTED stamp |
| SHATTER | 8 | — glass cracks |
| BLOOD INK | 6 | — answer rewrites in red |
| WITNESS THE FINAL | 12 | Solve 10 Finals — room goes dark on a Final |

### Dossier
| Item | SC |
|---|---|
| BLOOD DOSSIER (background) | 5 |
| VOID DOSSIER (background) | 5 |
| GILDED DOSSIER (background) | 8 |
| RELIC SHOWCASE slots II / III | 5 / 10 |

### Relics (earned only, never sold)
| Relic | How it is earned |
|---|---|
| SPUN AND RETURNED | Survive 5 WOMF spins |
| FASTEST HAND | First solve of the match in 10 matches |
| LAST-SECOND HERETIC | Solve no column, then take the Final |
| WORD KILLER | Win KALADONT with the word KALADONT |
| SHADOW BROKER'S MISTAKE | Granted by the Shadow Broker |

Plus **Shadow Roulette** (0–12, max 10 SC per spin) and the **Ledger**.

---

## Part 2 — Pictures required

### House style (applies to every image)
- ASOC cyber-gothic: gunmetal and blackened steel, rivets, machined edges,
  engraved glyphs, subtle scratches. Match the existing
  `assets/ui/shadow-coin.webp`, `shadow-broker-eye.webp`,
  `cyber-gothic-battle-eye.png`.
- Accent palette: ASOC violet `#9B5DE0`, blood red `#C0202C`, amber gold
  `#E8B84A`, Shadow Coin green `#9BD65D`. Each item gets ONE dominant accent.
- Dramatic rim light, dark background falloff, no photo-realism of real people.
- **No text or letters in the image** (the UI prints all labels).
- Must read clearly at **48 px**: one bold central silhouette, strong contrast.
- Full-screen cosmetic effects must remain brief and **must never obscure essential clues, chat text, timers, votes, or controls**.

### Technical spec
- Icons / emblems: **512×512 PNG, transparent background**, subject centred
  with ~8% padding. I convert to WebP.
- Backgrounds: **1200×800 PNG, no transparency**, low detail in the centre
  (text sits on top), darker than mid-grey overall.
- File names exactly as listed; drop them into `assets/shop/`.

### Priority 1 — the ones players see most (17 images)

**Command icons** — shown on the market card and in the chat card label.
| File | Brief |
|---|---|
| `cmd-smite.png` | A downward bolt of gold light striking a steel anvil-seal; amber accent |
| `cmd-freeze.png` | A cracked steel emblem sealed in a block of blue-white ice; frost accent |
| `cmd-glitch.png` | A steel eye split into offset magenta/cyan slices, like a torn signal |
| `cmd-omen.png` | A black raven-shaped sigil over a dim violet eclipse; violet accent |
| `cmd-rupture.png` | A steel plate split by a glowing red fissure; blood-red accent |
| `cmd-vanish.png` | A hooded steel silhouette dissolving into grey smoke |
| `cmd-love.png` | A riveted steel heart with a soft pink glow and 2–3 small colourful hearts rising from it |

**Celebration icons**
| File | Brief |
|---|---|
| `cel-broker-nod.png` | A heavy brass rubber-stamp / wax-seal with the ASOC eye mark (no letters); gold |
| `cel-shatter.png` | A pane of dark glass with a starburst crack, shards catching light |
| `cel-blood-ink.png` | A steel fountain-pen nib dripping deep-red ink |
| `cel-final-witness.png` | A single violet eye opening in darkness, faint halo; the rarest-looking of the set |

**Relic medallions** — displayed on the dossier and the DOSSIER tab. All five
share one frame design (a round antique-gold medallion with an engraved rim),
with a different centre motif, so they read as a collectible set.
| File | Centre motif |
|---|---|
| `relic-spun-returned.png` | A small wheel of fortune with one segment glowing |
| `relic-fastest-hand.png` | A gauntleted hand snatching a spark mid-air |
| `relic-last-second-heretic.png` | A cracked hourglass with the last grain glowing violet |
| `relic-word-killer.png` | A dagger piercing a single scroll/word ribbon (no legible letters) |
| `relic-broker-mistake.png` | The Shadow Broker's eye with a hairline crack through it, gold tear |
| `relic-sealed.png` | The same medallion, blank, dark and locked (for relics not yet earned) |

### Priority 2 — dossier & market dressing (5 images)
| File | Size | Brief |
|---|---|---|
| `dossier-default.png` | 1200×800 | Aged classified file folder texture, dark sepia, faint paper grain, a red stamp smudge in a corner |
| `dossier-blood.png` | 1200×800 | Same file, soaked dark red, dried stains at edges |
| `dossier-void.png` | 1200×800 | Same file dissolving into violet void and stars at one edge |
| `dossier-gilded.png` | 1200×800 | Black file with gold-leaf corners and a gilded seal |
| `market-banner.png` | 1600×400 | A dark mechanical shopfront / vault counter, violet lamps, Shadow Coins stacked, empty centre for the title |

### Priority 3 — nice to have (10 images)
| File | Brief |
|---|---|
| `sigil-eye.png`, `sigil-skull.png`, `sigil-crown.png`, `sigil-dagger.png`, `sigil-coin.png` | Tiny crisp emblems (512×512, transparent) to replace the text glyphs after names; flat, bold, single colour + highlight |
| `showcase-slots.png` | A velvet-lined display case with three medallion recesses |
| `roulette-backdrop.png` (1600×900) | A black mechanical casino chamber lit red/purple, empty centre for the wheel |
| `frame-gilded.png`, `frame-blood.png`, `frame-circuit.png` | 512×512 transparent **ring overlays** (hole in the middle, ~12% ring width) to sit over round avatars |

**Total: 17 must-have, 5 dressing, 10 optional.** As images arrive I wire each
one into the market card, chat card, dossier and DOSSIER tab, keeping the
current CSS versions as fallbacks until all of a set is in.
