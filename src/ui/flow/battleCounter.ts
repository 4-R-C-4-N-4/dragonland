// Battle counter persisted in localStorage; used to derive a deterministic per-battle seed.
const KEY = 'dragonland.v1.battleCounter';

export interface CounterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getBattleCounter(storage: CounterStorage): number {
  const raw = storage.getItem(KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Increments and persists the counter, returning the new value (also used as the next seed). */
export function bumpBattleCounter(storage: CounterStorage): number {
  const next = getBattleCounter(storage) + 1;
  storage.setItem(KEY, String(next));
  return next;
}
