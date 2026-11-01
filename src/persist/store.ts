// localStorage-backed persistence for roster, loadouts and last-known composition.
// Validated with zod on every read; corrupt/missing data falls back safely.
import { z } from 'zod';
import type { GameData } from '../data';
import type { ClassId, Loadout, Troop } from '../data/schemas';
import { LoadoutSchema, TroopSchema } from '../data/schemas';
import { generateRoster, recruitTroops } from './roster';
import { sanitizeLoadout } from '../ui/builder/logic';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY_PREFIX = 'dragonland.v1';
const ROSTER_KEY = `${KEY_PREFIX}.roster`;
const LOADOUTS_KEY = `${KEY_PREFIX}.loadouts`;
const LAST_COMPOSITION_KEY = `${KEY_PREFIX}.lastComposition`;

const RosterSchema = z.array(TroopSchema);
const LoadoutsSchema = z.array(LoadoutSchema);
const CompositionSchema = z.record(z.string(), z.number());

function readJson<T>(storage: StorageLike, key: string, schema: z.ZodType<T>): T | undefined {
  const raw = storage.getItem(key);
  if (raw == null) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return schema.parse(parsed);
  } catch {
    return undefined;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

export interface Store {
  getRoster(): Troop[];
  resetRoster(seed: number): Troop[];
  /** Add freshly generated named troops (unitId -> count); returns the new roster. */
  recruit(needs: Record<string, number>): Troop[];
  listLoadouts(): Loadout[];
  getLoadout(id: string): Loadout | undefined;
  saveLoadout(loadout: Loadout): void;
  renameLoadout(id: string, name: string): void;
  duplicateLoadout(id: string): Loadout | undefined;
  deleteLoadout(id: string): void;
  applyBattleResult(deadTroopIds: string[]): void;
  getLastComposition(): Partial<Record<ClassId, number>>;
  setLastComposition(composition: Partial<Record<ClassId, number>>): void;
}

let idCounter = 0;
function freshId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createStore(storage: StorageLike, data: GameData): Store {
  function getRoster(): Troop[] {
    const existing = readJson(storage, ROSTER_KEY, RosterSchema);
    if (existing && existing.length > 0) return existing;
    return resetRoster(1);
  }

  function resetRoster(seed: number): Troop[] {
    const roster = generateRoster(data, seed);
    writeJson(storage, ROSTER_KEY, roster);
    return roster;
  }

  function recruit(needs: Record<string, number>): Troop[] {
    const roster = getRoster();
    // Seed from the roster itself so ids/names are reproducible for a given save, yet differ per call.
    let seed = roster.length * 2654435761;
    for (const t of roster) for (let i = 0; i < t.id.length; i++) seed = (Math.imul(seed, 31) + t.id.charCodeAt(i)) | 0;
    const next = [...roster, ...recruitTroops(data, roster, needs, seed >>> 0)];
    writeJson(storage, ROSTER_KEY, next);
    return next;
  }

  function listLoadouts(): Loadout[] {
    return readJson(storage, LOADOUTS_KEY, LoadoutsSchema) ?? [];
  }

  function writeLoadouts(loadouts: Loadout[]): void {
    writeJson(storage, LOADOUTS_KEY, loadouts);
  }

  function getLoadout(id: string): Loadout | undefined {
    return listLoadouts().find((l) => l.id === id);
  }

  function saveLoadout(loadout: Loadout): void {
    const loadouts = listLoadouts();
    const idx = loadouts.findIndex((l) => l.id === loadout.id);
    if (idx >= 0) loadouts[idx] = loadout;
    else loadouts.push(loadout);
    writeLoadouts(loadouts);
  }

  function renameLoadout(id: string, name: string): void {
    const loadouts = listLoadouts();
    const loadout = loadouts.find((l) => l.id === id);
    if (!loadout) return;
    loadout.name = name;
    writeLoadouts(loadouts);
  }

  function duplicateLoadout(id: string): Loadout | undefined {
    const loadout = getLoadout(id);
    if (!loadout) return undefined;
    const copy: Loadout = {
      ...loadout,
      id: freshId('loadout'),
      name: `${loadout.name} (copy)`,
      squads: loadout.squads.map((s) => ({ ...s, id: freshId('squad'), troopIds: [...s.troopIds] })),
    };
    const loadouts = listLoadouts();
    loadouts.push(copy);
    writeLoadouts(loadouts);
    return copy;
  }

  function deleteLoadout(id: string): void {
    writeLoadouts(listLoadouts().filter((l) => l.id !== id));
  }

  function applyBattleResult(deadTroopIds: string[]): void {
    if (deadTroopIds.length === 0) return;
    const dead = new Set(deadTroopIds);
    const roster = getRoster().filter((t) => !dead.has(t.id));
    writeJson(storage, ROSTER_KEY, roster);

    const loadouts = listLoadouts().map((loadout) => {
      const { loadout: sanitized } = sanitizeLoadout(loadout, roster);
      return sanitized;
    });
    writeLoadouts(loadouts);
  }

  function getLastComposition(): Partial<Record<ClassId, number>> {
    return (readJson(storage, LAST_COMPOSITION_KEY, CompositionSchema) ?? {}) as Partial<Record<ClassId, number>>;
  }

  function setLastComposition(composition: Partial<Record<ClassId, number>>): void {
    writeJson(storage, LAST_COMPOSITION_KEY, composition);
  }

  return {
    getRoster,
    resetRoster,
    recruit,
    listLoadouts,
    getLoadout,
    saveLoadout,
    renameLoadout,
    duplicateLoadout,
    deleteLoadout,
    applyBattleResult,
    getLastComposition,
    setLastComposition,
  };
}
