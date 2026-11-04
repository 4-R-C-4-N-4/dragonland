# Dragonland — MVP Implementation Guide

Handoff for a coding agent. This file is self-contained: it restates everything from the design doc and MVP spec that the build needs. Build exactly what is here; anything marked **(placeholder)** is a tuning value or stand-in that the designer (Ivy) will change later, so keep it data-driven and easy to swap.

---

## 0. Defaults chosen for this handoff (designer may override)

These were not specified by the designer. Implement them as stated, but keep each one isolated so it can change.

- Tooling: **Vite + TypeScript (strict) + PixiJS v8 + Vitest**. No backend.
- Battle UI (HUD, pause menu) drawn in **Pixi**; army builder and menus in **plain HTML/CSS** overlaid on the canvas.
- Simulation tick: **20 Hz fixed step**, render interpolated at display rate.
- Placeholder art: procedural shapes until the art pass (see §10).
- Special moves for the two MVP generals are **placeholder effects** (see §7.5). Names and effects will be redesigned.
- Stage-2 troops get a flat **stat multiplier** over stage 1 (placeholder, see §4).
- `BASE_DAMAGE` and per-unit stats are **placeholders** (see §4).

---

## 1. Goal

One complete, replayable battle:

1. Build an army from named individual troops (squads, dispositions, loadouts).
2. See the enemy's committed general, company and formation.
3. Respond with a loadout and formation.
4. Fight a real-time skirmish of up to 100 vs 100 sprites with pause-and-plan commands.
5. Resolve by general defeat or a duel.

The MVP exists to answer: does a big sprite battle feel good and read clearly; can a player control up to 4 squads without it being frantic; do class counters, A/M/Z lines and dispositions create real choices; is the army builder fast with named troops.

### Out of scope (do not build)

Overworld, towns, weekly admin, multi-general battles, retreat chains, XP / leveling / evolution / mentorship / general track, bonds, troop or general capture, recruiting, hero signature-move sets, action duel, strategic or adaptive AI, saves beyond loadouts, sound (optional stub only), the other three classes (Ethereal, Mage, Construct), third evolution stages for troops.

---

## 2. Game rules (source of truth)

### 2.1 Classes and the damage cycle

Five classes exist in the full game; the MVP uses **Human** and **Beast** only. The full cycle (each class strong against the next):

```
Beast > Mage > Ethereal > Construct > Human > Beast
```

So in the MVP: **Human is strong against Beast; Beast is weak against Human.** Same class vs same class is neutral. Implement the full 5-class cycle in data so later classes drop in without code changes.

### 2.2 Lines (A / M / Z)

Every class has three lines, which set a unit's combat role:

| Line | Effect |
| --- | --- |
| A | Deals more damage **and** takes more damage |
| M | No modifier |
| Z | Deals less damage **and** takes less damage |

### 2.3 MVP units

Two evolution stages per line for troops:

| Class | A | M | Z |
| --- | --- | --- | --- |
| Human | Archer → Ranger | Spy → Rogue | Soldier → Knight |
| Beast | Raven → Hawk | Wyrm → Drake | Dog → Wolf |

Generals are **max-evolution** units (third stage) even though troop lines stop at stage 2. MVP generals: **Paladin** (Human, Z line) and **Dragon** (Beast, M line). Both the player and the AI can pick either as their general, and both sides can field Human and Beast troops.

### 2.4 Damage formula

```
damage = BASE_DAMAGE
       × attacker.statMultiplier
       × (1 + classTerm + attackerLineDealTerm + defenderLineTakeTerm)

classTerm            = +CLASS_MOD if attacker class is strong vs defender class
                       −CLASS_MOD if weak, else 0
attackerLineDealTerm = +LINE_DEAL_MOD if attacker line is A
                       −LINE_DEAL_MOD if Z, else 0
defenderLineTakeTerm = +LINE_TAKE_MOD if defender line is A
                       −LINE_TAKE_MOD if Z, else 0
```

Modifiers are **additive**, then multiplied once. Worked examples (with the starting constants below):

- A-line Archer (Human) hits an M-line Wyrm (Beast): 1 + 0.25 + 0.2 + 0 = **1.45×**
- M-line Spy (Human) hits an A-line Raven (Beast): 1 + 0.25 + 0 + 0.1 = **1.35×**
- Z-line Dog (Beast) hits a Z-line Soldier (Human): 1 − 0.25 − 0.2 − 0.1 = **0.45×**

