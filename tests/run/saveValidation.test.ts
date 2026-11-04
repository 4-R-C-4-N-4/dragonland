import { describe, expect, it, vi } from 'vitest';
import { getGameData } from '../../src/data';
import { chooseEncounter, loadRun, newRun, RUN_KEY, saveRun, startBattle, validateRun } from '../../src/run';
import { attachInput } from '../../src/battle/input';
import { createBattle } from '../../src/sim';
import { Selection } from '../../src/battle/selection';
import { getDebugState, updateDebugState } from '../../src/debug/state';

const data = getGameData();
function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
function activeRun() {
  const s = newRun(data, { seed: 9, generalId: 'paladin' });
  return startBattle(data, chooseEncounter(s, s.offers[0]!.id), { formationId: 'line', squads: [{ name: 'A', disposition: 'mixed', troopIds: s.roster.slice(0, 4).map(t => t.id) }] });
}

describe('semantic save validation', () => {
  it.each([
    ['encounter offer troop', (s: ReturnType<typeof activeRun>) => {
      // Offers only exist while choosing; rewind this case to the select phase.
      const select = newRun(data, { seed: 9, generalId: 'paladin' });
      select.offers[0]!.side.squads[0]!.troops[0]!.unitId = 'removed-species';
      Object.assign(s, select);
    }],
    ['frozen enemy troop', (s: ReturnType<typeof activeRun>) => { s.battle!.setup.sides[1]!.squads[0]!.troops[0]!.unitId = 'removed-species'; }],
    ['frozen player troop', (s: ReturnType<typeof activeRun>) => { s.battle!.setup.sides[0]!.squads[0]!.troops[0]!.unitId = 'removed-species'; }],
    ['chosen encounter troop', (s: ReturnType<typeof activeRun>) => { s.encounter!.side.squads[0]!.troops[0]!.unitId = 'removed-species'; }],
    ['recruit offer troop', (s: ReturnType<typeof activeRun>) => { s.recruitOffers = [{ id: 'r', troops: [{ id: 'x', name: 'X', unitId: 'removed-species', xp: 0, level: 1 }] }]; }],
    ['frozen general override species', (s: ReturnType<typeof activeRun>) => {
      s.battle!.setup.sides[0]!.general = { ...data.generalById.get('paladin')!, unitId: 'removed-species' };
    }],
    ['frozen general override identity', (s: ReturnType<typeof activeRun>) => {
      // A saved override must describe the side's own general, not a different hero.
      s.battle!.setup.sides[0]!.general = { ...data.generalById.get('dragon')!, hp: 1234 };
    }],
    ['summary casualty', (s: ReturnType<typeof activeRun>) => {
      s.lastSummary = { battleId: 'b', won: false, boss: false, dead: [{ id: 'd', name: 'D', unitId: 'removed-species' }], recovered: [], xpAwarded: 0, levelUps: 0, evolutions: [], heroLevelFrom: 1, heroLevelTo: 1 };
    }],
  ])('reports a corrupt save instead of crashing on an unknown %s', (_label, corrupt) => {
    const storage = memory(), state = activeRun();
    corrupt(state);
    saveRun(storage, state);
    const raw = storage.getItem(RUN_KEY);
    const loaded = loadRun(storage, data);
    expect(loaded.kind).toBe('corrupt');
    if (loaded.kind === 'corrupt') expect(loaded.error).toMatch(/removed-species|does not match/);
    // A corrupt save is reported, never silently rewritten.
    expect(storage.getItem(RUN_KEY)).toBe(raw);
  });

  it('accepts every reference in a real saved run, including legitimate frozen hero stats', () => {
    expect(() => validateRun(data, activeRun())).not.toThrow();
    const progressed = activeRun();
    const base = data.generalById.get(progressed.battle!.setup.sides[0]!.generalId)!;
    // Hero progression legitimately freezes scaled stats and special power.
    progressed.battle!.setup.sides[0]!.general = {
      ...base, level: 7, hp: base.hp * 1.4, attack: base.attack * 1.2,
      special: { ...base.special, power: base.special.power * 1.3 },
    };
    expect(() => validateRun(data, progressed)).not.toThrow();
  });
});

describe('debug overlay shortcut', () => {
  it('toggles once per backtick press while a battle owns input', () => {
    const world = createBattle(data, activeRun().battle!.setup);
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const detach = attachInput(target as unknown as Document, world, new Selection(4), { onSpeedToggle: vi.fn() });
    const handler = target.addEventListener.mock.calls[0]![1] as (e: KeyboardEvent) => void;
    const before = getDebugState().overlay;
    const event = { key: '`', preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;
    handler(event);
    expect(getDebugState().overlay).toBe(!before);
    // The application-level listener must not receive a second, cancelling toggle.
    expect(event.stopPropagation).toHaveBeenCalled();
    handler(event);
    expect(getDebugState().overlay).toBe(before);
    detach();
    updateDebugState({ overlay: before });
  });
});
