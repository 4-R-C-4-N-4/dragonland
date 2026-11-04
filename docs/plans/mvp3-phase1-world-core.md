# MVP3 Phase 1-2 Implementation Plan — World Contract and Turn-Based Overworld Core

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task. Contract in `docs/mvp3.md`. Phases 3+ get their own plan files once this is merged.

**Goal:** a pure, deterministic, replayable turn-based overworld with a validated authored map, ready for UI and battle sequencing to build against in parallel.

**Architecture:** `src/world` mirrors `src/sim`: validated JSON data, a types-only public contract, one seeded PRNG whose state lives in war state. The unit of time is a **turn**, not a tick. Each division gets one order per turn — march to an adjacent node, search, rest or hold — and **all factions' orders resolve together**, so neither side sees the other's move first. No DOM, no `Date`, no `Math.random`. Battles remain the existing separate simulation.

**Tech stack:** TypeScript, zod, Vitest. Node 22. No new dependencies.

**Baseline:** branch `mvp3` from `main` at `cac3773`. Gate is `npm run check` (492 tests) and `npm run build`.

---

## Reference: existing patterns to copy

- Data validation and cross-reference checks: `src/data/index.ts` `buildGameData()` — collects errors into an array and throws one readable message.
- Seeded RNG and salting: `src/sim/rng.ts`, and `SALT` / `mixSeed` usage in `src/run/engine.ts`.
- Queued orders applied at a resolution boundary, then logged: `src/sim/step.ts` `applyPendingCommands`.
- Public contract module: `src/sim/types.ts` (types only) plus `src/sim/index.ts` (re-exports).
- Idempotent result application: `src/run/engine.ts` `applyBattleResult` with `processedBattleIds`.
- Determinism tests: `tests/sim/determinism.test.ts` — same seed same hash, replay equals original, different seed differs.

---

### Task 1: World data types

**Objective:** types-only contract for the overworld so later phases compile against it.

**Files:**
- Create: `src/world/types.ts`

**Step 1:** Write the module. Types only, no logic, no imports from render/UI.

