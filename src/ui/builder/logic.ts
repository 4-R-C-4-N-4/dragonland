// Pure loadout logic: validation, sanitization, conversion to sim input, composition, matchups,
// and bulk-edit helpers. No DOM. Fully unit-tested.
import type { GameData } from '../../data';
import type { ClassId, Disposition, Loadout, Squad, Troop } from '../../data/schemas';
import type { SideSetup, SquadSetup, TroopSetup } from '../../sim/types';
import { DEFAULT_PLAYER_COLOR, resolveSideColors } from '../../data/colors';

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
  const colors = resolveSideColors(loadout.color, loadout.squads.map((s) => s.color), DEFAULT_PLAYER_COLOR);
  const squads: SquadSetup[] = loadout.squads.map((squad: Squad, i: number) => {
    const troops: TroopSetup[] = squad.troopIds
      .map((id: string) => byId.get(id))
      .filter((t): t is Troop => Boolean(t))
      .map((t: Troop) => ({ troopId: t.id, name: t.name, unitId: t.unitId }));
    return { id: squad.id, name: squad.name, disposition: squad.disposition, troops, color: colors.squads[i] };
  });
  return { generalId: loadout.generalId, formationId, squads, color: colors.team };
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

// ---- Composition-first engine (§2.6 redesign) ----
// Source of truth is each squad's `composition` (unitId -> desired count). `pinned` troop ids are
// never swapped out; everything else is filled deterministically from the roster. Stability: a
// previously-assigned, still-alive, unpinned troop of a unit that's still in the composition and
// within its count stays put; adjusting one unit's count never reshuffles other troops.

export interface Shortfall {
  squadId: string;
  unitId: string;
  missing: number;
}

export interface ResolveResult {
  loadout: Loadout;
  shortfalls: Shortfall[];
  /** Slots refilled because a previously assigned troop no longer exists (died). */
  replaced: number;
}

/** Legacy squads (no `composition`) derive one from their current troopIds. */
export function deriveComposition(squad: Squad): Record<string, number> {
  if (squad.composition) return { ...squad.composition };
  // troopIds alone don't carry unitId; callers with a roster should prefer deriveCompositionFromRoster.
  return {};
}

function derivedCompositionFromRoster(squad: Squad, byId: Map<string, Troop>): Record<string, number> {
  if (squad.composition) return { ...squad.composition };
  const comp: Record<string, number> = {};
  for (const id of squad.troopIds) {
    const t = byId.get(id);
    if (!t) continue;
    comp[t.unitId] = (comp[t.unitId] ?? 0) + 1;
  }
  return comp;
}

export function resolveLoadout(loadout: Loadout, roster: Troop[], data: GameData): ResolveResult {
  void data;
  const byId = rosterById(roster);
  const assignedGlobal = new Set<string>();
  const shortfalls: Shortfall[] = [];
  let replaced = 0;

  const resultSquads: Squad[] = loadout.squads.map((squad) => {
    const comp = derivedCompositionFromRoster(squad, byId);
    const pinnedIds = (squad.pinned ?? []).filter((id) => byId.has(id));
    const pinnedSet = new Set(pinnedIds);

    // Raise counts so pinned troops always fit, even if above the stated composition.
    for (const pid of pinnedIds) {
      const unitId = byId.get(pid)!.unitId;
      const pinnedForUnit = pinnedIds.filter((id) => byId.get(id)!.unitId === unitId).length;
      comp[unitId] = Math.max(comp[unitId] ?? 0, pinnedForUnit);
    }

    const deadOldCount = squad.troopIds.filter((id) => !byId.has(id)).length;

    const unitIds = Object.keys(comp).filter((u) => (comp[u] ?? 0) > 0);
    const keptBySquad: string[] = [];
    let missingBySquad = 0;

    for (const unitId of unitIds) {
      const target = comp[unitId] ?? 0;
      // Old troopIds for this unit, alive, in original order (stability).
      const oldForUnit = squad.troopIds.filter((id) => byId.get(id)?.unitId === unitId);
      const pinnedForUnit = oldForUnit.filter((id) => pinnedSet.has(id));
      const unpinnedForUnit = oldForUnit.filter((id) => !pinnedSet.has(id));
      let kept = [...pinnedForUnit, ...unpinnedForUnit];
      if (kept.length > target) {
        // Trim unpinned, most-recently-added first (end of the unpinned list).
        const overflow = kept.length - target;
        const keepUnpinnedCount = Math.max(0, unpinnedForUnit.length - overflow);
        const trimmedUnpinned = unpinnedForUnit.slice(0, keepUnpinnedCount);
        kept = [...pinnedForUnit, ...trimmedUnpinned];
      }
      for (const id of kept) assignedGlobal.add(id);
      keptBySquad.push(...kept);
      const missing = Math.max(0, target - kept.length);
      if (missing > 0) {
        missingBySquad += missing;
        const pool = roster.filter((t) => t.unitId === unitId && !assignedGlobal.has(t.id));
        const fill = pool.slice(0, missing);
        for (const t of fill) assignedGlobal.add(t.id);
        keptBySquad.push(...fill.map((t) => t.id));
        if (fill.length < missing) {
          shortfalls.push({ squadId: squad.id, unitId, missing: missing - fill.length });
        }
      }
    }

    replaced += Math.min(deadOldCount, missingBySquad);

    return { ...squad, troopIds: keptBySquad, composition: comp, pinned: pinnedIds };
  });

  return { loadout: { ...loadout, squads: resultSquads }, shortfalls, replaced };
}

