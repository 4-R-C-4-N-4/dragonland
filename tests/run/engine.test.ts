import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import {
  applyBattleResult, buildPlayerSide, chooseEncounter, chooseHeroUpgrade, chooseRecruitOffer, generateEncounter,
  newRun, startBattle, type RunState, type PlayerArmy,
} from '../../src/run';
import { getRunConfig } from '../../src/run/config';

const data = getGameData();
const cfg = getRunConfig();

function armyOf(state: RunState, n = 40): PlayerArmy {
  const ids = state.roster.slice(0, n).map((t) => t.id);
  const half = Math.ceil(ids.length / 2);
  return {
    formationId: 'line',
    squads: [
      { name: 'Alpha', disposition: 'mixed', troopIds: ids.slice(0, half) },
      { name: 'Beta', disposition: 'fierce', troopIds: ids.slice(half) },
    ],
  };
}

/** Drive a run to its next battle and resolve it with the given casualties. */
function fight(state: RunState, won: boolean, deadCount = 0, runCfg = cfg): { state: RunState; battleId: string; deployed: string[] } {
  let s = chooseEncounter(state, state.offers[0]!.id);
  const army = armyOf(s);
  const deployed = army.squads.flatMap((q) => q.troopIds);
  s = startBattle(data, s, army);
  const battleId = s.battle!.id;
  const dead = deployed.slice(0, deadCount);
  s = applyBattleResult(data, s, battleId, {
    winner: won ? 0 : 1,
    dead: [dead, []],
    survivors: [deployed.slice(deadCount), []],
  }, runCfg);
  return { state: s, battleId, deployed };
}

describe('new run', () => {
  it('starts with 60 stage-1 troops of the chosen class, 20 per line, and encounter offers', () => {
    const s = newRun(data, { seed: 11, generalId: 'paladin', startClass: 'mage' });
    expect(s.phase).toBe('select');
    expect(s.roster).toHaveLength(60);
    const byLine = new Map<string, number>();
    for (const t of s.roster) {
      const u = data.unitById.get(t.unitId)!;
      expect(u.classId).toBe('mage');
      expect(u.stage).toBe(1);
      expect(t).toMatchObject({ xp: 0, level: 1 });
      byLine.set(u.line, (byLine.get(u.line) ?? 0) + 1);
    }
    expect([...byLine.values()]).toEqual([20, 20, 20]);
    expect(new Set(s.roster.map((t) => t.name)).size).toBe(60);
    expect(s.offers).toHaveLength(cfg.encounterOfferCount);
    expect(s.hero).toMatchObject({ generalId: 'paladin', xp: 0, level: 1 });
  });

  it('is deterministic per seed', () => {
    const a = newRun(data, { seed: 5, generalId: 'dragon', startClass: 'beast' });
    const b = newRun(data, { seed: 5, generalId: 'dragon', startClass: 'beast' });
    expect(b).toEqual(a);
    expect(newRun(data, { seed: 6, generalId: 'dragon', startClass: 'beast' }).roster).not.toEqual(a.roster);
  });
});

describe('encounters', () => {
  it('are seeded, blend classes and grow with depth', () => {
    const early = generateEncounter(data, 3, 0, 0, false);
    expect(generateEncounter(data, 3, 0, 0, false)).toEqual(early);
    const count = (e: typeof early) => e.side.squads.reduce((n, q) => n + q.troops.length, 0);
    expect(count(early)).toBe(cfg.enemyStartingTroops);
    const classes = new Set(early.side.squads.flatMap((q) => q.troops.map((t) => data.unitById.get(t.unitId)!.classId)));
    expect(classes.size).toBeGreaterThanOrEqual(2);
    const late = generateEncounter(data, 3, 7, 0, true);
    expect(count(late)).toBeGreaterThan(count(early));
    expect(late.side.squads.length).toBeLessThanOrEqual(data.constants.MAX_SQUADS);
    const stages = (e: typeof early) => new Set(e.side.squads.flatMap((q) => q.troops.map((t) => data.unitById.get(t.unitId)!.stage)));
    expect(stages(early).has(3)).toBe(false);
    expect(stages(late).has(3)).toBe(true);
    expect(late.side.general!.hp).toBeGreaterThan(data.generalById.get(late.side.generalId)!.hp);
  });

  it('only creates valid troop multipliers and unique ids', () => {
    const e = generateEncounter(data, 9, 5, 1, false);
    const troops = e.side.squads.flatMap((q) => q.troops);
    expect(new Set(troops.map((t) => t.troopId)).size).toBe(troops.length);
    for (const t of troops) expect(t.statMult).toBeGreaterThan(0);
    for (const q of e.side.squads) expect(q.troops.length).toBeGreaterThanOrEqual(data.constants.MIN_SQUAD);
  });
});

