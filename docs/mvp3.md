# MVP3 — The full game

> For Hermes: this is the contract. Execute with subagent-driven-development; independent spec and quality review per task. `docs/design.md` remains the north star; this document is what MVP3 actually commits to. MVP2 docs remain historical.

**Goal:** a complete playable campaign — choose a hero, march a living overworld, fight sequenced general-vs-general battles, take castles, promote veterans into generals, and win or lose a war.

**Architecture:** add a pure overworld/campaign layer (`src/world`) beside the existing pure battle simulation (`src/sim`). The overworld is turn-based and deterministic: same seeded-RNG discipline and replay guarantees, no DOM or wall-clock inside it. Battles stay exactly as they are and are invoked *by* the overworld rather than by the campaign screen. One versioned save snapshot holds the whole war.

**Stack:** unchanged. TypeScript, PixiJS, plain DOM/CSS, zod, Vitest, Node 22. No new runtime dependencies, no UI framework.

---

## What exists already (do not rebuild)

| Area | Where | State |
|---|---|---|
| Deterministic battle sim | `src/sim/*` | Done. Fixed step, seeded, replayable, `hashWorld` |
| Battle view / HUD / perspective | `src/battle/*`, `src/render/*` | Done. Owns its own teardown and quit flow |
| 15 heroes, 45 species, specials | `data/generals.json`, `data/units.json` | Done. MP-only recharge, peer-balanced |
| Finite run engine | `src/run/*` | Done — **becomes a subset of the war layer** |
| Army builder / composition | `src/ui/builder/*`, `src/ui/run/logic.ts` | Reuse for company editing |
| Progression (troop XP, evolution, hero milestones) | `src/progression/*` | Reuse; extend with the general track |
| Save validation | `src/run/storage.ts` | Reuse the pattern; extend to war state |

MVP2's 8-battle linear run is kept as **Skirmish Campaign** mode so nothing regresses while the war mode is built.

---

## Design decisions this commits to

Numbers are starting defaults in validated JSON, not balance claims.

### Hero and generals
- Choose 1 of 15 heroes. Hero death ends the war immediately — no rewind, no refill.
- Generals are named characters with their own HP/MP, class, level, and a **command capacity** limiting troops led.
- **Promotion:** a stage-3 troop that reaches the general track cap can be promoted during admin. It keeps its name and species, gains a general profile, and leaves the troop roster. Promotion is the main source of new generals.
- Enemy generals defeated at 0 HP are **captured, injured, or killed** by seeded roll. Captives can be recruited during admin.
- Permadeath on by default; a casual toggle is out of scope for MVP3.

### Overworld
- Node-and-route map: castles, towns, villages, lairs. Fixed routes; no free movement.
- **Turn-based.** One turn moves a division to an adjacent node, and enemy divisions move one node in the same turn. Both sides commit, then the turn resolves together — neither side sees the other's move first.
- **Every action costs a turn.** Marching, searching a node for wild troops, recovering troops, holding position: each is one turn, and the enemy advances a node during it. Time pressure comes from the turn economy, not a real-time clock.
- Armies are **divisions** of 1–5 generals. All divisions move one node per turn regardless of troop species; slowest-member speed is no longer a movement factor.
- A battle triggers when hostile divisions end a turn on the same node, when a division enters an enemy castle with a garrison, or when two hostile divisions **swap nodes** along the same route in one turn (they cannot slip past each other).
- **Losing or retreating returns the division to the node it came from.** Every division remembers its previous node for exactly this.
- Garrisoned generals heal HP and refill troops per turn spent resting, capped per town per week.
- Victory: hold every enemy castle. Defeat: hero dies, or you hold no castles.

### Node actions and biome recruitment
- A node has a **biome** that determines which wild troop species live there.
- **Search** is a turn action at a node: it may find wild troops and start a **recruitment battle** against them. Win and they join the acting general's company, up to capacity.
- Lairs are the richest biomes; towns and villages offer little or nothing. This is the Pokémon-flavoured pillar: you build a signature army from what you actually fight and beat.
- Search outcomes come from the seeded war RNG and the node's biome table, never from wall time.

