// General retaliation memory is sim state; never driven by render events or wall time.
import type { World } from './types';
import { internalOf } from './world';

/** Remember actual damage, including a general hit by a field-wide special. */
export function recordGeneralAggro(world: World, attacker: number, target: number): void {
  const ents = world.ents;
  if (ents.isGeneral[target] !== 1 || ents.side[attacker] === ents.side[target]) return;
  const { data } = internalOf(world);
  const g = world.generals[ents.side[target] as 0 | 1];
  const expiresAtTick = world.tick + Math.ceil(data.behaviors.generalAggroMemoryS * data.constants.SIM_HZ);
  const existing = g.aggro.find((a) => a.entity === attacker);
  if (existing) existing.expiresAtTick = expiresAtTick;
  else g.aggro.push({ entity: attacker, expiresAtTick });
}
