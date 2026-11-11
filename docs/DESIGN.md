# Dragonland UI design

One direction for the whole app, decided after playing every screen and listing where a player
had to guess. Code lives in `src/ui/common/theme.css` (tokens + primitives) and
`src/ui/common/kit.ts` (portraits, bars, chips, cards).

## Direction: the war table at night

A dark war room lit by dragonfire. Near-black ink surfaces, bone-white text, and **one hot
accent, ember gold to flame orange, that always means "your move"**: the primary action on a
screen, the node you can march to, the general you are about to send. Red is only ever the enemy
or danger; green only ever yours or good. Class colours come from the game data and appear as
chips and rims, never as decoration.

Energy comes from shape and motion, not gradients: chamfered (cut-corner) panels and buttons,
condensed uppercase labels, big numerals, screens that slide in, a primary button that glows.
Motion is short (120-260 ms) and off under `prefers-reduced-motion`.

## Type (bundled in `assets/fonts`, SIL OFL)

| Role | Face | Use |
| --- | --- | --- |
| Display | Cinzel (variable 400-900) | Screen titles, place names, general names |
| Label | Barlow Condensed 500/700 | Buttons, chips, stat labels, numerals (uppercase, tracked) |
| Body | Barlow 400/600 | Sentences, hints, tables |

## Tokens

`--dl-ink-0..3` surfaces, `--dl-line` / `--dl-line-hot` borders, `--dl-text` / `--dl-text-dim`,
`--dl-ember` (accent) / `--dl-flame` (accent hot), `--dl-own` (green), `--dl-foe` (red),
`--dl-mp` (blue), `--dl-cut` (corner chamfer). The old `--dl-bg*`, `--dl-accent`, `--dl-good`,
`--dl-bad` names stay as aliases so Skirmish and Sandbox inherit the theme.

## Primitives

- `.dl-btn` (all `button`s): chamfered, label face. `.dl-primary` = ember fill + glow, one per
  screen. `.dl-danger` for destructive.
- `.dl-panel`: ink-1 surface, hairline border, cut corners. `.dl-panel--hot` adds the ember rim.
- `.dl-chip`: small class/status pill. `.dl-meter` (+`--hp`, `--mp`, `--troops`): meters with the
  number printed on them. Never print "1500/1500 HP" as bare text where a bar fits.
- `.dl-portrait`: a unit's idle sprite frame, pixel-scaled, on a class-tinted plate.
- `.dl-gcard`: general card = portrait + name + class chip + HP/MP bars + troop count. The same
  card is used on the map, the battle choice, preparation, muster and the end screen, so a
  general always looks the same.
- `.dl-kicker`: small uppercase line above a title saying where you are ("Battle · Skirmish 2").

## Surfaces

| Screen | Surface | What must be obvious at a glance |
| --- | --- | --- |
| Title | Decide | Continue vs new war; what a war is, in four lines |
| Hero picker | Compare | Who hunts whom; who marches with you; your starting army |
| Overworld | Operate | The objective; whose turn; what the selected division will do; End turn |
| Battle choice | Compare | Your generals vs theirs, side by side; what losing costs; retreat |
| Preparation | Configure | How many you send vs keep back; matchup per troop kind; Fight |
| Battle | Operate | Both generals' HP/MP; your squads; orders |
| After a skirmish | Monitor | Who won, what it cost each side, what happened to the loser |
| Muster / prisoners | Operate | Who can be adopted, into which division |
| War over | Decide | Won or lost, why, the war in numbers; new war |

## Rules

- Every screen has a kicker, a title, and exactly one primary button.
- Say the consequence next to the choice (retreat goes where; hero falls = war lost).
- Numbers that are compared sit next to each other in the same unit (your 100 vs their 50).
- Disabled controls say why.
- No emoji in UI, no decorative gradients, no blur, no icon-above-heading tiles.
- Works at 1280x800, 1024x700 and 800x600 without page scroll on the map and battle.