Clamp the final multiplier to a minimum of 0.1. Generals use the same formula with their class and line.

### 2.5 Constants (`data/constants.json`)

| Constant | Starting value | Meaning |
| --- | --- | --- |
| `TROOP_HP` | 100 | Every troop's max HP |
| `BASE_DAMAGE` | 10 **(placeholder)** | Damage per hit before modifiers |
| `CLASS_MOD` | 0.25 | Class advantage / disadvantage |
| `LINE_DEAL_MOD` | 0.20 | A deals more, Z deals less |
| `LINE_TAKE_MOD` | 0.10 | A takes more, Z takes less |
| `SKIRMISH_TIME_S` | 180 **(placeholder)** | Time limit before a duel |
| `SPECIAL_CHARGE_PER_S` | 1.0 **(placeholder)** | Passive meter gain per second |
| `SPECIAL_CHARGE_PER_HIT` | 0.5 **(placeholder)** | Meter gain per hit dealt by own troops |
| `SPECIAL_METER_MAX` | 100 | Meter needed to fire |
| `STAGE2_STAT_MULT` | 1.3 **(placeholder)** | Stage-2 multiplier on damage and HP |
| `MAX_COMPANY` | 100 | Troops per general |
| `MAX_SQUADS` | 4 | Squads per general |
| `MIN_SQUAD` | 2 | Minimum troops per squad |

All gameplay numbers must come from JSON. No magic numbers in sim code.

### 2.6 Squads and dispositions

- In the army builder, any group of **2+ troops** is a squad. Up to **4 squads** per general. Squads may **blend classes** freely.
- Each squad has one **disposition**, set in the builder and **locked during battle**:
  - **Fierce:** charges in at the enemy.
  - **Mixed:** supports its squad and stays together as one unit. A blended Mixed squad moves at the speed of its slowest member (intended).
  - **Guard:** covers the general on the field.
- Mixed squads hold formation; Fierce and Guard squads may disperse as needed.
- Troops not in any squad: auto-group them into a final squad with Mixed disposition at battle start if slots allow; otherwise the builder must not allow starting a battle with unassigned troops. (Simplest: builder requires every troop to be in a squad.)

### 2.7 How formation, command and disposition stack

None overrides another:

| Layer | When set | Controls |
| --- | --- | --- |
| Formation | Pre-battle | Starting shape and positions only |
| Command | Mid-battle, temporary | **What** a squad is doing: Advance, Hold, Fall Back |
| Disposition | Builder, locked in battle | **How** it does it: target priority, spacing, aggression |

Behavior matrix (implement as data-driven steering weights where possible):

| | Advance | Hold | Fall Back |
| --- | --- | --- | --- |
| **Fierce** | Move to and attack nearest enemy troops; may spread | Hold position, attack anything in reach, pursue a short distance | Retreat toward own general but turn and fight attackers in reach |
| **Mixed** | Advance as a cohesive group toward the enemy center; attack what the group contacts | Hold as a group, attack in reach | Retreat as a group toward own general |
| **Guard** | Advance but keep within a leash radius of own general; prioritize enemies attacking or approaching the general | Ring the general; attack enemies inside the guard radius | Return to the general and ring it |

Default command at battle start: **Advance**.

### 2.8 Formations (MVP set)

Formations set starting positions only.

- **Line:** squads spread evenly in a front line.
- **Wedge:** squads stacked in a forward-pointing wedge aimed at the enemy general.
- **Guard:** squads arranged close around the general.

Store formation slot layouts in `data/formations.json` as normalized positions relative to the general.

### 2.9 Generals in battle

- Generals have HP, MP, a level and one special. They **hold position** near their start point and fight attackers in reach; they do not roam. They have **no disposition**.
- A general at **0 HP loses** the skirmish.
- **Special meter** fills from time and from own troops' hits. When full, the player may fire the special (costs the full meter and the special's MP cost).
- The player's general is the **hero**.

### 2.10 Skirmish end and duel

- A general reaching 0 HP: their side loses.
- **Time limit reached, or both companies wiped out:** the two generals **duel**.
- **Duel (MVP):** a stat-driven exchange, auto-resolved but shown on screen. Generals trade blows on a fixed cadence using the damage formula with their own stats; a general may fire their special during the duel if the meter is full. First to 0 HP loses. Must be deterministic from the seed.
- **No captures in the MVP.** After the battle, both sides' surviving troops return to their own rosters; dead troops are removed permanently from the roster.