### Battle sequencing
- A battle is a **series of skirmishes**: one general per side at a time, defender commits first, attacker responds, existing battle view runs the fight.
- Loser's general is defeated or retreats; winner may continue with remaining generals until one side has none left.
- Between skirmishes the player sees who remains and may retreat the division.
- A beaten or retreating division returns to its previous node. If that node is now hostile-occupied it keeps falling back along its arrival path to the last friendly or empty node; with nowhere to fall back to, the battle must be fought out.
- The existing single-skirmish battle view is the unit of play; sequencing wraps it.

### Weekly admin
- Every 7 turns the map pauses for: general awards (capacity/stat), recruiting captives, promoting veterans, troop training/evolution, garrison orders, and save.
- Admin costs no turn and no enemy movement happens inside it.

### Economy
- Villages produce income per turn. Income pays recruitment and training.
- No shop, items or equipment in MVP3. Explicitly deferred.

### Explicitly deferred (write them down, don't build them)
General bonds and combo specials; terrain modifiers; parley/diplomacy; multiple playable factions; story scenes and portraits; blend-slot limits; mentorship XP; cloud saves; desktop builds.

---

## Decided

- **Castle capacity: garrison 7 vs attacking division of 5.** Tighter than Dragon Force's 10v5 on purpose — castles are a real obstacle but can change hands, so the map stays fluid.
- **Turn-based overworld.** One node per turn; every node action costs a turn; enemies move one node per turn simultaneously.
- **Retreat and defeat return a division to its previous node.** No separate troop penalty for retreating; losing the skirmishes is the cost.
- **Starting force: hero + 2 generals, 100 troops total, freely split between them** subject to each general's command capacity. The player chooses the split at war start; the default split is even.
- **Map:** 12 nodes, 2 factions (you + 1 rival).
- **Rival generals:** 6 named, no recurring grudge logic.
- **Hero specials:** the hero keeps its single class special from MVP2. The 3–4 unlockable signature moves stay deferred.
- **Search success:** 50% at a lair, 20% in wilderness, never in a friendly settlement.
- **Enemy visibility:** divisions are visible within one node of a node you own or occupy. The resolved turn reveals where visible enemies moved.

## Open questions

None blocking. Raise new ones as phases land.

---

## Phases

Each phase ends green: `npm run check` and `npm run build` pass, independently reviewed, then merged to `mvp3`. Phases 1–2 are a hard contract boundary — nothing downstream starts until they are merged.

### Phase 1 — World contract and data (no behaviour)
`data/world.json`, `data/world-constants.json`, schema additions in `src/data/schemas.ts`, `src/world/types.ts`.
Node/route/division/faction/general-record types including each node's **biome** and each division's **previous node**; one authored starter map; zod validation with cross-reference checks (every route endpoint exists, map is connected, exactly one starting castle per faction, biome tables reference real species). Types-only public surface so later phases build in parallel.

### Phase 2 — Overworld simulation core (turn-based)
`src/world/{engine,turn,movement,upkeep,encounter}.ts`.
`createWar(data, setup)`, `resolveTurn(war)`, `issueOrder`, `hashWar`, `replayWar`. One turn per order per division: march to an adjacent node, search, rest or hold. All factions' orders resolve together; AI orders are queued the same way the player's are. Arrival and capture, garrison healing/resupply, income, turn and week counters, encounter detection producing a pending-battle record. Pure: no DOM, no `Date`, no `Math.random`. Tests: determinism, replay equality, simultaneous resolution, node-swap clash, week boundary fires exactly once, illegal orders rejected without mutation.

### Phase 3 — Battle sequencing
`src/world/sequence.ts`.
Turn a pending encounter into an ordered skirmish list; defender commits first; feed each skirmish the existing `BattleSetup`; apply each `BattleResult` to general HP, troop rosters and capture/injury rolls; decide continue/retreat/resolve. **A beaten or retreating division returns to its previous node**, falling back further only if that node is hostile-occupied. Idempotent per skirmish ID, exactly like `applyBattleResult`. Tests: multi-general sequences, retreat mid-sequence, castle assault against a 7-general garrison with a 5-general attacker, fallback when the previous node is taken, hero death ends the war, repeated results change nothing.

