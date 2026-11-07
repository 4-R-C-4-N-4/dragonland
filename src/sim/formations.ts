// Deploy positions (implementation.md §2.8, §6). Pure placement math; no sim state.
import type { FormationDef, GameData } from '../data';
import type { Side } from './types';

export interface Vec2 {
  x: number;
  y: number;
}

/** +1 for side 0 (faces +x), -1 for side 1 (faces -x). DECISIONS D10. */
export function sideDir(side: Side): 1 | -1 {
  return side === 0 ? 1 : -1;
}

export function sideBaseX(data: GameData, side: Side): number {
  const inset = data.constants.GENERAL_START_INSET;
  return side === 0 ? inset : data.constants.FIELD_W - inset;
}

export function generalPosition(data: GameData, side: Side, formation: FormationDef): Vec2 {
  const dir = sideDir(side);
  const baseX = sideBaseX(data, side);
  const x = baseX + dir * formation.generalOffset.fx * data.constants.FORMATION_DEPTH;
  const y = data.constants.FIELD_H / 2 + formation.generalOffset.fy * data.constants.FORMATION_HALF_WIDTH;
  return { x, y };
}

export function slotPosition(data: GameData, side: Side, formation: FormationDef, slot: number): Vec2 {
  const s = formation.slots[slot % formation.slots.length]!;
  const dir = sideDir(side);
  const baseX = sideBaseX(data, side);
  const x = baseX + dir * s.fx * data.constants.FORMATION_DEPTH;
  const y = data.constants.FIELD_H / 2 + s.fy * data.constants.FORMATION_HALF_WIDTH;
  return { x, y };
}

/**
 * Deterministic square-ish packing of `count` troop positions around a slot center. Pass the
 * side's facing so troop order maps to the same front/back position on both sides; packing
 * every side toward +x put side 0's first troops at the back and side 1's at the front.
 */
export function packAroundSlot(center: Vec2, count: number, spacing: number, dir: 1 | -1 = 1): Vec2[] {
  const out: Vec2[] = [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  let i = 0;
  for (let r = 0; r < rows && i < count; r++) {
    for (let c = 0; c < cols && i < count; c++) {
      const ox = (c - (cols - 1) / 2) * spacing;
      const oy = (r - (rows - 1) / 2) * spacing;
      out.push({ x: center.x + dir * ox, y: center.y + oy });
      i++;
    }
  }
  return out;
}
