import type { ClassId, GameData, GeneralId } from '../../data';
import type { RunConfig } from '../../run/config';
import { startingArmyPlan } from '../../world/engine';

/**
 * Classes around a pentagon so the authored counter cycle draws the star: each class's quarry
 * (the class it is strong against) sits two points clockwise. With the authored data the
 * starting partners then land on the pentagon edges, next to each other.
 */
export function huntOrder(data: GameData): ClassId[] {
  const n = data.classes.length;
  const order: ClassId[] = new Array(n);
  let c = data.classes[0]!.id;
  for (let k = 0, i = 0; k < n; k++, i = (i + 2) % n) { order[i] = c; c = data.classById.get(c)!.strongAgainst; }
  return order;
}

export function huntRelations(data: GameData, run: RunConfig, classId: ClassId): { quarry: ClassId; nemesis: ClassId; ally: ClassId } {
  const quarry = data.classById.get(classId)!.strongAgainst;
  const nemesis = data.classes.find(c => c.strongAgainst === classId)!.id;
  return { quarry, nemesis, ally: run.startingPartners[classId]! };
}

/** Point i of an n-gon, first at the top, clockwise (SVG y grows downward). */
export function vertex(i: number, n: number, cx: number, cy: number, r: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** The army a war starts with, from the same plan createWar uses. */
export function startingArmySummary(heroId: GeneralId): { classes: ClassId[]; troops: number; perKind: number } {
  const plan = startingArmyPlan(heroId);
  return { classes: plan.classes, troops: plan.units.length * plan.perKind, perKind: plan.perKind };
}

export interface WarStartValidation { valid: boolean; errors: string[] }
export function validateWarStart(data: GameData, heroId: GeneralId, name: string): WarStartValidation {
  const errors: string[] = [];
  if (!data.generalById.has(heroId)) errors.push('Choose a hero.');
  if (!name.trim()) errors.push('Name your hero.');
  return { valid: errors.length === 0, errors };
}
