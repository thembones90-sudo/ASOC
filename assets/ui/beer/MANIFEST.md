# ASOC Beer Artwork Models

The default /beer artwork consists of nine 1024 x 1024 transparent RGBA PNG assets. Legacy SVG files remain in the repository for compatibility; the existing built-in inline SVG remains the runtime fallback. Each model retains its event identity.

## Bottles
- bottle-voidwarden.png: black-violet glass with occult eye
- bottle-reliquary.png: green apothecary glass, amber beer, gold cage
- bottle-bloodcrown.png: ruby glass, dark-iron crown

## Cans
- can-iron-ration.png: armored military gunmetal
- can-void-coil.png: slender obsidian violet-coil eye
- can-royal-stout.png: broad black and gilded-crown stout

## Barrels
- barrel-oathwood.png: warm oak, forged hoops, oath seal
- barrel-iron-keg.png: red armored steel keg with brass tap
- barrel-plague-cask.png: green alchemical wood barrel, emerald seal

## Integration
The renderer uses the server-selected event.model when it is in the allowlisted model pool, loading assets/ui/beer/<model>.png in the existing beer stage. If the PNG cannot load, the existing inline SVG fallback is used. The stage layout, timing, particles, button actions, cooldowns and effects are unchanged. Images use object-fit: contain to prevent stretching.
