import { describe, expect, it } from 'vitest';
import { getGameData } from '../../../src/data';
import { createRng } from '../../../src/sim/rng';
import type { BattleSetup } from '../../../src/sim';
import { buildSideSetupFromLoadout } from '../../../src/ai/commit';
import { runHeadlessBattle } from '../../../src/ui/flow/headlessBattle';
import { createStore, type StorageLike } from '../../../src/persist/store';
import { companyComposition } from '../../../src/ui/builder/logic';
import type { Loadout } from '../../../src/data/schemas';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

const data = getGameData();

function mirrorSetup(seed: number): BattleSetup {
  const rng = createRng(seed);
  const mirror = data.aiLoadouts.find((l) => l.test) ?? data.aiLoadouts[0]!;
  const sideA = buildSideSetupFromLoadout(data, mirror, rng);
  const sideB = buildSideSetupFromLoadout(data, mirror, rng);
  return { seed, sides: [sideA, sideB] };
}

describe('runHeadlessBattle', () => {
  it('produces a result for a valid mirror-matchup setup', () => {
    const setup = mirrorSetup(42);
    const world = runHeadlessBattle(data, setup, { maxTicks: 50_000 });
    expect(world.result).not.toBeNull();
    expect(world.result!.winner === 0 || world.result!.winner === 1).toBe(true);
    expect(world.result!.dead[0].length + world.result!.survivors[0].length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const setup1 = mirrorSetup(7);
    const setup2 = mirrorSetup(7);
    const w1 = runHeadlessBattle(data, setup1, { maxTicks: 50_000 });
    const w2 = runHeadlessBattle(data, setup2, { maxTicks: 50_000 });
    expect(w1.result?.winner).toBe(w2.result?.winner);
    expect(w1.result?.dead[0].length).toBe(w2.result?.dead[0].length);
  });
});

describe('result -> roster update wiring', () => {
  it('applying a headless battle result removes the loser-side dead troops from the player roster', () => {
    const storage = memoryStorage();
    const store = createStore(storage, data);
    const roster = store.getRoster();

    // Build a player loadout entirely from real roster troop ids so dead ids match roster ids.
    const unitsByStage: string[] = Array.from(new Set(roster.map((t) => t.unitId)));
    const squadTroopIds = roster.slice(0, 10).map((t) => t.id);
    const loadout: Loadout = {
      id: 'player-1',
      name: 'Test Army',
      generalId: 'paladin',
      squads: [{ id: 'sq1', name: 'Squad 1', troopIds: squadTroopIds, disposition: 'mixed' }],
    };
    void unitsByStage;

    const playerSide = {
      generalId: loadout.generalId,
      formationId: 'line',
      squads: loadout.squads.map((s) => ({
        id: s.id,
        name: s.name,
        disposition: s.disposition,
        troops: s.troopIds.map((id) => {
          const t = roster.find((r) => r.id === id)!;
          return { troopId: t.id, name: t.name, unitId: t.unitId };
        }),
      })),
    };

    const rng = createRng(1);
    const mirror = data.aiLoadouts.find((l) => l.test) ?? data.aiLoadouts[0]!;
    const enemySide = buildSideSetupFromLoadout(data, mirror, rng);

    const setup: BattleSetup = { seed: 1, sides: [playerSide, enemySide] };
    const world = runHeadlessBattle(data, setup, { maxTicks: 50_000 });
    expect(world.result).not.toBeNull();

    const deadPlayerIds = world.result!.dead[0];
    store.applyBattleResult(deadPlayerIds);
    const after = store.getRoster();
    const afterIds = new Set(after.map((t) => t.id));
    for (const id of deadPlayerIds) expect(afterIds.has(id)).toBe(false);
    expect(after.length).toBe(roster.length - deadPlayerIds.length);

    store.setLastComposition(companyComposition(loadout, roster, data));
    expect(Object.keys(store.getLastComposition()).length).toBeGreaterThan(0);
  });
});
