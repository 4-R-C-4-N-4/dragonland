# Dragonland — MVP Spec

Build contract for the first playable. [`design.md`](design.md) remains the north star; [`implementation.md`](implementation.md) is the detailed engineering handoff.

## Goal

The MVP is one complete, replayable battle: build an army, read the enemy's commitment, and fight a 100-vs-100 sprite skirmish that feels great and stays controllable. If this battle is fun, the rest of Dragonland is worth building.

**Questions the MVP must answer**

- Does a big sprite battle feel good and read clearly?
- Can a player control up to 4 squads in real time without it getting frantic?
- Do class counters, A/M/Z lines and dispositions create meaningful choices?
- Is the army builder fast and satisfying with named individual troops?

## Scope

| In the MVP | Not in the MVP |
| --- | --- |
| Army builder: squads, disposition, formation | Overworld, towns, weekly admin |
| One battle: hero vs one enemy general | Multi-general battles and retreat chains |
| 2 classes, all 3 lines, 2 evolution stages | Remaining 3 classes, third evolution stage |
| Named individual troops with fixed stats | XP, leveling, evolution, mentorship, general track |
| Commands with pause-and-plan | Bonds, troop and general capture, recruiting |
| One special per general, stat-driven duel | Hero signature-move set, action duel |
| Simple enemy AI that commits first | Strategic and adaptive AI |

## Content

**Classes:** Human and Beast. They are a direct counter pair (Human > Beast), so counters are visible from the first fight, and each class plays the advantaged and disadvantaged side depending on the matchup. Both the player and the AI can field Human and Beast troops.

| Class | A (damage) | M (balanced) | Z (durable) |
| --- | --- | --- | --- |
| Human | Archer → Ranger | Spy → Rogue | Soldier → Knight |
| Beast | Raven → Hawk | Wyrm → Drake | Dog → Wolf |

That is 12 troop sprites, each with idle, walk, attack, hit and death animations.

**Generals:** one per side, each a max-evolution unit with HP, MP, a level and one special. The player's general is the hero, chosen as a **Paladin or Dragon**; the enemy general is also a Paladin or Dragon. In the long run any line's max evolution can be a hero. Generals are max-evolution even though troop lines stop at two stages in the MVP.

**Roster:** a pre-generated pool of randomly named individual troops across all 12 units, enough to fill 100 slots with choices left over.

## Army builder

Before battle, the player shapes a company of up to 100 troops.

1. Pick troops from the roster (filter and sort by class, line, stage).
2. Group them into up to 4 squads of 2+ troops; squads can blend classes.
3. Assign each squad a disposition: Fierce, Mixed or Guard.
4. Save the setup as a reusable loadout.

The builder needs bulk tools from day one: select all of a unit type, auto-fill a squad, and quick-swap dispositions.

## Battle flow

1. **Enemy commits first.** The AI picks its general, company and formation; the player sees them.
2. **Player responds.** Choose a loadout (or edit it), see a matchup preview, pick a formation.
3. **Skirmish.** Real-time battle on a side-on field with a slight tilt.
4. **End.** A general at 0 HP loses. At the time limit, or if both companies are wiped out, the generals duel. There are no captures in the MVP: surviving troops return to their own roster; dead troops are gone.

**Formations (MVP set):** Line, Wedge, Guard. Each sets starting positions only.

## Controls

Commands use pause-and-plan, a callback to Dragon Force: the player can pause at any time, give orders, and resume.

- **Pause:** pausing also stops the skirmish timer.
- **Select a squad:** tap its banner or press 1–4; "All" selects every squad.
- **Commands:** Advance, Hold, Fall Back. Commands set what a squad does; its disposition sets how.
- **Special:** a button that lights up when the meter is full.
- **Speed:** 1× and 2× game speed.

Playtesting decides whether per-squad control is fun or too fiddly; "All" commands must remain a fully viable way to play.

## Damage model

All values are starting constants in one JSON file, tuned through playtesting.

| Constant | Starting value | Meaning |
| --- | --- | --- |
| TROOP_HP | 100 | Every troop's HP |
| BASE_DAMAGE | 10 (placeholder) | Damage per hit before modifiers |
| CLASS_MOD | 0.25 | +25% when the attacker's class is strong, −25% when weak |
| LINE_DEAL_MOD | 0.2 | A attacker deals +20%; Z attacker deals −20% |
| LINE_TAKE_MOD | 0.1 | A defender takes +10%; Z defender takes −10% |
| SKIRMISH_TIME | 180 s (placeholder) | Time limit before a duel |
| SPECIAL_CHARGE | TBD | Meter fill rate from time and combat |

**How modifiers stack.** Line modifiers add onto the class modifier, in both directions:

```
damage = BASE_DAMAGE × (1 + class term + attacker's line deal term + defender's line take term)
```

For example, an A-line Archer hitting an M-line Beast deals 1 + 0.25 + 0.2 = 1.45×. An A-line Raven hit by an M-line Human takes 1 + 0.25 + 0.1 = 1.35×. A deals more and takes slightly more; Z is the mirror.

**Timer.** The exact time limit is a tuning value, not a blocker; 180 s is a placeholder until playtests.

**Duel (MVP):** stat-driven exchange based on HP, stats and level; generals can still fire their special if charged.

## Enemy AI (MVP)

- Commits first from a small set of hand-made loadouts.
- Picks the loadout with the best class matchup against the player's last battle, so counter-picking is visible.
- Gives simple commands on a timer; fires its special when charged.

## Tech

- **Stack:** TypeScript with PixiJS, running in the browser.
- **Simulation:** fixed-timestep and deterministic, separate from rendering, so battles can be replayed and seeded for testing.
- **Movement and targeting:** simple steering plus a spatial grid.
- **Data:** classes, units, formations, dispositions and constants live in JSON.
- **Debug overlay:** live damage numbers, squad states and a constants panel for tuning without reloads.

## Milestones

1. **Sim sandbox.** Colored dots fight with the damage model, dispositions and commands; no art.
2. **Battle render.** Placeholder sprites, camera, HUD, time limit and win condition.
3. **Army builder.** Roster, squads, dispositions, loadouts.
4. **Controls.** Pause-and-plan, squad selection, specials, game speed.
5. **Duel and enemy AI.** Stat duel, enemy commits first with counter-picking.
6. **Art pass.** The 12 troop sprites and 2 generals.
7. **Playtest and tune.** Adjust constants against the success criteria.

## Success criteria

- A skirmish usually ends within 3 minutes at 1× speed.
- 200+ animated sprites run at a steady 60 fps on a mid-range laptop browser.
- A strong class matchup wins clearly more often than a weak one, but not every time.
- Playtesters can tell what each squad is doing from the screen alone.
- Building a 100-troop army takes under 2 minutes with the bulk tools.

## Open decisions

- [ ] Retreat as a way to save troops instead of losing them to a wipeout (tune after the MVP).
- [ ] Exact skirmish time limit (tune in playtests; not a blocker).
