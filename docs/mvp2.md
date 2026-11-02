# MVP2 — The developing company

> For Hermes: use subagent-driven-development; independent implementation, spec and quality reviews. This is the implementation queue and current contract for the roguelike extension. MVP1 docs remain historical; this document overrides their exclusions below.

Goal: play a finite seeded run whose named troops gain XP, evolve, die permanently and are replaced only by limited recruitment choices, across the full five-class cycle.

Architecture: keep the fixed-step deterministic battle engine browser-independent. Resolve run progression in pure functions around battle results; persist one versioned run snapshot atomically. Keep sandbox saves and unlimited recruitment separate. All tuning belongs in validated JSON. Stack remains TypeScript, PixiJS, plain DOM, zod, Vitest; no new UI framework.

## Confirmed design decisions

- Hero defeat ends the run immediately. No resurrection, hidden roster refill or rewards after defeat.
- Ordinary troops can reach stage 3 and remain troops. Promotion into another general is deferred.
- Survivors and the hero recover fully between encounters initially; troop attrition is the resource economy.
- Preserve pause-and-plan, squads, dispositions, formations, enemy commitment before response.
- Remove field flags/banners and decorative centroid markers. Retain HUD squad selection, team/squad tint and meaningful selection feedback.
- All five classes and three lines must be present, with all three evolution stages: 45 unit species, five animations each. Existing 14 designs are retained. The other 31 receive actual generated sprites, not shape/recolour substitutes. First-pass art is provisional and can be remodelled later.
- Keep the sandbox and its demo auto-recruit as a separate mode.

## Content contract

Cycle: Beast > Mage > Ethereal > Construct > Human > Beast. Other pairings neutral.

| Class | A | M | Z |
|---|---|---|---|
| Beast | Raven / Hawk / Eagle | Wyrm / Drake / Dragon | Dog / Wolf / Warg |
| Ethereal | Imp / Demon / Devil | Sprite / Spirit / Shepherd | Cherub / Angel / Archangel |
| Human | Archer / Ranger / Deadeye | Spy / Rogue / Assassin | Soldier / Knight / Paladin |
| Mage | Witch / Necromancer / Diabolist | Adept / Wizard / Archmage | Monk / Cleric / Hierophant |
| Construct | Zombie / Skeleton / Servitor | Golem / Elemental / Kyilkhor | Automata / Machine / Anima |

IDs are lower-case species names. General choice remains Paladin or Dragon in this iteration; all classes are available through starting troops/recruitment and enemies. Stage 3 species are not automatically generals: entity role determines general HP/specials, species determines troop movement/class/line. No mixing a troop profile with a same-species general profile.

New roles use conservative starting profiles: A-line ranged casters except Beast birds/Construct undead melee; M-line medium melee except Mage Adept line ranged; Z-line slower close-combat durable troops. Flying Ethereals and birds keep identity. Concrete stats are placeholders in units JSON; do not invent unsupported complex abilities.

## Starting tuning defaults (editable, not claims of balance)

- Run length: 8 victories, final encounter is a boss. Two committed encounter offers per step, with composition visible before choice. After selection the enemy cannot reroll when the player edits their company.
- New run: choose Paladin/Dragon and starting troop class. 60 named stage-1 troops, 20 of each line of that class. Capacity 100, up to four squads. No artificial minimum company size beyond existing valid squad rules.
- Troop total XP: level = min(12, 1 + floor(totalXP / 100)); evolution at levels 3 and 6. XP is cumulative and never resets at evolution; multi-level awards traverse both eligible evolution links. Only deployed survivors gain XP, 100 per normal victory, 150 for boss. No last-hit XP or bench XP. Preserve ID/name through promotions. Dead troops removed, not retained to earn XP.
- Troop HP/damage multiplier: stage multiplier (1, 1.3, 1.6) times (1 + 0.02 * (level - 1)). Do not double-apply stage multipliers. Speed/range/cadence remain species-defined.
- General starts at level 1, total XP 0; +100 XP/victory, level threshold 150 XP, cap 12. HP/attack +3% per level above 1. Existing general JSON values are level-1 baselines for run mode; sandbox keeps existing behaviour. MP/cooldown design remains simple.
- General milestones at levels 3, 5, 7, 9, 11: choose once between vitality (+10% max HP), might (+10% attack), or mastery (+10% special amount). Multiplicative rank bonuses, no new special buttons or extra MP economy. Reward phase cannot advance past an unclaimed milestone choice.
- Recruitment after each non-final victory: choose one of three seeded offers, each 12 stage-1 recruits; three distinct unit types per reward. May skip. Recruits level 1, XP 0; may bench surplus roster troops. Cap total roster at 160, reject offers that exceed it. No gold/shop/reroll economy yet.
- Encounter troop count increases from 40 toward 100, general difficulty increases with encounter index. Species/stages/levels generated from run seed and depth, NEVER from the current response army; stage 3 appears late. Enemies blend classes rather than being monotype mirrors. Counter balance is measured, not assumed solved.

## State and correctness

