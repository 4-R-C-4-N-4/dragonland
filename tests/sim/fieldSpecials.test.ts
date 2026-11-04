import { describe, expect, it } from 'vitest';
import { getGameData, SpecialEffectSchema, type GeneralId, type SpecialEffectInput } from '../../src/data';
import { createBattle, step } from '../../src/sim';
import { doFireSpecial } from '../../src/sim/specials';
import type { BattleSetup, World } from '../../src/sim';

const data = getGameData();

/** Our hero vs a dragon; 6 enemy dogs spread across the field, 4 own soldiers (wounded). */
function arena(generalId: GeneralId, special?: { power?: number; effects: SpecialEffectInput[] }): World {
  const base = data.generalById.get(generalId)!;
  const override = special && { ...base, special: { ...base.special, power: special.power ?? 1, effects: special.effects.map((e) => SpecialEffectSchema.parse(e)) } };
  const setup: BattleSetup = {
    seed: 5,
    sides: [
      { generalId, formationId: 'line', general: override,
        squads: [{ id: 'p', name: 'P', disposition: 'mixed', troops: [0, 1, 2, 3].map((k) => ({ troopId: `s${k}`, name: `S${k}`, unitId: 'soldier' })) }] },
      { generalId: 'dragon', formationId: 'line',
        squads: [{ id: 'e', name: 'E', disposition: 'mixed', troops: [0, 1, 2, 3, 4, 5].map((k) => ({ troopId: `d${k}`, name: `D${k}`, unitId: 'dog' })) }] },
    ],
  };
  const w = createBattle(data, setup);
  while (w.phase === 'deploy') step(w);
  const e = w.ents;
  e.x[w.generals[0].entity] = 100; e.y[w.generals[0].entity] = 300;
  e.x[w.generals[1].entity] = 1500; e.y[w.generals[1].entity] = 300;
  // enemies: three on the caster->general line, three far off it
  [[600, 300], [900, 310], [1200, 290], [600, 40], [900, 560], [1300, 60]].forEach(([x, y], k) => {
    const i = e.troopId.indexOf(`d${k}`);
    e.x[i] = x!; e.y[i] = y!;
  });
  for (let k = 0; k < 4; k++) {
    const i = e.troopId.indexOf(`s${k}`);
    e.x[i] = 200 + k * 20; e.y[i] = 300; e.hp[i] = e.maxHp[i]! * 0.5;
  }
  return w;
}
const hp = (w: World, id: string) => w.ents.hp[w.ents.troopId.indexOf(id)]!;
const full = (w: World, id: string) => w.ents.maxHp[w.ents.troopId.indexOf(id)]!;

