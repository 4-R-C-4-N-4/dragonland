// Pure loadout logic: validation, sanitization, conversion to sim input, composition, matchups,
// and bulk-edit helpers. No DOM. Fully unit-tested.
import type { GameData } from '../../data';
import type { ClassId, Loadout, Squad, Troop } from '../../data/schemas';
import type { SideSetup, SquadSetup, TroopSetup } from '../../sim/types';

export interface ValidationError {
  code: 'tooFewSquads' | 'tooManySquads' | 'squadTooSmall' | 'companyTooLarge' | 'duplicateTroop' | 'missingTroop' | 'stage3Troop' | 'emptyRoster';
  message: string;
  squadId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

function rosterById(roster: Troop[]): Map<string, Troop> {
  return new Map(roster.map((t) => [t.id, t] as const));
}

export function validateLoadout(loadout: Loadout, roster: Troop[], data: GameData): ValidationResult {
  const errors: ValidationError[] = [];
  const { MAX_SQUADS, MIN_SQUAD, MAX_COMPANY } = data.constants;
  const byId = rosterById(roster);

  if (loadout.squads.length < 1) {
    errors.push({ code: 'tooFewSquads', message: 'At least one squad is required.' });
  }
  if (loadout.squads.length > MAX_SQUADS) {
    errors.push({ code: 'tooManySquads', message: `No more than ${MAX_SQUADS} squads are allowed.` });
  }

  const seen = new Set<string>();
  let total = 0;
  for (const squad of loadout.squads) {
    if (squad.troopIds.length < MIN_SQUAD) {
      errors.push({ code: 'squadTooSmall', message: `Squad "${squad.name}" needs at least ${MIN_SQUAD} troops.`, squadId: squad.id });
    }
    for (const troopId of squad.troopIds) {
      total++;
      if (seen.has(troopId)) {
        errors.push({ code: 'duplicateTroop', message: `A troop is assigned to more than one squad.`, squadId: squad.id });
        continue;
      }
      seen.add(troopId);
      const troop = byId.get(troopId);
      if (!troop) {
        errors.push({ code: 'missingTroop', message: `A troop in squad "${squad.name}" no longer exists in the roster.`, squadId: squad.id });
        continue;
      }
      const unit = data.unitById.get(troop.unitId);
      if (!unit) {
        errors.push({ code: 'missingTroop', message: `Troop "${troop.name}" references an unknown unit.`, squadId: squad.id });
      } else if (unit.stage === 3) {
        errors.push({ code: 'stage3Troop', message: `Troop "${troop.name}" is a stage-3 unit and cannot be a troop.`, squadId: squad.id });
      }
    }
  }
  if (total > MAX_COMPANY) {
    errors.push({ code: 'companyTooLarge', message: `Company has ${total} troops; max is ${MAX_COMPANY}.` });
  }

  return { ok: errors.length === 0, errors };
}

/** Drops troops that no longer exist in the roster. Returns the sanitized loadout and the removed troop ids. */
export function sanitizeLoadout(loadout: Loadout, roster: Troop[]): { loadout: Loadout; removed: string[] } {
  const byId = rosterById(roster);
  const removed: string[] = [];
  const squads: Squad[] = loadout.squads.map((squad: Squad) => {
    const troopIds = squad.troopIds.filter((id: string) => {
      const ok = byId.has(id);
      if (!ok) removed.push(id);
      return ok;
    });
    return { ...squad, troopIds };
  });
  return { loadout: { ...loadout, squads }, removed };
}

export function loadoutToSideSetup(loadout: Loadout, roster: Troop[], formationId: string): SideSetup {
  const byId = rosterById(roster);
  const squads: SquadSetup[] = loadout.squads.map((squad: Squad) => {
    const troops: TroopSetup[] = squad.troopIds
      .map((id: string) => byId.get(id))
      .filter((t): t is Troop => Boolean(t))
      .map((t: Troop) => ({ troopId: t.id, name: t.name, unitId: t.unitId }));
    return { id: squad.id, name: squad.name, disposition: squad.disposition, troops };
  });
  return { generalId: loadout.generalId, formationId, squads };
}

/** Per-class troop counts across the whole loadout. */
export function companyComposition(loadout: Loadout, roster: Troop[], data: GameData): Partial<Record<ClassId, number>> {
  const byId = rosterById(roster);
  const counts: Partial<Record<ClassId, number>> = {};
  for (const squad of loadout.squads) {
    for (const troopId of squad.troopIds) {
      const troop = byId.get(troopId);
      if (!troop) continue;
      const unit = data.unitById.get(troop.unitId);
      if (!unit) continue;
      counts[unit.classId] = (counts[unit.classId] ?? 0) + 1;
    }
  }
  return counts;
}

/** Per-unit troop counts across the whole loadout. */
export function companyUnitCounts(loadout: Loadout, roster: Troop[]): Record<string, number> {
  const byId = rosterById(roster);
  const counts: Record<string, number> = {};
  for (const squad of loadout.squads) {
    for (const troopId of squad.troopIds) {
      const troop = byId.get(troopId);
      if (!troop) continue;
      counts[troop.unitId] = (counts[troop.unitId] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Class-composition matchup assessment for a pre-battle preview: compares how many of our
 * squad's units counter the enemy's classes vs. how many are countered by them.
 */
export function matchupSummary(squadUnitIds: string[], enemyUnitIds: string[], data: GameData): 'strong' | 'neutral' | 'weak' {
  const ourClasses = squadUnitIds.map((id) => data.unitById.get(id)?.classId).filter((c): c is ClassId => Boolean(c));
  const enemyClasses = enemyUnitIds.map((id) => data.unitById.get(id)?.classId).filter((c): c is ClassId => Boolean(c));
  if (ourClasses.length === 0 || enemyClasses.length === 0) return 'neutral';

  let score = 0;
  for (const oc of ourClasses) {
    const ocDef = data.classById.get(oc);
    if (!ocDef) continue;
    for (const ec of enemyClasses) {
      if (ocDef.strongAgainst === ec) score++;
      const ecDef = data.classById.get(ec);
      if (ecDef && ecDef.strongAgainst === oc) score--;
    }
  }
  const norm = score / (ourClasses.length * enemyClasses.length);
  if (norm > 0.1) return 'strong';
  if (norm < -0.1) return 'weak';
  return 'neutral';
}

export interface AutoFillOptions {
  by: 'unit' | 'class';
  value: string;
  count: number;
}

/** Ids of roster troops matching the autofill criteria that aren't already assigned to any squad. */
export function unassignedMatching(loadout: Loadout, roster: Troop[], data: GameData, opts: Pick<AutoFillOptions, 'by' | 'value'>): string[] {
  const assigned = new Set(loadout.squads.flatMap((s: Squad) => s.troopIds));
  return roster
    .filter((t) => !assigned.has(t.id))
    .filter((t) => {
      if (opts.by === 'unit') return t.unitId === opts.value;
      const unit = data.unitById.get(t.unitId);
      return unit?.classId === opts.value;
    })
    .map((t) => t.id);
}

/** Adds up to `count` unassigned matching troops to the given squad. Returns a new loadout. */
export function autoFillSquad(loadout: Loadout, squadId: string, roster: Troop[], data: GameData, opts: AutoFillOptions): Loadout {
  const candidates = unassignedMatching(loadout, roster, data, opts).slice(0, opts.count);
  return {
    ...loadout,
    squads: loadout.squads.map((s: Squad) => (s.id === squadId ? { ...s, troopIds: [...s.troopIds, ...candidates] } : s)),
  };
}

/** Adds every unassigned troop of a unit to the given squad. */
export function selectAllOfUnit(loadout: Loadout, squadId: string, roster: Troop[], data: GameData, unitId: string): Loadout {
  const candidates = unassignedMatching(loadout, roster, data, { by: 'unit', value: unitId });
  return {
    ...loadout,
    squads: loadout.squads.map((s: Squad) => (s.id === squadId ? { ...s, troopIds: [...s.troopIds, ...candidates] } : s)),
  };
}

const DISPOSITION_CYCLE = ['fierce', 'mixed', 'guard'] as const;

export function cycleDisposition(current: Squad['disposition']): Squad['disposition'] {
  const idx = DISPOSITION_CYCLE.indexOf(current);
  return DISPOSITION_CYCLE[(idx + 1) % DISPOSITION_CYCLE.length]!;
}
