# MVP3 Phase 1-2 Implementation Plan — World Contract and Overworld Core

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task. Contract in `docs/mvp3.md`. Phases 3+ get their own plan files once this is merged.

**Goal:** a pure, deterministic, replayable overworld simulation with a validated authored map, ready for UI and battle sequencing to build against in parallel.

**Architecture:** `src/world` mirrors `src/sim`: validated JSON data, a types-only public contract, a fixed-step `stepWorld`, one seeded PRNG whose state lives in war state. No DOM, no `Date`, no `Math.random`. The day-tick is the world's fixed step; battles remain the existing separate simulation.

**Tech stack:** TypeScript, zod, Vitest. Node 22. No new dependencies.

**Baseline:** branch `mvp3` from `main` at `cac3773`. Gate is `npm run check` (492 tests) and `npm run build`.

---

## Reference: existing patterns to copy

- Data validation and cross-reference checks: `src/data/index.ts` `buildGameData()` — collects errors into an array and throws one readable message.
- Seeded RNG and salting: `src/sim/rng.ts`, and `SALT` / `mixSeed` usage in `src/run/engine.ts`.
- Fixed-step entry point: `src/sim/step.ts` `step(world)` — pending orders applied first, then phase work, then `tick++`.
- Public contract module: `src/sim/types.ts` (types only) plus `src/sim/index.ts` (re-exports).
- Determinism tests: `tests/sim/determinism.test.ts` pattern — same seed same hash, replay equals original, different seed differs.

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

export interface WorldNode {
  id: NodeId;
  kind: NodeKind;
  name: string;
  /** Map position for presentation only; the sim uses routes, not geometry. */
  x: number;
  y: number;
  owner: FactionId | null;
  /** Troops a town/castle can supply per week. 0 for villages and lairs. */
  supplyPerWeek: number;
  /** Income per day for the owning faction. */
  incomePerDay: number;
  /** Max generals a castle garrison holds. 0 for non-castles. */
  garrisonCap: number;
}

export interface WorldRoute {
  id: string;
  from: NodeId;
  to: NodeId;
  /** Travel cost in day-units at speed 1. */
  length: number;
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
  /** Troops under this general's command. */
  troops: ProgressTroop[];
  /** Set while injured; counts down in days. */
  injuredDays: number;
  /** Where this general is when not marching. */
  nodeId: NodeId | null;
}

export interface Division {
  id: DivisionId;
  factionId: FactionId;
  /** 1..5 general record ids, in battle order. */
  generals: GeneralRecordId[];
  /** Node the division is sitting at, or null while travelling. */
  atNode: NodeId | null;
  /** Active march, or null when stationary. */
  march: { routeId: string; from: NodeId; to: NodeId; progress: number } | null;
}

export interface Faction {
  id: FactionId;
  name: string;
  isPlayer: boolean;
  /** Strategic personality for AI factions. */
  personality: 'aggressive' | 'defensive' | 'opportunist';
  gold: number;
  /** Captured enemy generals awaiting recruitment. */
  captives: GeneralRecordId[];
  classes: ClassId[];
}

export type WarPhase = 'march' | 'battle' | 'admin' | 'won' | 'lost';

/** A battle the world has triggered and is waiting on. */
export interface PendingBattle {
  id: string;
  nodeId: NodeId;
  attacker: DivisionId;
  /** Defending division, or null for an undefended node capture. */
  defender: DivisionId | null;
  /** Skirmish ids already applied; makes result application idempotent. */
  processedSkirmishIds: string[];
}

export type WorldEvent =
  | { type: 'arrived'; division: DivisionId; nodeId: NodeId }
  | { type: 'captured'; nodeId: NodeId; factionId: FactionId }
  | { type: 'battleTriggered'; battleId: string }
  | { type: 'dayPassed'; day: number }
  | { type: 'weekPassed'; week: number }
  | { type: 'healed'; general: GeneralRecordId; hp: number }
  | { type: 'resupplied'; general: GeneralRecordId; troops: number };

