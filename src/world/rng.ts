// World-specific seed namespace over the shared simulation PRNG.
import { createRng, type Rng } from '../sim/rng';
import type { BuiltWorldData } from './data';
import type { War, WorldOrder } from './types';
export { nextFloat, nextInt, nextId, pick } from '../sim/rng';
export function worldRng(seed: number): Rng {
  return createRng(Math.imul((seed >>> 0) ^ 0x776f726c, 0x85ebca6b) >>> 0);
}
export interface WorldInternal {
  data: BuiltWorldData;
  rng: Rng;
  pending: WorldOrder[];
  supply: Record<string, number>;
  paths: Record<string, string[]>;
  activeTurn?: { turn: number; orders: WorldOrder[]; starts: Record<string, string>; resolved: string[]; ordinal: number; current: string | null };
}
export function internal(war: War): WorldInternal { return war._internal as WorldInternal; }