### 2.11 Pause and timer

- The player can pause at any time. **Pausing stops the skirmish timer** and the simulation.
- While paused, the player can select squads and issue commands; orders apply on resume.
- Game speed options: **1×** and **2×**. 2× runs two sim ticks per frame budget; the timer counts sim time, not wall time.

---

## 3. Battle flow (state machine)

```
Builder → EnemyCommit → PlayerResponse → Deploy → Fight ⇄ Paused → (Duel) → Result → Builder
```

1. **EnemyCommit:** AI picks general, loadout and formation (see §8). Show them to the player.
2. **PlayerResponse:** player picks or edits a loadout, sees a matchup preview (class counters per squad pair, summarized), picks a formation.
3. **Deploy:** place both companies by formation. Brief countdown.
4. **Fight:** real-time sim. Pause allowed.
5. **Duel:** triggered per §2.10.
6. **Result:** winner, losses per side, surviving troops listed by name. Apply roster updates. Return to builder.

---

## 4. Data model

All content lives in `/data/*.json`, validated at load with a schema (zod recommended). Types below are the contract.

```ts
type ClassId = 'beast' | 'mage' | 'ethereal' | 'construct' | 'human';
type Line = 'A' | 'M' | 'Z';
type Disposition = 'fierce' | 'mixed' | 'guard';
type Command = 'advance' | 'hold' | 'fallBack';

interface ClassDef {            // data/classes.json
  id: ClassId;
  name: string;
  strongAgainst: ClassId;       // exactly one, from the cycle
  color: string;                // team-independent class tint for placeholders
}

interface UnitDef {             // data/units.json
  id: string;                   // e.g. 'archer'
  name: string;                 // 'Archer'
  classId: ClassId;
  line: Line;
  stage: 1 | 2 | 3;
  evolvesTo?: string;           // unit id (data only in MVP; evolution not implemented)
  // placeholder stats:
  moveSpeed: number;            // px/s in sim space
  attackRange: number;          // px; > 40 means ranged
  attackCooldownS: number;
  flying: boolean;              // cosmetic + ignores ground collision in MVP
}

interface GeneralDef {          // data/generals.json
  id: 'paladin' | 'dragon';
  unitId: string;               // 'paladin' | 'dragon' in units.json (stage 3)
  hp: number; mp: number; level: number;
  attack: number;               // multiplier on BASE_DAMAGE
  special: SpecialDef;
}

interface SpecialDef {
  id: string; name: string;     // placeholder names
  mpCost: number;
  kind: 'cone' | 'radiusHeal' | 'radiusDamage';
  radius: number; amount: number;
}

interface Troop {               // roster entry (persisted)
  id: string;                   // stable uuid
  name: string;                 // random generated name
  unitId: string;
}

interface Squad {
  id: string;
  name: string;                 // 'Squad 1' etc., editable
  troopIds: string[];           // >= MIN_SQUAD
  disposition: Disposition;
}

interface Loadout {             // persisted
  id: string; name: string;
  generalId: GeneralDef['id'];
  squads: Squad[];              // <= MAX_SQUADS, total troops <= MAX_COMPANY
}
```

Stage-2 units apply `STAGE2_STAT_MULT` to max HP and damage. Starting placeholder unit stats: melee units range 24, ranged A-line units (Archer/Ranger) range 220; Raven/Hawk are flying melee with high speed; Wyrm/Drake medium speed and slightly larger body; Dog/Wolf and Soldier/Knight medium speed. Put concrete values in `units.json`; they will be tuned.

---

## 5. Project structure

```
/data                 JSON content (classes, units, generals, formations, constants, loadouts-ai, names)
/src
  /sim                PURE simulation: no DOM, no Pixi, no Math.random, no Date
    rng.ts            seeded PRNG (mulberry32 or similar)
    world.ts          world state, entity arrays (struct-of-arrays preferred)
    spatialGrid.ts    uniform grid for neighbor and target queries
    combat.ts         damage formula, attacks, deaths
    steering.ts       movement: seek, separation, cohesion, leash
    behavior.ts       disposition × command → target selection and steering weights
    formations.ts     deploy positions
    specials.ts
    duel.ts
    skirmish.ts       state machine, timer, end conditions
    step.ts           fixed-step entry point: step(world, dtFixed)
  /render             Pixi: sprites, interpolation, camera, effects, HUD
  /ui                 HTML/CSS: army builder, pre-battle, result screens, debug panel
  /ai                 enemy commit + in-battle command policy
  /data               loaders + zod schemas
  /persist            localStorage for roster and loadouts
  main.ts
/tools
  headless.ts         CLI batch simulator (see §9)
/tests
```

