# MVP3 solo-hero start, adopting beaten generals, and a hunt-star hero picker

Baseline: `d215802`, 716 tests. Target `mvp3`. No new dependencies.

## Why

Playtesting: every war so far lost its first fight. The war start splits troops across three generals the player did not choose, each fight is one general's share (50) against a rival's 50, there is no army preparation, and the rival faction fields one stack of five. The Skirmish demo's first fight was 60 of your own two classes against 40. The troop-split screen confuses more than it decides, and the hero picker is a plain grid that says nothing about the class counter cycle.

## Decisions

- **Solo start.** The war begins with the hero alone, carrying the Skirmish demo's starting army: the hero's class plus its configured partner class (`data/run.json` `startingPartners`), `startingTroopsPerLine` (10) of each stage-1 line: 60 troops. The player faction's classes become those two, so resupply draws the same species. The troop-split screen is removed. Hero command capacity is `PLAYER_STARTING_CAPACITY` (now 100, `MAX_COMPANY`). `STARTING_TROOPS` and `STARTING_GENERALS` are removed.
- **Adopt beaten generals.** A rival general captured in battle (existing 60% capture roll) can be adopted straight after the battle: they switch sides, join the division that won if it has room (else stay with it as a stationed general at that node), keep their surviving troops, and start at `ADOPTED_HP_FRAC` of max HP. Declining keeps them a prisoner; prisoners can still be adopted at the weekly muster. Their classes stay their own, so adoption is how the player gains new species. Pure engine function `adoptCaptive`; save validation covers the result.
- **Rival opening.** The rival keeps 6 generals of 50, but fields fewer at first: `RIVAL_OPENING_FIELD` per personality (aggressive 2, opportunist 2, defensive 1) in one division; the rest garrison the rival castle. The rival castle becomes the late-game wall; the field fights are winnable one at a time.
- **Defeat rule.** The war is lost only when the hero falls (`LOSE_WITHOUT_CASTLES: false`). A solo hero cannot garrison, so the old "no castles left" defeat would end the war the first time an enemy walked into an empty Dawnkeep. Losing Dawnkeep now costs its resupply until retaken. Set `LOSE_WITHOUT_CASTLES` to true to restore the old rule.
- **Hero picker as a hunt star.** The five classes sit on a pentagon ordered so the authored counter cycle is the star: every class's **quarry** (the class it is strong against) is two points away, joined by a star line; its **nemesis** is the class two points the other way. The pentagon edges are the starting partners (each class's ally sits beside it). Three hero tokens per class (Z/A/M lines) sit at each point. Selecting a hero lights its class, its quarry line (green, arrow out), its nemesis line (red, arrow in) and its ally edge, and the side panel states them in words, with the starting army ("Beast + Ethereal, 60 troops") and the special. Keyboard: the tokens are a radio group (arrow keys move, Enter begins). SVG + DOM, no canvas.

## Out of scope

A pre-battle preparation screen for war fights (dispositions/formation) and rival growth over time. Both are likely next steps if fights still feel random; they are not part of this pass.

## Tasks

1. Engine: solo start, partner classes, rival opening field, constants and schema; update createWar/upkeep/world-data tests.
2. Defeat rule constant and turn settlement; tests for both settings.
3. `adoptCaptive(war, factionId, captiveId, divisionId)` with validation, HP, placement; save round-trip test.
4. Campaign UI: post-battle "captured" screen (adopt / keep as prisoner); muster lists prisoners with Adopt.
5. Start screen: hunt-star picker, name, Begin; remove allocation code and its tests; keep `createWar` the only rule source.
6. Gates (`npm run check`, build, diff check), real-browser QA of the picker at 1280×800/1024×768/800×600 and a war start → first fight → adoption, PROGRESS/DECISIONS, independent review.
