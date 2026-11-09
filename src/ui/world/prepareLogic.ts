// Pure helpers for the war's fight preparation screen, built on the Skirmish campaign's planner.
import type { ClassId, GameData } from '../../data';
import type { ProgressTroop } from '../../progression';
import { autoPlan, planIssues, type ArmyPlan } from '../run/logic';

/** Skirmish auto-arrange from this pool, trimmed (last-listed species first) to the command limit. */
export function initialPlan(data: GameData, pool: ProgressTroop[], limit: number, formationId = 'line'): ArmyPlan {
  const plan = autoPlan(data, pool, formationId);
  let over = Object.values(plan.assignment).reduce((n, a) => n + a.count, 0) - limit;
  for (const a of Object.values(plan.assignment).reverse()) {
    if (over <= 0) break;
    const cut = Math.min(a.count, over);
    a.count -= cut; over -= cut;
  }
  // Trimming can leave a squad below the minimum; drop such leftovers to the bench.
  const sizes = new Map<number, number>();
  for (const a of Object.values(plan.assignment)) sizes.set(a.squad, (sizes.get(a.squad) ?? 0) + a.count);
  for (const a of Object.values(plan.assignment)) if ((sizes.get(a.squad) ?? 0) < data.constants.MIN_SQUAD) a.count = 0;
  return plan;
}

/** The Skirmish plan checks plus this general's command limit. Empty means ready to fight. */
export function planProblems(data: GameData, pool: ProgressTroop[], plan: ArmyPlan, limit: number): string[] {
  const issues = planIssues(data, pool, plan);
  const total = Object.values(plan.assignment).reduce((n, a) => n + (Number.isInteger(a.count) && a.count > 0 ? a.count : 0), 0);
  if (total > limit) issues.push(`This general can command ${limit} troops; ${total} are deployed.`);
  return issues;
}

/** Enemy troop counts by class, for the quarry/nemesis hints on each species row. */
export function troopsByClass(data: GameData, troops: { unitId: string }[]): Map<ClassId, number> {
  const counts = new Map<ClassId, number>();
  for (const t of troops) {
    const c = data.unitById.get(t.unitId)?.classId;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}