Hard rule: **`/src/sim` must not import from render, ui or any browser API.** It must run in Node for tests and the headless runner.

---

## 6. Simulation details

- **Fixed step:** `DT = 1/20 s`. Accumulator loop in `main.ts`; render interpolates between previous and current positions.
- **Determinism:** all randomness via the seeded RNG passed through world state. Same seed + same loadouts + same command log → identical outcome. Commands are recorded as `(tick, side, squadId, command)` so battles can be replayed.
- **Entities:** store troops in typed arrays (positions, velocities, hp, cooldowns, squad index, side, unit index, target index). Up to ~210 entities (200 troops + 2 generals + effects).
- **Spatial grid:** uniform cells (~64 px). Rebuild each tick. Used for target acquisition and separation.
- **Targeting:** each troop re-evaluates its target at most every 0.5 s (staggered by entity index) using the disposition rules in §2.7. Prefer targets within range; ranged troops prefer keeping distance (kite if enemy closer than 60% range when command is Hold or Fall Back).
- **Attacks:** when target within `attackRange` and cooldown ready, deal damage per §2.4. Ranged attacks are instant hits in the sim with a cosmetic projectile in render.
- **Death:** at HP ≤ 0 the troop is removed from the sim and marked dead for the result screen.
- **Battlefield:** fixed-size field (e.g. 1600 × 600 sim units), side-on with slight tilt; y is depth. Sort sprites by y.
- **Generals:** stationary-ish (small leash around start), fight in reach, take damage like troops.

---

## 7. Controls and HUD

### 7.1 Input

- **Space** or pause button: toggle pause.
- **1–4** or tap a squad banner: select squad. **A** or "All" button: select all squads.
- Command buttons (also **Q / W / E**): Advance, Hold, Fall Back for the selection.
- **S** or Special button (lit when charged): fire special.
- Speed toggle: 1× / 2×.
- Mouse/touch drag or edge scroll to pan the camera; wheel or pinch to zoom.

"All" commands must be a fully viable way to play.

### 7.2 HUD

- Both general portraits with HP and MP bars and level.
- Skirmish timer.
- Special meter for the player's general.
- Squad banners (1–4) showing name, disposition icon, current command, and alive / total count.
- Pause overlay showing "PAUSED — issue orders".

### 7.3 Squad readability

Each squad has a banner sprite above its centroid and a subtle per-squad tint or marker under its troops so the player can tell squads apart.

### 7.4 Matchup preview (pre-battle)

For each player squad vs the enemy company, show a simple strong / neutral / weak summary based on class composition. Text and icons are fine.

### 7.5 Placeholder specials

- **Paladin — "Rally" (placeholder):** heals own troops within a radius by a flat amount.
- **Dragon — "Breath" (placeholder):** cone of damage in front of the Dragon toward the enemy.

Both defined in `generals.json` so they can be redesigned without code changes.

---

## 8. Enemy AI (MVP)

- **Commit:** picks one of a small set of hand-made loadouts in `data/loadouts-ai.json`. Prefers the loadout with the best class matchup against the player's **previous battle's** company composition (first battle: random with seed). Picks a general (Paladin or Dragon) and formation stored with the loadout.
- **In battle:** issues commands on a simple timer and rule set. Dispositions are locked, so the AI only changes commands. Example policy: Advance at start; if its general drops below 40% HP, order Fall Back on its Guard squads; resume Advance when the threat clears. Fires its special when charged and at least N enemies (placeholder) are in the effect area.
- AI uses the same command API as the player. No cheating: it never reads the player's loadout before committing in the current battle.

---

## 9. Tooling, debug and tests

### 9.1 Debug overlay (toggle with backtick)

- Damage numbers, target lines, squad state labels, grid cells.
- FPS and sim tick time.
- **Constants panel:** edit values from `constants.json` live; changes apply to the next battle (and live if simple). Vite hot reload of `/data` is a bonus.

### 9.2 Headless batch runner

`npm run sim -- --a <loadoutId> --b <loadoutId> --runs 200 --seed 1`

Runs battles in Node with a scripted command policy (both sides use the AI policy), prints win rate, average duration, average losses, and duel frequency. This is the main balancing tool for the constants.

