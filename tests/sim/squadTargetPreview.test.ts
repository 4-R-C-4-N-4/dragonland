import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, hashWorld, issueCommand, previewSquadTarget } from '../../src/sim';
import type { Disposition } from '../../src/data/schemas';

const data = getGameData();
function fixture(disposition: Disposition = 'mixed') {
  const world = createBattle(data, { seed: 31, sides: [
    { generalId: 'paladin', formationId: 'line', squads: [{ id: 'p', name: 'P', disposition, troops: [
      { troopId: 'a', name: 'A', unitId: 'soldier' }, { troopId: 'b', name: 'B', unitId: 'soldier' },
    ] }] },
    { generalId: 'dragon', formationId: 'line', squads: [{ id: 'e', name: 'E', disposition: 'mixed', troops: [
      { troopId: 'x', name: 'X', unitId: 'dog' }, { troopId: 'y', name: 'Y', unitId: 'dog' },
    ] }] },
  ] });
  const squad = world.squads[0]!;
  const [member, second] = squad.members as [number, number];
  const [enemy, other] = world.squads[1]!.members as [number, number];
  for (let e = 0; e < world.ents.count; e++) world.ents.y[e] = 300;
  world.ents.x[0] = 100; world.ents.x[1] = 1500;
  world.ents.x[member] = 500; world.ents.x[second] = 1100;
  world.ents.x[enemy] = 900; world.ents.x[other] = 1200;
  return { world, squad, member, second, enemy, other };
}

describe('read-only squad target preview', () => {
  it('acquires a Mixed troop with no cached target even when the general is nearer', () => {
    const { world, member, enemy } = fixture();
    world.ents.x[1] = 510;
    expect(world.ents.target[member]).toBe(-1);
    expect(previewSquadTarget(world, 0)).toBe(enemy);
  });

  it('previews queued Advance from paused Hold without changing any state', () => {
    const { world, squad, enemy } = fixture();
    squad.command = 'hold'; world.paused = true;
    expect(previewSquadTarget(world, 0)).toBe(-1);
    issueCommand(world, 0, 'all', 'fallBack');
    issueCommand(world, 0, 'p', 'advance');
    const before = JSON.stringify(world), hash = hashWorld(world);
    // A temporary command mutation is forbidden too, even if restored afterwards.
    Object.freeze(squad);
    for (let i = 0; i < 3; i++) expect(previewSquadTarget(world, 0)).toBe(enemy);
    expect(JSON.stringify(world)).toBe(before);
    expect(hashWorld(world)).toBe(hash);
    expect(squad.command).toBe('hold');
    expect(world.commandLog).toEqual([]);
    expect(world.tick).toBe(0);
  });

  it('uses the first alive member rather than a stale cached target', () => {
    const { world, member, second, other } = fixture();
    world.ents.target[second] = 1;
    world.ents.alive[member] = 0;
    expect(previewSquadTarget(world, 0)).toBe(other);
  });

  it('Fierce focuses the general unless a troop blocks its reach', () => {
    const { world, member, enemy } = fixture('fierce');
    expect(previewSquadTarget(world, 0)).toBe(1);
    world.ents.x[enemy] = world.ents.x[member]! + 1;
    expect(previewSquadTarget(world, 0)).toBe(enemy);
    issueCommand(world, 0, 'p', 'hold');
    expect(previewSquadTarget(world, 0)).toBe(enemy);
  });

  it('Guard uses current general threats first, then Advance troops, and respects Hold', () => {
    const { world, enemy, other } = fixture('guard');
    expect(previewSquadTarget(world, 0)).toBe(enemy);
    issueCommand(world, 0, 'p', 'hold');
    expect(previewSquadTarget(world, 0)).toBe(-1);
    world.ents.x[0] = world.ents.x[other]!;
    expect(previewSquadTarget(world, 0)).toBe(other);
  });

  it('reacquires after death and only selects the general once no troops remain', () => {
    const { world, enemy, other } = fixture();
    world.ents.alive[enemy] = 0;
    expect(previewSquadTarget(world, 0)).toBe(other);
    world.ents.alive[other] = 0;
    expect(previewSquadTarget(world, 0)).toBe(1);
  });

  it('returns -1 for invalid squads or no living members', () => {
    const { world, squad } = fixture();
    for (const index of [-1, 99, 0.5, NaN]) expect(previewSquadTarget(world, index)).toBe(-1);
    for (const e of squad.members) world.ents.alive[e] = 0;
    expect(previewSquadTarget(world, 0)).toBe(-1);
  });
});
