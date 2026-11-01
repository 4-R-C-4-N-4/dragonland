import { describe, expect, it } from 'vitest';
import { getGameData, withConstants } from '../../src/data';
import { createBattle, hashWorld, issueCommand, replay, setPaused, step } from '../../src/sim';
import type { BattleSetup, SideSetup } from '../../src/sim/types';

const data = getGameData();

function sideFromLoadout(id: string): SideSetup {
  const l = data.aiLoadoutById.get(id)!;
  let n = 0;
  return {
    generalId: l.generalId,
    formationId: l.formation,
    squads: l.squads.map((sq, si) => ({
      id: `${id}-${si}`,
      name: sq.name,
      disposition: sq.disposition,
      troops: sq.units.flatMap((u) =>
        Array.from({ length: u.count }, () => {
          n++;
          return { troopId: `${id}-t${n}`, name: `T${n}`, unitId: u.unitId };
        }),
      ),
    })),
  };
}

function setupFor(seed: number): BattleSetup {
  return { seed, sides: [sideFromLoadout('mirror-human'), sideFromLoadout('mirror-beast')] };
}

function runToEnd(setup: BattleSetup, maxTicks = 20000) {
  const world = createBattle(data, setup);
  let ticks = 0;
  while (world.result === null && ticks < maxTicks) {
    step(world);
    ticks++;
  }
  return world;
}

describe('determinism', () => {
  it('same seed + inputs produce an identical end-state hash', () => {
    const w1 = runToEnd(setupFor(42));
    const w2 = runToEnd(setupFor(42));
    expect(w1.result).not.toBeNull();
    expect(hashWorld(w1)).toBe(hashWorld(w2));
  });

  it('a different seed produces a different hash', () => {
    const w1 = runToEnd(setupFor(1));
    const w2 = runToEnd(setupFor(2));
    expect(hashWorld(w1)).not.toBe(hashWorld(w2));
  });

  it('replay of the recorded command log reproduces the original hash', () => {
    const setup = setupFor(7);
    const world = createBattle(data, setup);
    let ticks = 0;
    while (world.result === null && ticks < 20000) {
      if (ticks === 40) issueCommand(world, 0, 'all', 'hold');
      if (ticks === 80) issueCommand(world, 0, 'all', 'advance');
      step(world);
      ticks++;
    }
    const replayed = replay(data, setup, world.commandLog, 20000);
    expect(hashWorld(replayed)).toBe(hashWorld(world));
    expect(replayed.commandLog).toEqual(world.commandLog);
  });
});

describe('skirmish end conditions', () => {
  it('general death ends the fight as generalDefeated', () => {
    const setup = setupFor(1);
    const world = createBattle(data, setup);
    // Fast-forward past deploy, then force the side-1 general to 0 HP directly.
    while (world.phase === 'deploy') step(world);
    world.ents.hp[world.generals[1].entity] = 0;
    world.ents.alive[world.generals[1].entity] = 0;
    step(world);
    expect(world.result?.reason).toBe('generalDefeated');
    expect(world.result?.winner).toBe(0);
  });

  it('timing out triggers a duel', () => {
    const shortData = withConstants(data, { SKIRMISH_TIME_S: 1, DUEL_ENTRY_CHIP_PER_SURVIVOR: 0 });
    const world = createBattle(shortData, setupFor(1));
    let ticks = 0;
    while (world.result === null && ticks < 5000) {
      step(world);
      ticks++;
      if (world.phase === 'duel' && world.result === null) break;
    }
    expect(world.phase === 'duel' || world.result?.reason === 'duel').toBe(true);
  });

  it('both companies wiped triggers a duel even before the time limit', () => {
    const world = createBattle(data, setupFor(1));
    while (world.phase === 'deploy') step(world);
    for (let i = 0; i < world.ents.count; i++) {
      if (world.ents.isGeneral[i] === 1) continue;
      world.ents.hp[i] = 0;
      world.ents.alive[i] = 0;
    }
    for (const sq of world.squads) sq.alive = 0;
    step(world);
    expect(world.phase === 'duel' || world.result?.reason === 'duel').toBe(true);
  });
});

describe('pause', () => {
  it('fightTimeS does not advance while paused, and queued commands apply on resume', () => {
    const world = createBattle(data, setupFor(1));
    while (world.phase === 'deploy') step(world);
    const before = world.fightTimeS;
    setPaused(world, true);
    issueCommand(world, 0, 'all', 'hold');
    for (let i = 0; i < 10; i++) step(world);
    expect(world.fightTimeS).toBe(before);
    expect(world.squads.filter((s) => s.side === 0).every((s) => s.command === 'advance')).toBe(true);
    setPaused(world, false);
    step(world);
    expect(world.fightTimeS).toBeGreaterThan(before);
    expect(world.squads.filter((s) => s.side === 0).every((s) => s.command === 'hold')).toBe(true);
  });
});