### 9.3 Tests (Vitest)

- Damage formula: the three worked examples in §2.4 and the clamp.
- Class cycle: each class strong against exactly one and weak against exactly one.
- Determinism: same seed and inputs produce an identical end-state hash.
- Builder validation: squad min size, max squads, max company, no troop in two squads.
- Skirmish end: general death, timeout → duel, double wipe → duel.
- Pause: timer does not advance while paused.

---

## 10. Placeholder art and the art pass

Until real sprites exist, draw procedural placeholders so the battle is readable:

- **Shape by line:** A = triangle, M = circle, Z = square.
- **Color by class**, with a team outline color for side.
- **Stage 2:** slightly larger with an inner dot.
- **Flying units:** drawn with a small offset shadow below.
- **Generals:** 2× size with a banner.

Art pass spec (for later, but build the loader now): sprite sheets as PNG + Aseprite-style JSON per unit with animations `idle, walk, attack, hit, death`. Troops ~16–24 px tall, generals ~32–48 px. The renderer should swap placeholder shapes for sheets when present, per unit id.

---

## 11. Persistence

- **Roster:** on first launch, generate a seeded starting roster of named troops across all 12 MVP units, enough to fill 100 slots with choices left over (e.g. 160 troops). Store in localStorage.
- **Names:** generated from syllable lists in `data/names.json`; must be unique within the roster.
- **Loadouts:** saved in localStorage. A loadout referencing dead troops is flagged in the builder and those troops are removed from its squads.
- Provide a "Reset roster" button in the debug panel.

---

## 12. Army builder UI

- Roster table with filter and sort by class, line, stage, name.
- Up to 4 squad panels; drag troops in, or use bulk actions:
  - Select all of a unit type.
  - Auto-fill a squad (by unit type or by class, up to a count).
  - Quick-swap a squad's disposition.
- Running totals: company size vs 100, per-class counts.
- General picker: Paladin or Dragon.
- Save, load, rename, duplicate loadouts.
- Validation errors shown inline; "Start battle" disabled until valid.

Target: building a 100-troop army takes under 2 minutes using the bulk tools.

---

## 13. Milestones and acceptance criteria

Work in this order. Each milestone should be playable or testable on its own.

1. **Sim sandbox.** Headless and in-browser debug view with colored dots. Damage model, dispositions, commands, formations, timer, end conditions. *Accept:* tests in §9.3 pass; headless runner works; Human beats Beast in an even mirror loadout clearly more often than not, but not 100%.
2. **Battle render.** Pixi field, placeholder shapes, camera, HUD, interpolation. *Accept:* 200 troops at a steady 60 fps on a mid-range laptop browser; squads distinguishable.
3. **Army builder.** Roster, squads, dispositions, loadouts, persistence. *Accept:* validation rules enforced; a 100-troop army can be built in under 2 minutes.
4. **Controls.** Pause-and-plan, squad selection, commands, special button, 1×/2× speed. *Accept:* timer stops on pause; all inputs work with keyboard and mouse/touch.
5. **Duel and enemy AI.** Stat duel, enemy commits first, counter-picks vs previous battle, in-battle command policy. *Accept:* full loop Builder → Result → Builder works; result screen lists survivors and casualties by name.
6. **Art pass hooks.** Sprite sheet loader and swap-in. *Accept:* dropping a sheet for one unit replaces its placeholder without code changes.
7. **Tuning support.** Constants panel and headless reports polished for playtesting.

### Overall success criteria (from the MVP spec)

- A skirmish usually ends within 3 minutes at 1× speed.
- 200+ animated sprites run at 60 fps on a mid-range laptop browser.
- A strong class matchup wins clearly more often than a weak one, but not every time.
- A playtester can tell what each squad is doing from the screen alone.
- Building a 100-troop army takes under 2 minutes.

---

## 14. Open items (do not decide; leave hooks)

- **Retreat to save troops** instead of losing them to a wipeout: tune after the MVP. Leave room for a Retreat action on the general.
- **Exact skirmish time limit:** a tuning value, not a blocker.
- Final names and effects for the Paladin and Dragon specials.
- Real unit stats and `BASE_DAMAGE`.

If something is ambiguous and not covered here, choose the simplest option that keeps it data-driven, and leave a `// DESIGN-TBD:` comment plus a note in `DECISIONS.md` at the repo root.