```ts
// Public world contract. UI, AI and the headless runner depend ONLY on this file
// and src/world/index.ts. Pure TS: no DOM, no Pixi, no Math.random, no Date.
import type { ClassId, GeneralId } from '../data/schemas';
import type { ProgressTroop } from '../progression';

export type FactionId = string;
export type NodeId = string;
export type DivisionId = string;
export type GeneralRecordId = string;

export type NodeKind = 'castle' | 'town' | 'village' | 'lair';
/** Drives which wild species a Search order can find. */
export type Biome = 'plains' | 'forest' | 'mountain' | 'swamp' | 'ruins' | 'settled';

export interface WorldNode {
  id: NodeId;
  kind: NodeKind;
  biome: Biome;
  name: string;
  /** Map position for presentation only; the sim uses routes, not geometry. */
  x: number;
  y: number;
  owner: FactionId | null;
  /** Troops a town/castle can supply per week. 0 for villages and lairs. */
  supplyPerWeek: number;
  /** Income per turn for the owning faction. */
  incomePerTurn: number;
  /** Max generals a castle garrison holds. 0 for non-castles. */
  garrisonCap: number;
}

/** Routes are adjacency only: one turn crosses one route, whatever its shape. */
export interface WorldRoute {
  id: string;
  from: NodeId;
  to: NodeId;
}

/** A named general: the hero, a promoted veteran, or a rival. */
export interface GeneralRecord {
  id: GeneralRecordId;
  name: string;
  /** Catalog hero/stage-3 species this general's profile comes from. */
  generalId: GeneralId;
  factionId: FactionId;
  isHero: boolean;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  /** Max troops this general may lead. */
  capacity: number;
  troops: ProgressTroop[];
  /** Set while injured; counts down one per turn. */
  injuredTurns: number;
  /** Which node this general is at. */
  nodeId: NodeId;
}

export interface Division {
  id: DivisionId;
  factionId: FactionId;
  /** 1..MAX_DIVISION_GENERALS general record ids, in battle order. */
  generals: GeneralRecordId[];
  /** Node the division occupies. Divisions are always on a node. */
  atNode: NodeId;
  /** Node it came from; a beaten or retreating division returns here. */
  previousNode: NodeId | null;
}

export interface Faction {
  id: FactionId;
  name: string;
  isPlayer: boolean;
  personality: 'aggressive' | 'defensive' | 'opportunist';
  gold: number;
  /** Captured enemy generals awaiting recruitment. */
  captives: GeneralRecordId[];
  classes: ClassId[];
}

export type WarPhase = 'orders' | 'battle' | 'admin' | 'won' | 'lost';

/** One division's action for the current turn. */
export type WorldOrder =
  | { type: 'march'; division: DivisionId; toNode: NodeId }
  | { type: 'search'; division: DivisionId }
  | { type: 'rest'; division: DivisionId }
  | { type: 'hold'; division: DivisionId };

export type BattleCause = 'contact' | 'swap' | 'assault' | 'wild';

/** A battle the world has triggered and is waiting on. */
export interface PendingBattle {
  id: string;
  cause: BattleCause;
  nodeId: NodeId;
  attacker: DivisionId;
  /** Defending division, or null for a garrison-only or wild encounter. */
  defender: DivisionId | null;
  /** Wild species for a Search encounter, else empty. */
  wild: { unitId: string; count: number }[];
  /** Skirmish ids already applied; makes result application idempotent. */
  processedSkirmishIds: string[];
}

export type WorldEvent =
  | { type: 'moved'; division: DivisionId; from: NodeId; to: NodeId }
  | { type: 'captured'; nodeId: NodeId; factionId: FactionId }
  | { type: 'battleTriggered'; battleId: string; cause: BattleCause }
  | { type: 'searchedNothing'; division: DivisionId; nodeId: NodeId }
  | { type: 'turnPassed'; turn: number }
  | { type: 'weekPassed'; week: number }
  | { type: 'healed'; general: GeneralRecordId; hp: number }
  | { type: 'resupplied'; general: GeneralRecordId; troops: number }
  | { type: 'retreated'; division: DivisionId; toNode: NodeId };

export interface RecordedWorldTurn {
  turn: number;
  orders: WorldOrder[];
}

export interface War {
  version: 1;
  id: string;
  seed: number;
  turn: number;
  week: number;
  phase: WarPhase;
  factions: Faction[];
  nodes: WorldNode[];
  routes: WorldRoute[];
  generals: GeneralRecord[];
  divisions: Division[];
  pendingBattle: PendingBattle | null;
  events: WorldEvent[];
  /** Every resolved turn's orders, for replay. */
  turnLog: RecordedWorldTurn[];
  /** Internal: RNG state, lookups, weekly supply budgets. Not public contract. */
  _internal: unknown;
}
```

**Step 2:** Run `npm run typecheck`. Expected: PASS (types only).

**Step 3:** Commit.

```bash
git add src/world/types.ts
git commit -m "feat(world): add turn-based overworld type contract"
```

---

### Task 2: World data schema

**Objective:** zod schemas for the authored map, matching the Task 1 types.

**Files:**
- Modify: `src/data/schemas.ts` (append; do not touch existing schemas)
- Test: `tests/world/worldData.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { WorldDataSchema } from '../../src/data/schemas';

describe('world data schema', () => {
  it('accepts a minimal valid map', () => {
    const parsed = WorldDataSchema.parse({
      nodes: [{ id: 'a', kind: 'castle', biome: 'settled', name: 'A', x: 0, y: 0, owner: 'player', supplyPerWeek: 20, incomePerTurn: 0, garrisonCap: 7 }],
      routes: [],
      factions: [{ id: 'player', name: 'You', isPlayer: true, personality: 'aggressive', classes: ['human'] }],
      biomes: { settled: [] },
    });
    expect(parsed.nodes[0]!.garrisonCap).toBe(7);
  });

  it('rejects an unknown node kind, an unknown biome and a self route', () => {
    const base = { routes: [], factions: [{ id: 'p', name: 'P', isPlayer: true, personality: 'aggressive', classes: ['human'] }], biomes: {} };
    const node = { id: 'a', kind: 'castle', biome: 'settled', name: 'A', x: 0, y: 0, owner: null, supplyPerWeek: 0, incomePerTurn: 0, garrisonCap: 0 };
    expect(WorldDataSchema.safeParse({ ...base, nodes: [{ ...node, kind: 'fortress' }] }).success).toBe(false);
    expect(WorldDataSchema.safeParse({ ...base, nodes: [{ ...node, biome: 'lava' }] }).success).toBe(false);
    expect(WorldDataSchema.safeParse({ ...base, nodes: [node], routes: [{ id: 'r', from: 'a', to: 'a' }] }).success).toBe(false);
  });
});
```