export function setUnitCount(loadout: Loadout, squadId: string, unitId: string, n: number): Loadout {
  const count = Math.max(0, Math.round(n));
  return {
    ...loadout,
    squads: loadout.squads.map((s) => {
      if (s.id !== squadId) return s;
      const comp = { ...(s.composition ?? {}) };
      if (count === 0) delete comp[unitId];
      else comp[unitId] = count;
      return { ...s, composition: comp };
    }),
  };
}

export function addUnitRow(loadout: Loadout, squadId: string, unitId: string, initialCount = 1): Loadout {
  return {
    ...loadout,
    squads: loadout.squads.map((s) => {
      if (s.id !== squadId) return s;
      const comp = { ...(s.composition ?? {}) };
      if (!(unitId in comp)) comp[unitId] = initialCount;
      return { ...s, composition: comp };
    }),
  };
}

export function removeUnitRow(loadout: Loadout, squadId: string, unitId: string): Loadout {
  return {
    ...loadout,
    squads: loadout.squads.map((s) => {
      if (s.id !== squadId) return s;
      const comp = { ...(s.composition ?? {}) };
      delete comp[unitId];
      return { ...s, composition: comp };
    }),
  };
}

/** Pins a specific troop into a squad: removes it from any other squad's roster and composition
 * bookkeeping, adds it to the target squad's pinned list and bumps that unit's count if needed. */
export function pinTroop(loadout: Loadout, squadId: string, troopId: string, roster: Troop[]): Loadout {
  const troop = roster.find((t) => t.id === troopId);
  if (!troop) return loadout;
  const squads = loadout.squads.map((s) => {
    const hadTroop = s.troopIds.includes(troopId);
    const withoutTroop = { ...s, pinned: (s.pinned ?? []).filter((id) => id !== troopId), troopIds: s.troopIds.filter((id) => id !== troopId) };
    if (s.id !== squadId) {
      if (hadTroop && s.composition && (s.composition[troop.unitId] ?? 0) > 0) {
        const pinnedForUnit = withoutTroop.pinned.filter((id) => roster.find((t) => t.id === id)?.unitId === troop.unitId).length;
        const comp = { ...withoutTroop.composition! };
        comp[troop.unitId] = Math.max(pinnedForUnit, (comp[troop.unitId] ?? 0) - 1);
        return { ...withoutTroop, composition: comp };
      }
      return withoutTroop;
    }
    const pinned = [...withoutTroop.pinned, troopId];
    const comp = { ...(withoutTroop.composition ?? {}) };
    const pinnedForUnit = pinned.filter((id) => roster.find((t) => t.id === id)?.unitId === troop.unitId).length;
    comp[troop.unitId] = Math.max(comp[troop.unitId] ?? 0, pinnedForUnit);
    return { ...withoutTroop, pinned, composition: comp };
  });
  return { ...loadout, squads };
}

export function unpinTroop(loadout: Loadout, squadId: string, troopId: string): Loadout {
  return {
    ...loadout,
    squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, pinned: (s.pinned ?? []).filter((id) => id !== troopId) } : s)),
  };
}

/** Unassigned roster troop counts per unit (troops not referenced by any squad's troopIds). */
export function availableByUnit(loadout: Loadout, roster: Troop[]): Record<string, number> {
  const assigned = new Set(loadout.squads.flatMap((s) => s.troopIds));
  const counts: Record<string, number> = {};
  for (const t of roster) {
    if (assigned.has(t.id)) continue;
    counts[t.unitId] = (counts[t.unitId] ?? 0) + 1;
  }
  return counts;
}

export function setSquadColor(loadout: Loadout, squadId: string, color: string | undefined): Loadout {
  return {
    ...loadout,
    squads: loadout.squads.map((s) => {
      if (s.id !== squadId) return s;
      if (color === undefined) {
        const { color: _drop, ...rest } = s;
        return rest as Squad;
      }
      return { ...s, color };
    }),
  };
}

export function setTeamColor(loadout: Loadout, color: string | undefined): Loadout {
  if (color === undefined) {
    const { color: _drop, ...rest } = loadout;
    return rest as Loadout;
  }
  return { ...loadout, color };
}

export function setDisposition(loadout: Loadout, squadId: string, disposition: Disposition): Loadout {
  return { ...loadout, squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, disposition } : s)) };
}
