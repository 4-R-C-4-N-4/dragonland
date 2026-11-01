// Public sim API (implementation.md §5 index.ts). Everything outside src/sim must import from here.
import type { GameData } from '../data';
import { createBattle as createBattleImpl } from './world';
import { step as stepImpl, setPaused as setPausedImpl, issueCommand as issueCommandImpl, fireSpecial as fireSpecialImpl } from './step';
import { canFireSpecial as canFireSpecialImpl } from './specials';
import type { BattleSetup, RecordedCommand, Side, World } from './types';

export * from './types';
export { createRng, nextFloat, nextInt, nextRange, pick, nextId, type Rng } from './rng';

export const createBattle = createBattleImpl;
export const step = stepImpl;
export const setPaused = setPausedImpl;
export const issueCommand = issueCommandImpl;
export const fireSpecial = fireSpecialImpl;
export const canFireSpecial = canFireSpecialImpl;

/** Stable hash of positions/hp/alive/phase/tick/result for determinism tests. */
export function hashWorld(world: World): string {
  const ents = world.ents;
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  const mix = (n: number) => {
    // FNV-1a style mix over an integer-quantized value.
    let v = Math.round(n * 1000) | 0;
    h1 ^= v;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 + v) | 0;
    h2 = Math.imul(h2, 0x85ebca6b);
  };
  mix(world.tick);
  mix(world.phase.length + world.phase.charCodeAt(0));
  mix(world.result ? world.result.winner + 1 : 0);
  mix(world.result ? (world.result.reason === 'duel' ? 1 : 2) : 0);
  for (let i = 0; i < ents.count; i++) {
    mix(ents.x[i]!);
    mix(ents.y[i]!);
    mix(ents.hp[i]!);
    mix(ents.alive[i]!);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Re-runs a battle from its recorded command log; must reproduce an identical hashWorld. */
export function replay(data: GameData, setup: BattleSetup, commandLog: RecordedCommand[], maxTicks = 20000): World {
  const world = createBattleImpl(data, setup);
  const byTick = new Map<number, RecordedCommand[]>();
  for (const c of commandLog) {
    const arr = byTick.get(c.tick) ?? [];
    arr.push(c);
    byTick.set(c.tick, arr);
  }
  const internal = world._internal as { pending: { side: Side; squadId: string; command: RecordedCommand['command'] }[] };
  while (world.result === null && world.tick < maxTicks) {
    const cmds = byTick.get(world.tick);
    if (cmds) for (const c of cmds) internal.pending.push({ side: c.side, squadId: c.squadId, command: c.command });
    stepImpl(world);
  }
  return world;
}
