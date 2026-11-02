import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createBattle, getSquadIntent, issueApproach, issueCommand, replay, hashWorld, setPaused, step, type BattleSetup } from '../../src/sim';

const data = getGameData();
const setup: BattleSetup = { seed: 31, sides: [
  { generalId: 'paladin', formationId: 'line', squads: [
    { id: 'p0', name: 'P0', disposition: 'mixed', troops: [{ troopId: 'p0', name: 'P0', unitId: 'soldier' }] },
    { id: 'p1', name: 'P1', disposition: 'guard', troops: [{ troopId: 'p1', name: 'P1', unitId: 'soldier' }] },
  ] },
  { generalId: 'dragon', formationId: 'line', squads: [
    { id: 'p0', name: 'E0', disposition: 'mixed', troops: [{ troopId: 'e0', name: 'E0', unitId: 'dog' }] },
  ] },
] };

describe('paused order and approach planning', () => {
  it('shows the latest order and approach immediately without advancing the sim', () => {
    const w = createBattle(data, setup);
    setPaused(w, true);
    const before = hashWorld(w);
    issueCommand(w, 0, 'all', 'hold');
    issueApproach(w, 0, 'all', 'farFlank');
    issueCommand(w, 0, 'p0', 'advance');
    issueApproach(w, 0, 'p0', 'nearFlank');
    expect(getSquadIntent(w, 0)).toEqual({ command: 'advance', approach: 'nearFlank', pending: true });
    expect(getSquadIntent(w, 1)).toEqual({ command: 'hold', approach: 'farFlank', pending: true });
    expect(getSquadIntent(w, 2)).toEqual({ command: 'advance', approach: 'direct', pending: false });
    for (let i = 0; i < 20; i++) step(w);
    expect(hashWorld(w)).toBe(before);
    expect(w.commandLog).toEqual([]);
    expect(w.squads.map((s) => s.command)).toEqual(['advance', 'advance', 'advance']);
    expect(w.squads.map((s) => s.disposition)).toEqual(['mixed', 'guard', 'mixed']);
    setPaused(w, false);
    step(w);
    expect(w.squads[0]).toMatchObject({ command: 'advance', approach: 'nearFlank', disposition: 'mixed' });
    expect(w.squads[1]).toMatchObject({ command: 'hold', approach: 'farFlank', disposition: 'guard' });
    expect(getSquadIntent(w, 0).pending).toBe(false);
    expect(w.commandLog).toHaveLength(4);
  });

  it('steers Mixed through either chosen flank while keeping disposition fixed', () => {
    const ys: number[] = [];
    for (const approach of ['farFlank', 'direct', 'nearFlank'] as const) {
      const w = createBattle(data, setup);
      w.phase = 'fight';
      const sq = w.squads[0]!;
      const troop = sq.members[0]!;
      w.ents.x[troop] = sq.centroidX = 400;
      w.ents.y[troop] = sq.centroidY = 300;
      const enemy = w.squads[2]!.members[0]!;
      w.ents.x[enemy] = 1000;
      w.ents.y[enemy] = 300;
      issueApproach(w, 0, sq.id, approach);
      for (let i = 0; i < 20; i++) step(w);
      ys.push(w.ents.y[troop]!);
      expect(sq.disposition).toBe('mixed');
      expect(sq.approach).toBe(approach);
    }
    expect(ys[0]).toBeLessThan(ys[1]! - 10);
    expect(ys[2]).toBeGreaterThan(ys[1]! + 10);
  });

  it('replays orders and approaches at the resume tick exactly once', () => {
    const w = createBattle(data, setup);
    for (let i = 0; i < 25; i++) step(w);
    setPaused(w, true);
    issueApproach(w, 0, 'p0', 'farFlank');
    issueCommand(w, 0, 'p0', 'hold');
    issueCommand(w, 0, 'p0', 'advance');
    setPaused(w, false);
    while (w.tick < 180) step(w);
    const copy = replay(data, setup, w.commandLog, 180);
    expect(hashWorld(copy)).toBe(hashWorld(w));
    expect(copy.commandLog).toEqual(w.commandLog);
    expect(copy.squads.map((s) => [s.command, s.approach])).toEqual(w.squads.map((s) => [s.command, s.approach]));
  });
});