describe('enemy dispositions', () => {
  it('follow a seeded doctrine: Fierce goes to the fastest squad, Guard to the most durable', () => {
    const doctrines = new Set<string>();
    let leadsFierce = 0;
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = generateEncounter(data, seed, 4, 0, false);
      expect(generateEncounter(data, seed, 4, 0, false)).toEqual(e);
      doctrines.add(e.doctrine!);
      if (e.side.squads[0]!.disposition === 'fierce') leadsFierce++;
      const speed = (q: (typeof e.side.squads)[number]) => q.troops.reduce((n, t) => n + data.unitById.get(t.unitId)!.moveSpeed, 0) / q.troops.length;
      const fierce = e.side.squads.filter((q) => q.disposition === 'fierce');
      const others = e.side.squads.filter((q) => q.disposition !== 'fierce');
      if (fierce.length && others.length) {
        checked++;
        expect(Math.min(...fierce.map(speed))).toBeGreaterThanOrEqual(Math.max(...others.map(speed)) - 1e-9);
      }
    }
    expect(doctrines.size).toBeGreaterThanOrEqual(3);
    expect(leadsFierce).toBeLessThan(40);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('battle resolution', () => {
  const start = () => newRun(data, { seed: 21, generalId: 'paladin', startClass: 'human' });

  it('builds the player side from progression and freezes it at battle start', () => {
    let s = chooseEncounter(start(), start().offers[0]!.id);
    const side = buildPlayerSide(data, s, armyOf(s, 10));
    expect(side.squads.flatMap((q) => q.troops)).toHaveLength(10);
    expect(side.general!.id).toBe('paladin');
    s = startBattle(data, s, armyOf(s, 10));
    expect(s.phase).toBe('battle');
    expect(s.battle!.setup.sides[0].squads.flatMap((q) => q.troops)).toHaveLength(10);
    expect(s.battle!.setup.sides[1]).toEqual(s.encounter!.side);
  });

  it('rejects troops that are not in the roster, duplicates and oversize squads', () => {
    const s = chooseEncounter(start(), start().offers[0]!.id);
    const id = s.roster[0]!.id;
    expect(() => buildPlayerSide(data, s, { formationId: 'line', squads: [{ name: 'X', disposition: 'mixed', troopIds: [id, 'ghost'] }] })).toThrow(/roster/);
    expect(() => buildPlayerSide(data, s, { formationId: 'line', squads: [{ name: 'X', disposition: 'mixed', troopIds: [id, id] }] })).toThrow(/twice/);
    expect(() => buildPlayerSide(data, s, { formationId: 'line', squads: [{ name: 'X', disposition: 'mixed', troopIds: [id] }] })).toThrow(/squad/);
  });

  it('removes the dead, awards XP only to deployed survivors and is idempotent', () => {
    const { state, battleId, deployed } = fight(start(), true, 5, { ...cfg, woundedRecoveryOnWin: 0 });
    expect(state.phase).toBe('rewards');
    expect(state.depth).toBe(1);
    expect(state.roster).toHaveLength(55);
    const byId = new Map(state.roster.map((t) => [t.id, t]));
    for (const id of deployed.slice(0, 5)) expect(byId.has(id)).toBe(false);
    for (const id of deployed.slice(5)) expect(byId.get(id)!.xp).toBe(100);
    const bench = state.roster.filter((t) => !deployed.includes(t.id));
    expect(bench.length).toBe(20);
    for (const t of bench) expect(t.xp).toBe(0);
    expect(state.hero.xp).toBe(100);
    expect(state.lastSummary!.dead).toHaveLength(5);
    const again = applyBattleResult(data, state, battleId, { winner: 0, dead: [deployed.slice(0, 20), []], survivors: [[], []] });
    expect(again).toBe(state);
  });

  it('brings back a share of the fallen as wounded after a victory, deterministically', () => {
    const { state, deployed } = fight(start(), true, 10);
    const back = Math.round(10 * cfg.woundedRecoveryOnWin);
    expect(back).toBeGreaterThan(0);
    expect(state.roster).toHaveLength(60 - 10 + back);
    expect(state.lastSummary!.recovered).toHaveLength(back);
    expect(state.lastSummary!.dead).toHaveLength(10 - back);
    const fallen = new Set(deployed.slice(0, 10));
    for (const r of state.lastSummary!.recovered) {
      expect(fallen.has(r.id)).toBe(true);
      expect(state.roster.find((t) => t.id === r.id)!.xp).toBe(100);
    }
    expect(fight(start(), true, 10).state.lastSummary!.recovered).toEqual(state.lastSummary!.recovered);
  });

  it('recovers nobody when the hero falls', () => {
    const { state } = fight(start(), false, 10);
    expect(state.roster).toHaveLength(50);
    expect(state.lastSummary!.recovered).toEqual([]);
  });

  it('evolves veterans across battles, preserving identity', () => {
    let s = start();
    let deployed: string[] = [];
    for (let i = 0; i < 2; i++) {
      ({ state: s, deployed } = fight(s, true));
      s = chooseRecruitOffer(data, s, null);
    }
    const vet = s.roster.find((t) => t.id === deployed[0])!;
    expect(vet.level).toBe(3);
    expect(data.unitById.get(vet.unitId)!.stage).toBe(2);
    expect(s.lastSummary!.evolutions.some((e) => e.troopId === vet.id)).toBe(true);
  });

  it('ends the run when the hero falls', () => {
    const { state } = fight(start(), false, 3);
    expect(state.phase).toBe('lost');
    expect(() => chooseRecruitOffer(data, state, null)).toThrow();
    expect(() => chooseEncounter(state, 'x')).toThrow();
  });

  it('wins after the configured number of victories', () => {
    let s = start();
    for (let i = 0; i < cfg.battles; i++) {
      ({ state: s } = fight(s, true));
      while (s.phase === 'rewards' && s.pendingMilestones.length) s = chooseHeroUpgrade(s, 'vitality');
      if (s.phase === 'rewards') s = chooseRecruitOffer(data, s, null);
    }
    expect(s.phase).toBe('won');
    expect(s.depth).toBe(cfg.battles);
  });
});

describe('rewards', () => {
  it('offers three distinct-type stage-1 recruit groups and adds the chosen one', () => {
    const { state } = fight(newRun(data, { seed: 31, generalId: 'dragon', startClass: 'beast' }), true, 10);
    expect(state.recruitOffers).toHaveLength(cfg.recruitOfferCount);
    for (const offer of state.recruitOffers) {
      expect(offer.troops).toHaveLength(cfg.recruitsPerOffer);
      expect(new Set(offer.troops.map((t) => t.unitId)).size).toBe(3);
      for (const t of offer.troops) expect(data.unitById.get(t.unitId)!.stage).toBe(1);
    }
    const next = chooseRecruitOffer(data, state, state.recruitOffers[1]!.id);
    const sets = state.recruitOffers.map((o) => [...new Set(o.troops.map((t) => t.unitId))].sort().join());
    expect(new Set(sets).size).toBe(sets.length);
    expect(next.roster).toHaveLength(state.roster.length + cfg.recruitsPerOffer);
    expect(new Set(next.roster.map((t) => t.name)).size).toBe(next.roster.length);
    expect(next.phase).toBe('select');
    expect(next.offers.every((o) => o.depth === 1)).toBe(true);
  });

  it('rejects an offer that would exceed the roster cap but allows skipping', () => {
    const { state } = fight(newRun(data, { seed: 32, generalId: 'dragon', startClass: 'beast' }), true);
    const padded: RunState = { ...state, roster: [...state.roster, ...Array.from({ length: cfg.rosterCap - state.roster.length - 1 }, (_, i) => ({ ...state.roster[0]!, id: `pad-${i}`, name: `Pad ${i}` }))] };
    expect(() => chooseRecruitOffer(data, padded, padded.recruitOffers[0]!.id)).toThrow(/cap/);
    expect(chooseRecruitOffer(data, padded, null).phase).toBe('select');
  });

  it('blocks leaving rewards until an earned milestone is chosen', () => {
    let s = newRun(data, { seed: 33, generalId: 'paladin', startClass: 'human' });
    for (let i = 0; i < 2; i++) {
      ({ state: s } = fight(s, true));
      if (i === 0) s = chooseRecruitOffer(data, s, null);
    }
    expect(s.hero.level).toBe(2);
    ({ state: s } = fight(chooseRecruitOffer(data, s, null), true));
    expect(s.hero.level).toBe(3);
    expect(s.pendingMilestones).toEqual([3]);
    expect(() => chooseRecruitOffer(data, s, null)).toThrow(/milestone/);
    s = chooseHeroUpgrade(s, 'might');
    expect(s.hero.upgrades.might).toBe(1);
    expect(chooseRecruitOffer(data, s, null).phase).toBe('select');
  });
});