describe('field-wide specials (D24)', () => {
  it('every general is a stage-3 species with a described special that has an fx id', () => {
    expect(data.generals).toHaveLength(15);
    for (const g of data.generals) {
      expect(data.unitById.get(g.unitId)!.stage).toBe(3);
      expect(g.special.effects.length).toBeGreaterThan(0);
      expect(g.special.fx).toMatch(/^[a-z-]+$/);
      expect(g.special.description.length).toBeGreaterThan(10);
    }
    expect(new Set(data.generals.map((g) => data.unitById.get(g.unitId)!.classId)).size).toBe(5);
  });

  it('field damage hits every enemy troop wherever it is, and the general when flagged', () => {
    const w = arena('paladin', { effects: [{ type: 'damage', area: 'field', amount: 20, includeGeneral: true }] });
    doFireSpecial(w, data, 0);
    for (let k = 0; k < 6; k++) expect(hp(w, `d${k}`)).toBeLessThan(full(w, `d${k}`));
    expect(w.ents.hp[w.generals[1].entity]).toBeLessThan(w.ents.maxHp[w.generals[1].entity]!);
  });

  it('a wave crosses the whole field along the caster->enemy general line, hitting the general', () => {
    const w = arena('paladin', { effects: [{ type: 'damage', area: 'wave', amount: 30, width: 60, includeGeneral: true }] });
    doFireSpecial(w, data, 0);
    for (const k of [0, 1, 2]) expect(hp(w, `d${k}`)).toBeLessThan(full(w, `d${k}`));
    for (const k of [3, 4, 5]) expect(hp(w, `d${k}`)).toBe(full(w, `d${k}`));
    expect(w.ents.hp[w.generals[1].entity]).toBeLessThan(w.ents.maxHp[w.generals[1].entity]!);
  });

  it('random strikes hit exactly N distinct enemies, deterministically', () => {
    const hits = (w: World) => [0, 1, 2, 3, 4, 5].filter((k) => hp(w, `d${k}`) < full(w, `d${k}`));
    const a = arena('paladin', { effects: [{ type: 'damage', area: 'random', amount: 25, targets: 3 }] });
    const b = arena('paladin', { effects: [{ type: 'damage', area: 'random', amount: 25, targets: 3 }] });
    doFireSpecial(a, data, 0);
    doFireSpecial(b, data, 0);
    expect(hits(a)).toHaveLength(3);
    expect(hits(b)).toEqual(hits(a));
  });

  it('heals all own troops by a fraction of max HP, scaled by power', () => {
    const w = arena('paladin', { power: 2, effects: [{ type: 'heal', fraction: 0.1 }] });
    doFireSpecial(w, data, 0);
    for (let k = 0; k < 4; k++) expect(hp(w, `s${k}`)).toBeCloseTo(full(w, `s${k}`) * 0.7);
  });

  it('buffs and debuffs are timed side-wide modifiers that expire', () => {
    const w = arena('paladin', { effects: [
      { type: 'buff', durationS: 2, damageMult: 1.5, speedMult: 1.2, defenseMult: 0.8 },
      { type: 'debuff', durationS: 2, speedMult: 0.5, dotPerS: 10 },
    ] });
    doFireSpecial(w, data, 0);
    expect(w.activeEffects.map((a) => a.side).sort()).toEqual([0, 1]);
    const before = hp(w, 'd3');
    for (let t = 0; t < data.constants.SIM_HZ; t++) step(w);
    expect(hp(w, 'd3')).toBeLessThan(before - 5); // ~10/s damage over time
    for (let t = 0; t < data.constants.SIM_HZ * 2; t++) step(w);
    expect(w.activeEffects).toHaveLength(0);
  });

  it('emits one special event carrying the fx id, areas and affected entities', () => {
    const w = arena('dragon');
    w.generals[0].mp = w.generals[0].maxMp;
    w.events.length = 0;
    doFireSpecial(w, data, 0);
    expect(w.generals[0].mp).toBe(0);
    const ev = w.events.find((e) => e.type === 'special');
    expect(ev).toMatchObject({ type: 'special', side: 0, specialId: data.generalById.get('dragon')!.special.id, fx: data.generalById.get('dragon')!.special.fx });
    if (ev?.type === 'special') expect(ev.affected.length).toBeGreaterThan(0);
  });
});

it('snapshots separate targets for mixed areas, including lethal strikes and timed modifiers', () => {
  const w = arena('paladin', { effects: [
    { type: 'damage', area: 'random', amount: 100000, targets: 1 },
    { type: 'heal', fraction: 0.1 },
    { type: 'buff', durationS: 2, damageMult: 1.5 },
    { type: 'debuff', durationS: 2, speedMult: 0.5 },
  ] });
  doFireSpecial(w, data, 0);
  const ev = w.events.find((e) => e.type === 'special');
  if (ev?.type !== 'special') throw new Error('missing special');
  expect(ev.areas).toEqual(['random', 'heal', 'buff', 'debuff']);
  const targets = ev.areaTargets;
  expect(targets).toHaveLength(4);
  const strike = targets![0]!.targets;
  expect(strike).toHaveLength(1);
  expect(w.ents.alive[strike[0]!.entity]).toBe(0);
  expect(strike[0]).toEqual({ entity: strike[0]!.entity, x: w.ents.x[strike[0]!.entity], y: w.ents.y[strike[0]!.entity] });
  for (const index of [1, 2, 3]) {
    const side = index === 3 ? 1 : 0;
    expect(targets![index]!.targets.length).toBeGreaterThan(0);
    expect(targets![index]!.targets.every((t) => w.ents.side[t.entity] === side && w.ents.alive[t.entity])).toBe(true);
  }
  // Preserve the legacy union of immediate damage/heal recipients.
  expect(new Set(ev.affected)).toEqual(new Set([...strike, ...targets![1]!.targets].map((t) => t.entity)));
  const x = strike[0]!.x;
  w.ents.x[strike[0]!.entity] = x + 99;
  expect(strike[0]!.x).toBe(x);
});
