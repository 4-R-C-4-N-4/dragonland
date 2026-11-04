// Damage formula (implementation.md §2.4). Pure functions; no sim state.
import type { ClassId, GameData, Line } from '../data';

export interface CombatProfile {
  classId: ClassId;
  line: Line;
}

export function classTerm(data: GameData, attacker: ClassId, defender: ClassId): number {
  const mod = data.constants.CLASS_MOD;
  const atkDef = data.classById.get(attacker);
  const defDef = data.classById.get(defender);
  if (atkDef && atkDef.strongAgainst === defender) return mod;
  if (defDef && defDef.strongAgainst === attacker) return -mod;
  return 0;
}

export function lineDealTerm(data: GameData, attackerLine: Line): number {
  const mod = data.constants.LINE_DEAL_MOD;
  if (attackerLine === 'A') return mod;
  if (attackerLine === 'Z') return -mod;
  return 0;
}

export function lineTakeTerm(data: GameData, defenderLine: Line): number {
  const mod = data.constants.LINE_TAKE_MOD;
  if (defenderLine === 'A') return mod;
  if (defenderLine === 'Z') return -mod;
  return 0;
}

/** General `level` is not used in combat math yet. // DESIGN-TBD: D5 */
export function levelTerm(): number {
  return 0;
}

/** Full multiplier applied to BASE_DAMAGE * attacker.statMultiplier, clamped to MIN_DAMAGE_MULT. */
export function damageMultiplier(data: GameData, attacker: CombatProfile, defender: CombatProfile): number {
  const raw = 1 + classTerm(data, attacker.classId, defender.classId) + lineDealTerm(data, attacker.line) + lineTakeTerm(data, defender.line) + levelTerm();
  return Math.max(data.constants.MIN_DAMAGE_MULT, raw);
}

export interface AttackerProfile extends CombatProfile {
  statMult: number;
}

export function computeDamage(data: GameData, attacker: AttackerProfile, defender: CombatProfile): number {
  return data.constants.BASE_DAMAGE * attacker.statMult * damageMultiplier(data, attacker, defender);
}
