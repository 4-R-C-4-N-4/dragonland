// Loads and validates all /data JSON. Pure (no DOM) so the sim, tests and headless runner can use it.
import { z } from 'zod';
import constantsJson from '../../data/constants.json';
import classesJson from '../../data/classes.json';
import unitsJson from '../../data/units.json';
import generalsJson from '../../data/generals.json';
import formationsJson from '../../data/formations.json';
import aiLoadoutsJson from '../../data/loadouts-ai.json';
import namesJson from '../../data/names.json';
import {
  AiLoadoutSchema,
  ClassDefSchema,
  ConstantsSchema,
  FormationDefSchema,
  GeneralDefSchema,
  NamesSchema,
  UnitDefSchema,
  type AiLoadout,
  type ClassDef,
  type ClassId,
  type Constants,
  type FormationDef,
  type GeneralDef,
  type GeneralId,
  type Names,
  type UnitDef,
} from './schemas';

export * from './schemas';

export interface GameData {
  constants: Constants;
  classes: ClassDef[];
  units: UnitDef[];
  generals: GeneralDef[];
  formations: FormationDef[];
  aiLoadouts: AiLoadout[];
  names: Names;
  // lookups
  classById: Map<ClassId, ClassDef>;
  unitById: Map<string, UnitDef>;
  generalById: Map<GeneralId, GeneralDef>;
  formationById: Map<string, FormationDef>;
  aiLoadoutById: Map<string, AiLoadout>;
}

export interface RawGameData {
  constants: unknown;
  classes: unknown;
  units: unknown;
  generals: unknown;
  formations: unknown;
  aiLoadouts: unknown;
  names: unknown;
}

export const rawGameData: RawGameData = {
  constants: constantsJson,
  classes: classesJson,
  units: unitsJson,
  generals: generalsJson,
  formations: formationsJson,
  aiLoadouts: aiLoadoutsJson,
  names: namesJson,
};

/** Validate raw JSON and build lookups + cross-reference checks. Throws with a readable message. */
export function buildGameData(raw: RawGameData): GameData {
  const constants = ConstantsSchema.parse(raw.constants);
  const classes = z.array(ClassDefSchema).parse(raw.classes);
  const units = z.array(UnitDefSchema).parse(raw.units);
  const generals = z.array(GeneralDefSchema).parse(raw.generals);
  const formations = z.array(FormationDefSchema).parse(raw.formations);
  const aiLoadouts = z.array(AiLoadoutSchema).parse(raw.aiLoadouts);
  const names = NamesSchema.parse(raw.names);

  const classById = new Map(classes.map((c) => [c.id, c] as const));
  const unitById = new Map(units.map((u) => [u.id, u] as const));
  const generalById = new Map(generals.map((g) => [g.id, g] as const));
  const formationById = new Map(formations.map((f) => [f.id, f] as const));
  const aiLoadoutById = new Map(aiLoadouts.map((l) => [l.id, l] as const));

  const errors: string[] = [];
  for (const c of classes) if (!classById.has(c.strongAgainst)) errors.push(`class ${c.id}: unknown strongAgainst ${c.strongAgainst}`);
  for (const u of units) if (!classById.has(u.classId)) errors.push(`unit ${u.id}: unknown class ${u.classId}`);
  for (const g of generals) {
    const u = unitById.get(g.unitId);
    if (!u) errors.push(`general ${g.id}: unknown unit ${g.unitId}`);
    else if (u.stage !== 3) errors.push(`general ${g.id}: unit ${g.unitId} must be stage 3`);
  }
  for (const l of aiLoadouts) {
    if (!generalById.has(l.generalId)) errors.push(`ai loadout ${l.id}: unknown general ${l.generalId}`);
    if (!formationById.has(l.formation)) errors.push(`ai loadout ${l.id}: unknown formation ${l.formation}`);
    if (l.squads.length > constants.MAX_SQUADS) errors.push(`ai loadout ${l.id}: too many squads`);
    let total = 0;
    for (const s of l.squads) {
      let n = 0;
      for (const e of s.units) {
        const u = unitById.get(e.unitId);
        if (!u) errors.push(`ai loadout ${l.id}: unknown unit ${e.unitId}`);
        else if (u.stage === 3) errors.push(`ai loadout ${l.id}: stage-3 unit ${e.unitId} cannot be a troop`);
        n += e.count;
      }
      if (n < constants.MIN_SQUAD) errors.push(`ai loadout ${l.id}: squad ${s.name} below MIN_SQUAD`);
      total += n;
    }
    if (total > constants.MAX_COMPANY) errors.push(`ai loadout ${l.id}: company ${total} > MAX_COMPANY`);
  }
  if (errors.length) throw new Error(`Invalid game data:\n  ${errors.join('\n  ')}`);

  return { constants, classes, units, generals, formations, aiLoadouts, names, classById, unitById, generalById, formationById, aiLoadoutById };
}

/** Clone game data with constants overridden (debug constants panel → next battle). */
export function withConstants(data: GameData, overrides: Partial<Constants>): GameData {
  return { ...data, constants: ConstantsSchema.parse({ ...data.constants, ...overrides }) };
}

let cached: GameData | undefined;
/** The validated built-in game data. */
export function getGameData(): GameData {
  cached ??= buildGameData(rawGameData);
  return cached;
}