**Step 2:** Run `npm test -- tests/world/worldData.test.ts`. Expected: FAIL — `WorldDataSchema` is not exported.

**Step 3:** Append to `src/data/schemas.ts`:

```ts
export const BiomeSchema = z.enum(['plains', 'forest', 'mountain', 'swamp', 'ruins', 'settled']);
export const WorldNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['castle', 'town', 'village', 'lair']),
  biome: BiomeSchema,
  name: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  owner: z.string().min(1).nullable(),
  supplyPerWeek: z.number().int().nonnegative(),
  incomePerTurn: z.number().int().nonnegative(),
  garrisonCap: z.number().int().nonnegative(),
});
export const WorldRouteSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
}).refine((r) => r.from !== r.to, 'route endpoints must differ');
export const WorldFactionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isPlayer: z.boolean(),
  personality: z.enum(['aggressive', 'defensive', 'opportunist']),
  classes: z.array(ClassIdSchema).min(1),
});
/** Wild species a Search order can find, per biome, with relative weights. */
export const BiomeTableSchema = z.record(BiomeSchema, z.array(z.object({
  unitId: z.string().min(1),
  weight: z.number().positive(),
  count: z.number().int().positive(),
})));
export const WorldDataSchema = z.object({
  nodes: z.array(WorldNodeSchema),
  routes: z.array(WorldRouteSchema),
  factions: z.array(WorldFactionSchema),
  biomes: BiomeTableSchema,
});
export type WorldData = z.infer<typeof WorldDataSchema>;
```

**Step 4:** Run the test. Expected: 2 passed.

**Step 5:** Commit.

---

### Task 3: Authored starter map

**Objective:** one real 12-node, 2-faction map with biome tables, as data.

**Files:**
- Create: `data/world.json`
- Test: extend `tests/world/worldData.test.ts`

**Step 1: Write failing test**

```ts
it('ships a connected starter map with one castle per faction', () => {
  const world = WorldDataSchema.parse(worldJson);
  expect(world.nodes).toHaveLength(12);
  expect(world.factions.map(f => f.id).sort()).toEqual(['invader', 'player']);
  for (const faction of world.factions) {
    expect(world.nodes.filter(n => n.owner === faction.id && n.kind === 'castle')).toHaveLength(1);
  }
  expect(world.nodes.filter(n => n.kind === 'castle').every(n => n.garrisonCap === 7)).toBe(true);
  const ids = new Set(world.nodes.map(n => n.id));
  for (const r of world.routes) { expect(ids.has(r.from)).toBe(true); expect(ids.has(r.to)).toBe(true); }
  const seen = new Set([world.nodes[0]!.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of world.routes) {
      if (seen.has(r.from) && !seen.has(r.to)) { seen.add(r.to); changed = true; }
      if (seen.has(r.to) && !seen.has(r.from)) { seen.add(r.from); changed = true; }
    }
  }
  expect(seen.size).toBe(world.nodes.length);
});
```

**Step 2:** Run it. Expected: FAIL — no `data/world.json`.

**Step 3:** Author `data/world.json`: 2 castles (one per faction at opposite ends, `garrisonCap: 7`, `supplyPerWeek: 20`, biome `settled`), 3 towns (`supplyPerWeek: 10`, `incomePerTurn: 2`, `settled`), 5 villages (`incomePerTurn: 3`, mixed wild biomes), 2 lairs (zeros, `mountain` and `swamp`). Routes form a connected graph with two plausible fronts. Biome tables: `settled` empty; each wild biome lists 2–3 stage-1 species with weights and counts, drawn from `data/units.json`.

**Step 4:** Run the test. Expected: 3 passed.

**Step 5:** Commit.

---

### Task 4: World constants

**Objective:** turn tuning in validated JSON.

**Files:**
- Create: `data/world-constants.json`
- Modify: `src/data/schemas.ts`
- Test: `tests/world/worldData.test.ts`

Constants: `TURNS_PER_WEEK` 7, `HEAL_HP_PER_REST_FRAC` 0.25, `RESUPPLY_TROOPS_PER_REST` 6, `CAPTURE_WEIGHT` 0.6, `INJURE_WEIGHT` 0.3, `KILL_WEIGHT` 0.1, `GARRISON_CAP` 7, `MAX_DIVISION_GENERALS` 5, `SEARCH_CHANCE_LAIR` 0.5, `SEARCH_CHANCE_WILD` 0.2, `INJURY_TURNS` 3, `STARTING_GOLD` 100.

