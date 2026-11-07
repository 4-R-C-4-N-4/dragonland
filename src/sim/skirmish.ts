// Skirmish end conditions and result construction (implementation.md §2.10).
import type { BattleResult, Side, World } from './types';
import { nextFloat, type Rng } from './rng';

export function buildResult(world: World, winner: Side, reason: BattleResult['reason']): BattleResult {
  const ents = world.ents;
  const dead: [string[], string[]] = [[], []];
  const survivors: [string[], string[]] = [[], []];
  for (let i = 2; i < ents.count; i++) {
    const side = ents.side[i] as Side;
    (ents.alive[i] === 1 ? survivors : dead)[side].push(ents.troopId[i]!);
  }
  return {
    winner,
    reason,
    durationS: world.fightTimeS,
    hadDuel: world.phase === 'duel' || reason === 'duel',
    dead,
    survivors,
  };
}

/** Checks general death, timeout, and double-wipe transitions during the 'fight' phase. */
export function checkFightEnd(world: World): void {
  const internal = world._internal as { data: import('../data').GameData };
  const data = internal.data;
  const ents = world.ents;
  const g0 = world.generals[0];
  const g1 = world.generals[1];

  if (ents.alive[g0.entity] === 0 && ents.alive[g1.entity] === 0) {
    // Both commanders fell in the same tick (deaths resolve together): a seeded coin decides,
    // never a fixed side.
    const winner: Side = nextFloat((world._internal as { rng: Rng }).rng) < 0.5 ? 0 : 1;
    world.result = buildResult(world, winner, 'generalDefeated');
    world.phase = 'result';
    world.events.push({ type: 'phase', phase: 'result' });
    return;
  }
  if (ents.alive[g0.entity] === 0) {
    world.result = buildResult(world, 1, 'generalDefeated');
    world.phase = 'result';
    world.events.push({ type: 'phase', phase: 'result' });
    return;
  }
  if (ents.alive[g1.entity] === 0) {
    world.result = buildResult(world, 0, 'generalDefeated');
    world.phase = 'result';
    world.events.push({ type: 'phase', phase: 'result' });
    return;
  }

  const side0Wiped = world.squads.filter((s) => s.side === 0).every((s) => s.alive === 0);
  const side1Wiped = world.squads.filter((s) => s.side === 1).every((s) => s.alive === 0);
  const timeout = world.fightTimeS >= data.constants.SKIRMISH_TIME_S;
  // Both companies wiped, or the clock runs out — one side losing its troops should not cut the
  // fight short while the other side's survivors could still finish the enemy general. §2.10.
  if (timeout || (side0Wiped && side1Wiped)) {
    // DECISIONS D15: at a timeout, the surviving company presses its attack into the duel's
    // opening exchange — chip the enemy general proportional to the opponent's surviving troops,
    // so a dominant troop battle isn't erased by an otherwise-symmetric general duel.
    if (timeout && data.constants.DUEL_ENTRY_CHIP_PER_SURVIVOR > 0) {
      // DESIGN-TBD: D15
      const alive0 = world.squads.filter((s) => s.side === 0).reduce((n, s) => n + s.alive, 0);
      const alive1 = world.squads.filter((s) => s.side === 1).reduce((n, s) => n + s.alive, 0);
      ents.hp[g1.entity] = Math.max(1, ents.hp[g1.entity]! - alive0 * data.constants.DUEL_ENTRY_CHIP_PER_SURVIVOR);
      ents.hp[g0.entity] = Math.max(1, ents.hp[g0.entity]! - alive1 * data.constants.DUEL_ENTRY_CHIP_PER_SURVIVOR);
    }
    world.phase = 'duel';
    world.events.push({ type: 'phase', phase: 'duel' });
  }
}
