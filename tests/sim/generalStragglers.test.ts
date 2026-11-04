import { describe, expect, it } from 'vitest';
import { getGameData, type Command, type GeneralId } from '../../src/data';
import { createBattle, step, type Side } from '../../src/sim';
import { runGenerals } from '../../src/sim/behavior';

const data = getGameData();
function arena(generalId: GeneralId, side: Side, command: Command = 'hold', count = 1) {
  const enemy: Side = side === 0 ? 1 : 0;
  const w = createBattle(data, { seed: 17, sides: [0, 1].map(s => ({
    generalId: s === side ? generalId : 'archmage', formationId: 'line',
    squads: s === side ? [] : [{ id: 'stragglers', name: 'Stragglers', disposition: 'mixed',
      troops: Array.from({ length: count }, (_, n) => ({ troopId: `imp-${n}`, name: `Imp ${n}`, unitId: 'imp' })),
    }],
  })) as Parameters<typeof createBattle>[1]['sides'] });
  w.phase = 'fight';
  const g = w.generals[side], other = w.generals[enemy];
  const direction = side === 0 ? 1 : -1;
  g.startX = side === 0 ? 400 : 1200; g.startY = 300;
  w.ents.x[g.entity] = g.startX; w.ents.y[g.entity] = g.startY;
  other.startX = side === 0 ? 1500 : 100; other.startY = 50;
  w.ents.x[other.entity] = other.startX; w.ents.y[other.entity] = 50;
  w.squads[0]!.command = command;
  const troops = w.squads[0]!.members;
  // Fall Back only acquires within its configured radius; start inside it so
  // this exercises an actual attacker, not an unprovoked troop leaving battle.
  const initialDistance = command === 'fallBack' ? data.behaviors.mixed.fallBackEngageDist - 10 : 100;
  for (const [n, e] of troops.entries()) {
    w.ents.x[e] = g.startX + direction * (initialDistance + n * 5);
    w.ents.y[e] = 300 + (n % 3 - 1) * 12;
    w.ents.hp[e] = 50; // survivors of the preceding troop battle
  }
  return { w, g, troops };
}

describe('hero retaliation against kiting stragglers', () => {
  it('strikes on the tick it reaches attack range, not after a kiter moves again', () => {
    const { w, g, troops } = arena('shepherd', 0);
    const e = troops[0]!, range = data.unitById.get(g.def.unitId)!.attackRange;
    w.ents.x[e] = g.startX + range + 0.5; w.ents.y[e] = g.startY;
    runGenerals(w);
    expect(w.events.filter(e => e.type === 'hit' && e.attacker === g.entity)).toHaveLength(1);
    expect(w.ents.cooldown[g.entity]).toBeGreaterThan(0);
    runGenerals(w);
    expect(w.events.filter(e => e.type === 'hit' && e.attacker === g.entity)).toHaveLength(1);
  });

  it('keeps the original slow return walk rather than sprinting home', () => {
    const { w, g, troops } = arena('shepherd', 0);
    w.ents.x[g.entity] = g.startX + 60;
    w.ents.x[troops[0]!] = 1000;
    runGenerals(w);
    const speed = data.unitById.get(g.def.unitId)!.moveSpeed * data.behaviors.generalLeashSpeedFrac;
    expect(w.ents.target[g.entity]).toBe(-1);
    expect(w.ents.x[g.entity]).toBeCloseTo(g.startX + 60 - speed / data.constants.SIM_HZ);
  });

  it('still applies movement debuffs to pursuit', () => {
    const a = arena('shepherd', 0), b = arena('shepherd', 0);
    b.w.activeEffects.push({ side: 0, specialId: 'slow', kind: 'debuff', remainingS: 6, damageMult: 1, speedMult: 0.5, defenseMult: 1, dotPerS: 0 });
    runGenerals(a.w); runGenerals(b.w);
    expect(b.w.ents.x[b.g.entity]! - b.g.startX).toBeCloseTo((a.w.ents.x[a.g.entity]! - a.g.startX) / 2);
  });
  it.each([0, 1] as const)('Shepherd lands a normal hit on a retreating ranged survivor on side %i', side => {
    const { w, g } = arena('shepherd', side);
    let hits = 0, received = 0;
    for (let i = 0; i < 12 * data.constants.SIM_HZ && w.phase === 'fight'; i++) {
      step(w);
      for (const e of w.events) if (e.type === 'hit') {
        if (e.attacker === g.entity) hits++;
        if (e.target === g.entity) received++;
      }
    }
    expect(received).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it.each(data.generals.flatMap(g => ([0, 1] as const).flatMap(side =>
    (['hold', 'fallBack'] as const).map(command => ({ hero: g.id, side, command })),
  )))('$hero on side $side can hit a ranged kiter using $command', ({ hero, side, command }) => {
    const { w, g } = arena(hero, side, command);
    let hits = 0;
    for (let t = 0; t < 12 * data.constants.SIM_HZ && w.phase === 'fight' && !hits; t++) {
      step(w);
      hits += w.events.filter(e => e.type === 'hit' && e.attacker === g.entity).length;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it.each([0, 1] as const)('Shepherd clears ten wounded ranged stragglers on side %i without specials', side => {
    const { w, g, troops } = arena('shepherd', side, 'hold', 10);
    let hits = 0;
    for (let t = 0; t < 60 * data.constants.SIM_HZ && w.phase === 'fight'; t++) {
      step(w);
      hits += w.events.filter(e => e.type === 'hit' && e.attacker === g.entity).length;
    }
    expect(w.ents.alive[g.entity]).toBe(1);
    expect(troops.filter(e => w.ents.alive[e] === 1)).toHaveLength(0);
    expect(hits).toBeGreaterThanOrEqual(10);
    expect(w.fightTimeS).toBeLessThan(60);
  });
});