Test that the three defeat weights sum to 1, that `TURNS_PER_WEEK` and `MAX_DIVISION_GENERALS` are positive integers, and that `GARRISON_CAP` exceeds `MAX_DIVISION_GENERALS` — the defender advantage is intentional. Red-green-commit.

---

### Task 5: `buildWorldData` with cross-reference checks

**Objective:** one validated, lookup-rich world dataset, mirroring `buildGameData`.

**Files:**
- Create: `src/world/data.ts`
- Test: `tests/world/worldData.test.ts`

Checks, all collected then thrown as one message: unknown route endpoints; duplicate node/route/faction ids; node owner referencing an unknown faction; a faction with no starting castle; disconnected map; `garrisonCap > 0` on a non-castle; biome table entries referencing unknown or non-stage-1 species; a wild biome with an empty table. Returns `{ nodes, routes, factions, biomes, constants, nodeById, routeById, factionById, neighbours }` where `neighbours` maps a node id to its adjacent node ids.

Test each failure mode with a deliberately broken fixture and assert the message names the offending id. Also assert `neighbours` is symmetric. Red-green-commit.

---

### Task 6: War creation

**Objective:** `createWar` builds a valid initial war from data plus a setup.

**Files:**
- Create: `src/world/engine.ts`, `src/world/rng.ts` (world salts over `src/sim/rng.ts`)
- Test: `tests/world/createWar.test.ts`

`createWar(data, { seed, heroId, heroName })` produces: faction records with `STARTING_GOLD`; the hero as a `GeneralRecord` with `isHero: true` at its faction castle; starting generals and troops per `docs/mvp3.md` defaults; one player division at its castle with `previousNode: null`; rival divisions per faction personality; `turn: 1`, `week: 1`, `phase: 'orders'`.

Tests: hero identity and placement; roster counts; every division sits on a node; no division exceeds `MAX_DIVISION_GENERALS`; two `createWar` calls with the same seed are deeply equal; different seeds differ. Red-green-commit.

---

### Task 7: `hashWar` and the order queue

**Objective:** a stable hash and order plumbing, before resolution exists.

**Files:**
- Modify: `src/world/engine.ts`
- Create: `src/world/index.ts` (public re-exports, mirroring `src/sim/index.ts`)
- Test: `tests/world/determinism.test.ts`

`hashWar(war)` mixes turn/week/phase/node owners/division positions and previous nodes/general HP and troop counts — the same FNV-style mix as `hashWorld`. `issueOrder(war, order)` validates that the division exists, stores **one order per division** (a second order for the same division replaces the first), and mutates nothing else.

Tests: hash stable for an unchanged war; changes when a division moves; latest order per division wins; an order for an unknown division is rejected without mutation. Red-green-commit.

---

### Task 8: `resolveTurn` — simultaneous resolution and the clock

**Objective:** the turn engine.

**Files:**
- Create: `src/world/turn.ts`
- Test: `tests/world/turn.test.ts`

`resolveTurn(war)`:
1. No-op unless `phase === 'orders'`.
2. Clear `events`.
3. Snapshot every division's intended action from its queued order; divisions with no order default to `hold`.
4. Resolve **movement for all factions from that one snapshot**, so no faction sees another's move first.
5. Detect encounters (Task 11). If one triggers, set `phase: 'battle'` and stop the rest of the turn.
6. Otherwise apply node actions (search/rest), upkeep and income (Task 10).
7. Append the turn's orders to `turnLog`, clear the queue, `turn++`, emit `turnPassed`.
8. On a `TURNS_PER_WEEK` boundary set `phase: 'admin'`, bump `week`, and emit `weekPassed`.

Tests: one call advances exactly one turn; two hostile divisions moving into each other's node both arrive and clash rather than one pre-empting the other; a week boundary fires once and enters admin; `phase: 'battle'` and `phase: 'admin'` both block further resolution until cleared; a division with no order holds. Red-green-commit.

---

### Task 9: Movement — one node per turn

**Objective:** adjacency movement with previous-node tracking and retreat resolution.

**Files:**
- Create: `src/world/movement.ts`
- Test: `tests/world/movement.test.ts`

