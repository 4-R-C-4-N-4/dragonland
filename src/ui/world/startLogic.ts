import type { GameData, GeneralId } from '../../data';
import type { BuiltWorldData } from '../../world';

export function defaultStartingSplit(world: BuiltWorldData): number[] {
  const { STARTING_TROOPS: troops, STARTING_GENERALS: generals } = world.constants;
  return Array.from({ length: generals }, (_, i) => Math.floor(troops / generals) + (i < troops % generals ? 1 : 0));
}

export interface WarStartValidation { valid: boolean; errors: string[]; remaining: number }
export function validateWarStart(data: GameData, world: BuiltWorldData, heroId: GeneralId, name: string, split: number[]): WarStartValidation {
  const errors: string[] = [];
  const { STARTING_TROOPS: total, STARTING_GENERALS: generals, STARTING_CAPACITY: capacity } = world.constants;
  const remaining = total - split.reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
  if (!data.generalById.has(heroId)) errors.push('Choose a hero from the catalog.');
  if (!name.trim()) errors.push('Enter a name for your hero.');
  if (split.length !== generals) errors.push(`Enter allocations for all ${generals} generals.`);
  if (split.some(n => !Number.isInteger(n) || n < 0)) errors.push('Troop counts must be whole numbers of zero or more.');
  if (split.some(n => Number.isFinite(n) && n > capacity)) errors.push(`Each general can lead at most ${capacity} troops.`);
  if (split.every(Number.isInteger) && split.reduce((a, b) => a + b, 0) !== total) errors.push(`Allocate exactly ${total} troops.`);
  return { valid: errors.length === 0, errors, remaining };
}
