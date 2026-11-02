// Pure planning helpers for the run's prepare screen: composition-first, veterans deployed first.
import type { Disposition, GameData, UnitDef } from '../../data';
import type { PlayerArmy } from '../../run';
import type { ProgressTroop } from '../../progression';

export interface SpeciesGroup {
  unit: UnitDef;
  /** Highest level first, then most XP, then name (stable). */
  troops: ProgressTroop[];
}

export interface SquadPlan {
  name: string;
  disposition: Disposition;
}

export interface ArmyPlan {
  formationId: string;
  squads: SquadPlan[];
  /** unitId -> how many of that species to deploy and into which squad (0-based). */
  assignment: Record<string, { count: number; squad: number }>;
}

const LINE_ORDER = { A: 0, M: 1, Z: 2 } as const;

export function speciesGroups(data: GameData, roster: ProgressTroop[]): SpeciesGroup[] {
  const by = new Map<string, ProgressTroop[]>();
  for (const t of roster) (by.get(t.unitId) ?? by.set(t.unitId, []).get(t.unitId)!).push(t);
  const groups: SpeciesGroup[] = [];
  for (const [unitId, troops] of by) {
    const unit = data.unitById.get(unitId);
    if (!unit) continue;
    troops.sort((a, b) => b.level - a.level || b.xp - a.xp || a.name.localeCompare(b.name));
    groups.push({ unit, troops });
  }
  return groups.sort((a, b) => b.unit.stage - a.unit.stage || LINE_ORDER[a.unit.line] - LINE_ORDER[b.unit.line] || a.unit.classId.localeCompare(b.unit.classId) || a.unit.id.localeCompare(b.unit.id));
}

// Default dispositions after the D21 rework (tools/runsim.ts, 30 runs each): A=Mixed, M=Mixed,
// Z=Guard won 40% of campaigns (6.5 victories avg); all-Fierce 0% (3.6), all-Mixed 17% (4.9).
const DEFAULT_SQUADS: SquadPlan[] = [
  { name: 'Vanguard', disposition: 'mixed' },
  { name: 'Center', disposition: 'mixed' },
  { name: 'Shield', disposition: 'guard' },
  { name: 'Reserve', disposition: 'mixed' },
];

/** Default plan: A-line -> squad 1, M -> 2, Z -> 3, up to MAX_COMPANY, higher stages first. */
export function autoPlan(data: GameData, roster: ProgressTroop[], formationId = 'line'): ArmyPlan {
  let room = data.constants.MAX_COMPANY;
  const assignment: ArmyPlan['assignment'] = {};
  for (const g of speciesGroups(data, roster)) {
    const count = Math.min(room, g.troops.length);
    room -= count;
    assignment[g.unit.id] = { count, squad: Math.min(LINE_ORDER[g.unit.line], data.constants.MAX_SQUADS - 1) };
  }
  return { formationId, squads: DEFAULT_SQUADS.slice(0, data.constants.MAX_SQUADS).map((s) => ({ ...s })), assignment };
}

function squadSizes(data: GameData, plan: ArmyPlan): number[] {
  const sizes = plan.squads.map(() => 0);
  for (const a of Object.values(plan.assignment)) if (a.count > 0) sizes[a.squad] = (sizes[a.squad] ?? 0) + a.count;
  return sizes;
}

/** Human-readable problems; empty means the plan can start a battle. */
export function planIssues(data: GameData, roster: ProgressTroop[], plan: ArmyPlan): string[] {
  const issues: string[] = [];
  const groups = new Map(speciesGroups(data, roster).map((g) => [g.unit.id, g]));
  for (const [unitId, a] of Object.entries(plan.assignment)) {
    const have = groups.get(unitId)?.troops.length ?? 0;
    if (a.count > have) issues.push(`${data.unitById.get(unitId)?.name ?? unitId}: only ${have} available`);
    if (a.count < 0 || !Number.isInteger(a.count)) issues.push(`${unitId}: invalid count`);
  }
  const sizes = squadSizes(data, plan);
  const total = sizes.reduce((n, s) => n + s, 0);
  if (total === 0) issues.push('Deploy at least one squad.');
  if (total > data.constants.MAX_COMPANY) issues.push(`Company of ${total} exceeds ${data.constants.MAX_COMPANY}.`);
  sizes.forEach((n, i) => {
    if (n > 0 && n < data.constants.MIN_SQUAD) issues.push(`${plan.squads[i]!.name} needs at least ${data.constants.MIN_SQUAD} troops.`);
  });
  return issues;
}

export function planToArmy(data: GameData, roster: ProgressTroop[], plan: ArmyPlan): PlayerArmy {
  const groups = new Map(speciesGroups(data, roster).map((g) => [g.unit.id, g]));
  const squads = plan.squads.map((s) => ({ name: s.name, disposition: s.disposition, troopIds: [] as string[] }));
  for (const g of speciesGroups(data, roster)) {
    const a = plan.assignment[g.unit.id];
    if (!a || a.count <= 0) continue;
    const take = groups.get(g.unit.id)!.troops.slice(0, a.count);
    squads[a.squad]!.troopIds.push(...take.map((t) => t.id));
  }
  return { formationId: plan.formationId, squads: squads.filter((s) => s.troopIds.length > 0) };
}

/** Class-cycle verdict for a class against an enemy composition: +1 strong, -1 weak per troop share. */
export function classEdge(data: GameData, classId: string, enemyCounts: Map<string, number>): 'strong' | 'weak' | 'neutral' {
  let score = 0;
  const mine = data.classes.find((c) => c.id === classId);
  for (const [enemyClass, n] of enemyCounts) {
    if (mine?.strongAgainst === enemyClass) score += n;
    if (data.classes.find((c) => c.id === enemyClass)?.strongAgainst === classId) score -= n;
  }
  return score > 0 ? 'strong' : score < 0 ? 'weak' : 'neutral';
}

/** Single-class cycle relation: quarry = what myClass beats, nemesis = what beats myClass. */
export function classRelation(data: GameData, myClass: string, otherClass: string): 'quarry' | 'nemesis' | 'neutral' {
  if (myClass === otherClass) return 'neutral';
  const mine = data.classes.find((c) => c.id === myClass);
  const other = data.classes.find((c) => c.id === otherClass);
  if (mine?.strongAgainst === otherClass) return 'quarry';
  if (other?.strongAgainst === myClass) return 'nemesis';
  return 'neutral';
}
