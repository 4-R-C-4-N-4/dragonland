// Headless battle runner: used as a fallback when src/battle/view.ts is not yet available
// (parallel stream), and directly by tests. Runs the sim with AI controllers on both sides
// until a result is produced. Pure except for a bounded loop; no DOM.
import type { GameData } from '../../data';
import { createBattle, step, type BattleSetup, type World } from '../../sim';
import { createAiController } from '../../ai';

export interface RunHeadlessOptions {
  /** Safety bound on sim ticks so a stalled battle can't hang the UI/tests forever. */
  maxTicks?: number;
}

/** Runs a full battle with AI controlling both sides until world.result is set. */
export function runHeadlessBattle(data: GameData, setup: BattleSetup, opts: RunHeadlessOptions = {}): World {
  const maxTicks = opts.maxTicks ?? 200_000;
  const world = createBattle(data, setup);
  const ai0 = createAiController(data, 0);
  const ai1 = createAiController(data, 1);
  while (world.result === null && world.tick < maxTicks) {
    ai0.update(world);
    ai1.update(world);
    step(world);
  }
  return world;
}