### Phase 4 — General promotion and the general track
`src/progression/general.ts`, extend `src/progression/index.ts`.
General-track XP above troop cap 12; eligibility; `promoteTroop` producing a general record that preserves id/name/species; command capacity growth; capture → recruit conversion. Tests: eligibility boundaries, identity preservation, roster removal, capacity caps, no double promotion.

### Phase 5 — Biome recruitment
`src/world/search.ts`, extend `data/world.json` biome tables.
A Search order consumes the turn, rolls the node's biome table from the seeded war RNG, and either finds nothing or produces a wild-troop encounter that runs through the same battle sequencing. Winning adds the defeated species to the acting general's company up to capacity. Tests: seeded determinism, biome gating, capacity clamping, nothing added on a loss, turn consumed either way.

### Phase 6 — Overworld UI
`src/ui/world/*`, `src/render/worldMap.ts`.
Pixi node-and-route map with division banners, selection, order entry (march/search/rest/hold), node panels, turn and week counters, an explicit **End turn** commit, and the resolved-turn reveal of visible enemy movement. Keyboard reachable. Verified in a real browser at 800×600, 1024×768, 1280×800.

### Phase 7 — Town, garrison and weekly admin UI
`src/ui/admin/*`.
Awards, captive recruitment, promotion, training, garrison orders, income summary. Costs no turn. One atomic save write per admin action, same discipline as `src/run/storage.ts`.

### Phase 8 — War save state
`src/world/{schema,storage}.ts`.
Versioned war snapshot: seed, turn, week, factions, nodes, divisions (including previous node), generals, rosters, captives, pending battle, processed skirmish IDs. Semantic validation of **every persisted reference** including effective general overrides — the exact class of bug found in PR #2. Corrupt saves offer recovery and are never silently rewritten. Resume mid-battle and mid-admin.

### Phase 9 — Strategic AI
`src/ai/strategy.ts`.
Per-faction personality (aggressive / defensive / opportunist): target selection, division composition, when to retreat and heal, garrison strength, and how it spends its one order per division per turn. Reads war state only, acts through the same orders the player uses. No cheating, no hidden information.

### Phase 10 — Campaign assembly and mode select
`src/main.ts`, `src/ui/flow/*`.
Hero select → war start → turn loop → battle → admin → victory/defeat. Mode select keeps Skirmish Campaign and Sandbox intact.

### Phase 11 — Headless war diagnostics
`tools/warsim.ts`.
Run whole campaigns headlessly with both AIs: campaign length in turns, castles taken per week, hero death rate, general churn, recruitment yield, income curves, end reasons. Reproducible with commit + content fingerprint, exactly like `tools/specialBalance.ts`. Fail loudly on unfinished wars; never report an aborted run as a loss.

### Phase 12 — Art and presentation
Overworld map art, node and biome icons, division banners, general portraits. Provisional is acceptable and must be labelled as such in `art/reviews/`.

### Phase 13 — Release
Full-campaign browser verification, balance pass from Phase 11 evidence, docs, PR to `main`.

---

## Correctness rules (non-negotiable)

- `src/world` imports nothing from `src/ui` or `src/render`, and uses no DOM, `Date` or `Math.random`.
- Every random outcome — encounters, capture rolls, recruitment, wounded recovery, AI choices — comes from the seeded war RNG, salted per consumer.
- Same seed plus same order log ⇒ identical `hashWar`. A replay test guards every phase.
- Battle results apply exactly once per skirmish ID. Reload during a battle resumes that frozen battle.
- Anything persisted that the UI renders or the engine consumes must be semantically validated on load, including stat/general overrides.
- Fixed tie-breaks must not favour faction 0; mirror a war against itself to check. Simultaneous turn resolution must not resolve one faction's moves before another's in a way that changes outcomes.
- No new runtime dependency without asking first.
