# MVP3 — The full game

> For Hermes: this is the contract. Execute with subagent-driven-development; independent spec and quality review per task. `docs/design.md` remains the north star; this document is what MVP3 actually commits to. MVP2 docs remain historical.

**Goal:** a complete playable campaign — choose a hero, march a living overworld, fight sequenced general-vs-general battles, take castles, promote veterans into generals, and win or lose a war.

**Architecture:** add a pure overworld/campaign layer (`src/world`) beside the existing pure battle simulation (`src/sim`). The overworld is a fixed-step deterministic simulation too: same seeded-RNG discipline, same replay guarantees, no DOM or wall-clock inside it. Battles stay exactly as they are and are invoked *by* the overworld rather than by the campaign screen. One versioned save snapshot holds the whole war.

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
- Real-time but **pausable, and it pauses whenever any menu is open**. Fixed-step simulation underneath, so it replays exactly.
- Armies are **divisions** of 1–5 generals that march node to node. Speed is the slowest member's speed.
- Two hostile divisions meeting on a node or route triggers a battle. Castle assault is a battle against its garrison.
- Garrisoned generals heal HP and refill troops per day, capped per town per week.
- Victory: hold every enemy castle. Defeat: hero dies, or you hold no castles.

### Battle sequencing
- A battle is a **series of skirmishes**: one general per side at a time, defender commits first, attacker responds, existing battle view runs the fight.
- Loser's general is defeated or retreats; winner may continue with remaining generals until one side has none left.
- Between skirmishes the player sees who remains and may retreat the division.
- The existing single-skirmish battle view is the unit of play; sequencing wraps it.

### Weekly admin
- Every 7 in-game days the map pauses for: general awards (capacity/stat), recruiting captives, promoting veterans, troop training/evolution, garrison orders, and save.
- Admin is a hard pause: no enemy movement while it is open.

### Economy
- Villages produce income per day. Income pays recruitment and training.
- No shop, items or equipment in MVP3. Explicitly deferred.

### Explicitly deferred (write them down, don't build them)
General bonds and combo specials; terrain modifiers; parley/diplomacy; multiple playable factions; story scenes and portraits; blend-slot limits; mentorship XP; cloud saves; desktop builds.

---

## Open questions — answer before Phase 3

Defaults are what will be built if you say nothing.

1. **Map size.** Default: 12 nodes, 2 factions (you + 1 rival), ~45 min campaign.
2. **Starting force.** Default: hero + 2 generals, 60 troops total.
3. **Rival generals.** Default: 6 named rival generals, no recurring grudge logic.
4. **Castle capacity.** Default: garrison 10 vs attacking division of 5, as in Dragon Force.
5. **Retreat cost.** Default: retreating division loses 25% of surviving troops and falls back one node.
6. **Hero signature moves.** Default: the hero keeps its single class special from MVP2; the 3–4 unlockable signature moves stay deferred.

---

## Phases

Each phase ends green: `npm run check` and `npm run build` pass, independently reviewed, then merged to `mvp3`. Phases 1–2 are a hard contract boundary — nothing downstream starts until they are merged.

### Phase 1 — World contract and data (no behaviour)
`data/world.json`, `data/world-schema` additions in `src/data/schemas.ts`, `src/world/types.ts`.
Node/route/division/faction/general-record types; one authored starter map; zod validation with cross-reference checks (every route endpoint exists, every garrison general exists, map is connected, exactly one starting castle per faction). Types-only public surface so later phases build in parallel.

### Phase 2 — Overworld simulation core
`src/world/{engine,step,movement,encounter}.ts`.
`createWar(data, setup)`, `stepWorld(war)` at a fixed day-tick, `setWorldPaused`, `issueMarchOrder`, `hashWar`, `replayWar`. Division movement along routes, arrival, garrison healing, village income, day/week rollover, encounter detection producing a pending-battle record. Pure: no DOM, no `Date`, no `Math.random`. Tests: determinism, replay equality, pause freezes time, encounter triggers on node and mid-route, week boundary fires exactly once.

### Phase 3 — Battle sequencing
`src/world/sequence.ts`.
Turn a pending encounter into an ordered skirmish list; defender commits first; feed each skirmish the existing `BattleSetup`; apply each `BattleResult` to general HP, troop rosters and capture/injury rolls; decide continue/retreat/resolve. Idempotent per skirmish ID, exactly like `applyBattleResult`. Tests: multi-general sequences, retreat mid-sequence, castle assault vs garrison, hero death ends the war, repeated results change nothing.

### Phase 4 — General promotion and the general track
`src/progression/general.ts`, extend `src/progression/index.ts`.
General-track XP above troop cap 12; eligibility; `promoteTroop` producing a general record that preserves id/name/species; command capacity growth; capture → recruit conversion. Tests: eligibility boundaries, identity preservation, roster removal, capacity caps, no double promotion.

### Phase 5 — Overworld UI
`src/ui/world/*`, `src/render/worldMap.ts`.
Pixi node-and-route map with division banners, selection, march orders, node panels, day/week clock, pause-on-menu, and the real pause semantics from Phase 2. Keyboard reachable. Verified in a real browser at 800×600, 1024×768, 1280×800.

### Phase 6 — Town, garrison and weekly admin UI
`src/ui/admin/*`.
Awards, captive recruitment, promotion, training, garrison orders, income summary. One atomic save write per admin action, same discipline as `src/run/storage.ts`.

### Phase 7 — War save state
`src/world/{schema,storage}.ts`.
Versioned war snapshot: seed, day, factions, nodes, divisions, generals, rosters, captives, pending battle, processed skirmish IDs. Semantic validation of **every persisted reference** including effective general overrides — the exact class of bug found in PR #2. Corrupt saves offer recovery and are never silently rewritten. Resume mid-battle and mid-admin.

### Phase 8 — Strategic AI
`src/ai/strategy.ts`.
Per-faction personality (aggressive / defensive / opportunist): target selection, division composition, when to retreat and heal, garrison strength. Reads war state only, acts through the same orders the player uses. No cheating, no hidden information.

### Phase 9 — Campaign assembly and mode select
`src/main.ts`, `src/ui/flow/*`.
Hero select → war start → march → battle → admin → victory/defeat. Mode select keeps Skirmish Campaign and Sandbox intact.

### Phase 10 — Headless war diagnostics
`tools/warsim.ts`.
Run whole campaigns headlessly with both AIs: campaign length, castles taken per week, hero death rate, general churn, income curves, end reasons. Reproducible with commit + content fingerprint, exactly like `tools/specialBalance.ts`. Fail loudly on unfinished wars; never report an aborted run as a loss.

### Phase 11 — Art and presentation
Overworld map art, node icons, division banners, general portraits. Provisional is acceptable and must be labelled as such in `art/reviews/`.

### Phase 12 — Release
Full-campaign browser verification, balance pass from Phase 10 evidence, docs, PR to `main`.

---

## Correctness rules (non-negotiable)

- `src/world` imports nothing from `src/ui` or `src/render`, and uses no DOM, `Date` or `Math.random`.
- Every random outcome — encounters, capture rolls, recruitment, wounded recovery, AI choices — comes from the seeded war RNG, salted per consumer.
- Same seed plus same order log ⇒ identical `hashWar`. A replay test guards every phase.
- Battle results apply exactly once per skirmish ID. Reload during a battle resumes that frozen battle.
- Anything persisted that the UI renders or the engine consumes must be semantically validated on load, including stat/general overrides.
- Fixed tie-breaks must not favour faction 0; mirror a war against itself to check.
- No new runtime dependency without asking first.