A `march` order is legal only to a node adjacent to `atNode` via a real route, for a non-empty division. Illegal orders mutate nothing and resolve as `hold`. On a legal march: `previousNode = atNode`, `atNode = toNode`, emit `moved`. An unowned or enemy node with no defending division and no garrison flips owner and emits `captured`.

Also expose `retreatNode(war, division)`: returns the division's `previousNode`, walks further back to the last friendly or empty node when that node is hostile-occupied, or returns `null` when there is nowhere to fall back to. Phase 3 consumes this.

Tests: legal and illegal targets; non-adjacent rejected; previous node recorded on every move; undefended capture; a general-less division cannot march; `retreatNode` for the simple case, the hostile-previous-node case and the nowhere-to-go case. Red-green-commit.

---

### Task 10: Node actions and upkeep

**Objective:** rest, income, weekly supply and injury recovery.

**Files:**
- Create: `src/world/upkeep.ts`
- Test: `tests/world/upkeep.test.ts`

A `rest` order at a friendly town or castle heals each general in the division by `HEAL_HP_PER_REST_FRAC` of max HP (clamped) and resupplies up to `RESUPPLY_TROOPS_PER_REST` fresh stage-1 troops of an unlocked class, bounded by the node's remaining weekly supply budget and each general's capacity. Resting elsewhere heals nothing. Weekly budgets reset on week rollover. Every turn, owners collect `incomePerTurn` from owned nodes, and injured generals decrement `injuredTurns`.

Tests: healing clamps at max HP; resupply respects capacity and weekly supply; the budget resets weekly; resting on a neutral node does nothing; income accrues per owned node per turn; injury countdown reaches zero and frees the general. Red-green-commit.

---

### Task 11: Encounter detection

**Objective:** hostile contact produces exactly one pending battle.

**Files:**
- Create: `src/world/encounter.ts`
- Test: `tests/world/encounter.test.ts`

After movement resolves, detect in a sweep whose result does not depend on faction array order:
- `contact` — two hostile divisions on the same node.
- `swap` — two hostile divisions that exchanged nodes along the same route this turn; they cannot slip past each other.
- `assault` — a division on an enemy castle that still has a garrison.

Produce one `PendingBattle` with a deterministic id derived from turn and node, set `phase: 'battle'`, emit `battleTriggered`. While a pending battle exists no new one is created.

Tests: node contact; swap clash; castle assault; no duplicate pending battle; allied divisions sharing a node do not fight; deterministic ids; detection independent of faction ordering. Red-green-commit.

---

### Task 12: `replayWar` and the determinism suite

**Objective:** prove the whole layer replays exactly.

**Files:**
- Modify: `src/world/engine.ts`, `src/world/index.ts`
- Test: `tests/world/determinism.test.ts`

`replayWar(data, setup, turnLog, maxTurns)` re-runs from the log and must reproduce an identical `hashWar`.

Tests: a 30-turn war with scripted orders replays to the same hash; a different seed diverges; a mirrored war (same map, both factions identical and symmetric) shows no faction-0 bias across a seed ensemble; shuffling the order array within a single turn does not change the resolved outcome. Red-green-commit.

---

### Task 13: Phase gate

**Objective:** verify the whole phase and hand off.

**Step 1:** `npm run check` — expect 492 baseline plus the new world suites, all passing.
**Step 2:** `npm run build` — expect success.
**Step 3:** `git diff --check`.
**Step 4:** Confirm purity:

```bash
grep -rnE "from '\.\./(ui|render)|pixi\.js|Math\.random|new Date|Date\.now" src/world/ && echo "VIOLATION" || echo "PURE"
```

**Step 5:** Commit and open the phase PR against `mvp3`.

---

## Verification checklist

- [ ] `src/world` is pure: no DOM, Pixi, `Date` or `Math.random`
- [ ] Same seed ⇒ identical `hashWar`; replay equals original; different seed differs
- [ ] Simultaneous resolution: order within a turn does not change outcomes
- [ ] Mirrored war shows no faction-0 bias across a seed ensemble
- [ ] One order per division per turn; latest replaces earlier
- [ ] Illegal orders resolve as hold without corrupting state
- [ ] Every move records `previousNode`; `retreatNode` handles blocked fallback
- [ ] Castle garrison cap 7 exceeds division cap 5
- [ ] Week boundary fires exactly once per 7 turns and enters admin
- [ ] One pending battle at a time, with deterministic ids
- [ ] Every data error names the offending id
- [ ] `npm run check` and `npm run build` pass