export type MarchOrder = { type: 'march'; division: DivisionId; toNode: NodeId };
export type RecordedWorldOrder = { day: number; tick: number; order: MarchOrder };

export interface War {
  version: 1;
  id: string;
  seed: number;
  /** Fixed-step tick count; DAY_TICKS ticks make one day. */
  tick: number;
  day: number;
  week: number;
  paused: boolean;
  phase: WarPhase;
  factions: Faction[];
  nodes: WorldNode[];
  routes: WorldRoute[];
  generals: GeneralRecord[];
  divisions: Division[];
  pendingBattle: PendingBattle | null;
  events: WorldEvent[];
  orderLog: RecordedWorldOrder[];
  /** Internal: RNG state and lookups. Not part of the public contract. */
  _internal: unknown;
}
```

**Step 2:** Run `npm run typecheck`. Expected: PASS (types only).

**Step 3:** Commit.

```bash
git add src/world/types.ts
git commit -m "feat(world): add overworld public type contract"
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
      nodes: [{ id: 'a', kind: 'castle', name: 'A', x: 0, y: 0, owner: 'player', supplyPerWeek: 20, incomePerDay: 0, garrisonCap: 10 }],
      routes: [],
      factions: [{ id: 'player', name: 'You', isPlayer: true, personality: 'aggressive', classes: ['human'] }],
    });
    expect(parsed.nodes[0]!.kind).toBe('castle');
  });

  it('rejects an unknown node kind and a negative length', () => {
    expect(WorldDataSchema.safeParse({ nodes: [{ id: 'a', kind: 'fortress', name: 'A', x: 0, y: 0, owner: null, supplyPerWeek: 0, incomePerDay: 0, garrisonCap: 0 }], routes: [], factions: [] }).success).toBe(false);
    expect(WorldDataSchema.safeParse({ nodes: [], routes: [{ id: 'r', from: 'a', to: 'b', length: -1 }], factions: [] }).success).toBe(false);
  });
});
```

**Step 2:** Run `npm test -- tests/world/worldData.test.ts`. Expected: FAIL — `WorldDataSchema` is not exported.

**Step 3:** Append to `src/data/schemas.ts`:

```ts
export const WorldNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['castle', 'town', 'village', 'lair']),
  name: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  owner: z.string().min(1).nullable(),
  supplyPerWeek: z.number().int().nonnegative(),
  incomePerDay: z.number().int().nonnegative(),
  garrisonCap: z.number().int().nonnegative(),
});
export const WorldRouteSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  length: z.number().positive(),
});
export const WorldFactionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isPlayer: z.boolean(),
  personality: z.enum(['aggressive', 'defensive', 'opportunist']),
  classes: z.array(ClassIdSchema).min(1),
});
export const WorldDataSchema = z.object({
  nodes: z.array(WorldNodeSchema),
  routes: z.array(WorldRouteSchema),
  factions: z.array(WorldFactionSchema),
});
export type WorldData = z.infer<typeof WorldDataSchema>;
```

**Step 4:** Run the test. Expected: 2 passed.

**Step 5:** Commit.

---

### Task 3: Authored starter map

**Objective:** one real 12-node, 2-faction map as data.

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
  // Every route endpoint exists and the map is one connected component.
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

**Step 3:** Author `data/world.json`: 2 castles (one per faction at opposite ends), 3 towns, 5 villages, 2 lairs, routes forming a connected graph with two plausible fronts. Castles `garrisonCap: 10`, `supplyPerWeek: 20`; towns `supplyPerWeek: 10`, `incomePerDay: 2`; villages `incomePerDay: 3`; lairs all zeros.

**Step 4:** Run the test. Expected: 3 passed.

**Step 5:** Commit.

---

### Task 4: World constants

**Objective:** day-tick rate and world tuning in validated JSON.

**Files:**
- Create: `data/world-constants.json`
- Modify: `src/data/schemas.ts`
- Test: `tests/world/worldData.test.ts`

Constants: `DAY_TICKS` 20, `DAYS_PER_WEEK` 7, `HEAL_HP_PER_DAY_FRAC` 0.1, `RESUPPLY_TROOPS_PER_DAY` 3, `MARCH_SPEED_PER_DAY` 1, `RETREAT_TROOP_LOSS_FRAC` 0.25, `CAPTURE_WEIGHT` 0.6, `INJURE_WEIGHT` 0.3, `KILL_WEIGHT` 0.1, `GARRISON_VS_DIVISION` [10, 5], `MAX_DIVISION_GENERALS` 5.

Test that the three defeat weights sum to 1 and that `DAY_TICKS` is a positive integer. Same red-green-commit cycle.

---

### Task 5: `buildWorldData` with cross-reference checks

**Objective:** one validated, lookup-rich world dataset, mirroring `buildGameData`.

**Files:**
- Create: `src/world/data.ts`
- Test: `tests/world/worldData.test.ts`

Checks, all collected then thrown as one message: unknown route endpoints; duplicate node/route/faction ids; node owner referencing an unknown faction; a faction with no starting castle; disconnected map; `garrisonCap > 0` only on castles; self-routes. Returns `{ nodes, routes, factions, constants, nodeById, routeById, factionById, routesFrom }`.

Test each failure mode with a deliberately broken fixture and assert the message names the offending id. Red-green-commit.

---

### Task 6: War creation

**Objective:** `createWar` builds a valid initial war from data plus a setup.

**Files:**
- Create: `src/world/engine.ts`, `src/world/rng.ts` (re-export `src/sim/rng.ts` helpers with world salts)
- Test: `tests/world/createWar.test.ts`

`createWar(data, { seed, heroId, heroName })` produces: faction records with starting gold; the hero as a `GeneralRecord` with `isHero: true` at its faction castle; starting generals and troops per `docs/mvp3.md` defaults; one player division at its castle; rival divisions per faction personality; `tick: 0`, `day: 1`, `week: 1`, `phase: 'march'`, `paused: false`.

Tests: hero identity and placement; roster counts; every general sits at a node; no division exceeds `MAX_DIVISION_GENERALS`; two `createWar` calls with the same seed are deeply equal; different seeds differ. Red-green-commit.

---

### Task 7: `hashWar` and the order queue

**Objective:** a stable hash and queued-order plumbing, so determinism tests can exist before movement does.

**Files:**
- Modify: `src/world/engine.ts`
- Create: `src/world/index.ts` (public re-exports, mirroring `src/sim/index.ts`)
- Test: `tests/world/determinism.test.ts`

`hashWar(war)` mixes tick/day/phase/node owners/division positions/general HP and troop counts — the same FNV-style mix as `hashWorld`. `issueMarchOrder(war, division, toNode)` pushes onto an internal pending queue and is applied at the start of the next executed tick, then appended to `orderLog`.

Tests: hash is stable for an unchanged war; changes when a division moves; queued orders do not take effect until a tick runs. Red-green-commit.

---

### Task 8: Fixed-step `stepWorld` — day and week rollover

**Objective:** the world clock.

**Files:**
- Create: `src/world/step.ts`
- Test: `tests/world/clock.test.ts`

`stepWorld(war)`: no-op when `paused` or `phase` is `battle`/`admin`/`won`/`lost`; otherwise clear `events`, apply pending orders, advance movement (Task 9), run daily upkeep on day boundaries, emit `dayPassed`, and on `DAYS_PER_WEEK` boundaries set `phase: 'admin'` and emit `weekPassed`; then `tick++`.

Tests: `DAY_TICKS` steps advance exactly one day; a week boundary fires once and enters admin; pause freezes tick/day; `phase: 'admin'` freezes the clock until cleared. Red-green-commit.

---

### Task 9: Division movement

**Objective:** divisions march along routes at their slowest general's pace.

**Files:**
- Create: `src/world/movement.ts`
- Test: `tests/world/movement.test.ts`

A march order from a node with a route to the target starts a march; illegal targets (no route, division already marching, division is empty) are rejected without mutating state. Progress advances by `MARCH_SPEED_PER_DAY * slowestSpeed / DAY_TICKS` per tick, where speed comes from each general's slowest troop species via `data.unitById`. On `progress >= length` the division arrives: `atNode` set, `march` cleared, `arrived` emitted. An unowned or enemy node with no defender flips owner and emits `captured`.

Tests: legal and illegal orders; arrival timing from route length and speed; slowest-member pacing; undefended capture; a general-less division cannot march. Red-green-commit.

---

### Task 10: Daily upkeep — healing, resupply, income, injury recovery

**Objective:** garrison recovery and economy.

**Files:**
- Create: `src/world/upkeep.ts`
- Test: `tests/world/upkeep.test.ts`

On each day boundary, for every general at a friendly town/castle: heal `HEAL_HP_PER_DAY_FRAC` of max HP (clamped), and resupply up to `RESUPPLY_TROOPS_PER_DAY` fresh stage-1 troops of an unlocked class while the node's weekly supply budget and the general's capacity allow. Weekly budgets reset on week rollover. Owners collect `incomePerDay` from owned nodes. Injured generals decrement `injuredDays` and become available at 0.

Tests: healing clamps at max HP; resupply respects both capacity and weekly supply, and the budget resets weekly; income accrues per owned node; marching generals do not heal; injury countdown. Red-green-commit.

---

### Task 11: Encounter detection

**Objective:** hostile contact produces exactly one pending battle.

**Files:**
- Create: `src/world/encounter.ts`
- Test: `tests/world/encounter.test.ts`

After movement, detect: two hostile divisions on the same node; a division arriving at an enemy castle with a garrison; two hostile divisions crossing on the same route. Produce one `PendingBattle` with a deterministic id, set `phase: 'battle'`, emit `battleTriggered`, and stop further movement that tick. While a pending battle exists no new one is created.

Tests: node contact, castle assault, mid-route crossing, no duplicate pending battle, allied divisions sharing a node do not fight, deterministic battle ids. Red-green-commit.

---

### Task 12: `replayWar` and the determinism suite

**Objective:** prove the whole layer replays exactly.

**Files:**
- Modify: `src/world/engine.ts`, `src/world/index.ts`
- Test: `tests/world/determinism.test.ts`

`replayWar(data, setup, orderLog, maxTicks)` re-runs from the log and must reproduce an identical `hashWar`.

Tests: a 30-day war with scripted marches replays to the same hash; a different seed diverges; pause windows in the log do not change the outcome; a mirrored war (same map, both factions identical) is not biased toward faction 0 across a seed ensemble. Red-green-commit.

---

### Task 13: Phase gate

**Objective:** verify the whole phase and hand off.

**Step 1:** `npm run check` — expect 492 baseline plus the new world suites, all passing.
**Step 2:** `npm run build` — expect success.
**Step 3:** `git diff --check`.
**Step 4:** Confirm `src/world` has no imports from `src/ui`, `src/render`, `pixi.js`, and no `Date`/`Math.random`:

```bash
grep -rnE "from '\.\./(ui|render)|pixi\.js|Math\.random|new Date|Date\.now" src/world/ && echo "VIOLATION" || echo "PURE"
```

**Step 5:** Commit and open the phase PR against `mvp3`.

---

## Verification checklist

- [ ] `src/world` is pure: no DOM, Pixi, `Date` or `Math.random`
- [ ] Same seed ⇒ identical `hashWar`; replay equals original; different seed differs
- [ ] Mirrored war shows no faction-0 bias across a seed ensemble
- [ ] Pause and admin both freeze the clock
- [ ] Week boundary fires exactly once per week
- [ ] Illegal orders are rejected without mutating state
- [ ] One pending battle at a time, with deterministic ids
- [ ] Every data error names the offending id
- [ ] `npm run check` and `npm run build` pass