- Persist schema-versioned run state containing seed, stable run ID, phase, depth, roster (XP/level/unit identity), hero XP/upgrades, committed offers/enemy, pending rewards, last summary and processed battle ID. Save the whole snapshot in one storage write per transition.
- Run phases: preparation / battle / rewards / won / lost (implementation may add explicit encounter-selection phase).
- Battle inputs freeze exact individual troop profiles and hero progression. Result processing is idempotent: repeated callbacks/reload cannot award XP, remove troops, recruit or claim milestones twice. Reward RNG consumes seed/depth/offer IDs deterministically, never wall time.
- Persist committed battle setup for resuming/replaying an interrupted battle; restart the same battle from its original snapshot/seed rather than minting a new encounter or overwriting losses.
- Empty roster is a legitimate save, not missing/corrupt state. A run must not use the sandbox store's empty-roster reset behaviour.
- Loading a run must validate references, identity uniqueness and legal progression; corrupt run saves show recovery/new-run options rather than silently granting a fresh army. MVP1 sandbox localStorage stays intact.
- Stage 3 units accepted by builder/run/loadout validation and recruitment/progression tooling where applicable. Enemy data validation must no longer ban all stage-3 troop entries.
- UI: composition-first builder still uses available troops; expose named veterans, level/XP and promotions without 100 mandatory clicks. No run-mode general swapping or recruitment through builder autofill.

## Art workflow

One serialized generator calls Codex image gen through the existing CLI; do not run competing newest-image fallback consumers. Specs live in art/units; originals immutable under art/raw (LFS). Generate base stage before evolution and attach its provisional selected sheet plus Soldier style anchor. One candidate per missing species first; regenerate only technical/recognizability failures. Store review decisions with exact unit and filename in art/reviews/mvp2.json. Acceptance: 5 tags, expected frames, nonempty frames, correct facing/anatomy, recognizable silhouette, team mask where feasible, distinct action phases, no cross-row contamination. Reviewers are separate from generator/implementer, inspect raw and processed contact sheets; minor roughness is deferred explicitly, not called final polish. Use character-specific movement descriptions instead of conflicting generic high-knee text.

## Implementation queue

Each code step uses RED test -> minimal implementation -> GREEN test. Run npm run check and npm run build at integration boundaries. Workers own disjoint files in separate worktrees; parent owns integration and this queue. No worker pushes or merges.

| ID | Task and paths | Acceptance | State |
|---|---|---|---|
| Q0 | This contract and source baseline | Existing 135 tests green; clean baseline | written |
| Q1 | Full roster in data/units.json; src/data/index.ts; focused roster tests | 45 unique species, 15 complete chains; stage-3 troops legal; old API preserved | pending |
| Q2 | Art direction in art/units/*.yaml and batches | 45 specs, coherent provisional silhouettes/grips/motion with evolution references | pending |
| Q3 | src/progression/* + data/progression.json; tests/progression/* | Pure troop XP/evolution, hero growth/milestones and stat derivation with JSON validation | pending |
| Q4 | src/sim/types.ts/world.ts and builder setup conversion | Individual levels influence battle HP/damage; troop/general same-species isolation; deterministic replay | pending |
| Q5 | src/run/* and tests/run/* | Seeded offers/enemies, finite state machine, losses/rewards/idempotency; versioned storage | pending |
| Q6 | src/ui/run/* + src/main.ts; sandbox integration | Browser-playable start/select/prepare/fight/reward/continue/win/lose/resume flow | pending |
| Q7 | src/render/battlefield.ts and battle selection | Field flags removed without breaking HUD selection; useful tint retained | pending |
| Q8 | Art generation for 31 missing species, art/reviews/mvp2.json | Independent visual reviews; 45 runtime PNG/mask/JSON sets, all 225 animation tags | pending |
| Q9 | Integration/headless/browsers; PROGRESS.md | Full gates; verify XP/evolution, restricted recruiting, reload safety, loss lockout, five-class encounters | pending |

## Phase B queue (D24: heroes, field specials, class unlocks)

| ID | Task | Acceptance | State |
|---|---|---|---|
| B1 | Field-wide special effect system + 15 generals with specials | data-driven effects, tests per area, AI fires sensibly | done (parent) |
| B2 | Run: 15 selectable heroes; starting troops = hero class + partner (H+M, M+C, C+B, B+E, E+H); recruits/offers only from unlocked classes; defeating an enemy general unlocks its class; encounter cards show general class + unlock | tests + browser | worker |
| B3 | FX pipeline: art/fx specs, strip generation + processing to assets/fx, renderer plays fx per special kind (field overlay, travelling wave, per-target strikes, army glow) | tests + browser | worker |
| B4 | Generate + independently review 15 special fx sheets | reviews recorded | after B3 |
| B5 | Balance: specials vs disposition/run numbers via dispo.ts/runsim.ts | numbers in DECISIONS | parent |

## Deferred

Overworld/towns, mentorship, general recruitment/promotion, bonds, injury economy, captures, branching evolution, equipment, permanent metaprogression, additional hero archetypes, final animation polish. Do not expand these while the finite run is unverified.
