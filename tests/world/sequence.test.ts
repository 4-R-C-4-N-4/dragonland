import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { deriveTroopStats } from '../../src/progression';
import { createBattle, step } from '../../src/sim';
import { buildWorldData, rawWorldData, createWar } from '../../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, retreatEncounter, sequenceEncounter, snapshotBattleResult, type TerminalBattleSnapshot } from '../../src/world/sequence';
import { internal } from '../../src/world/rng';

const data = buildWorldData(rawWorldData);
const game = getGameData();
const makeWar = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
function contact(war: ReturnType<typeof makeWar>) {
  const [attacker, defender] = war.divisions;
  war.pendingBattle = { id: 'battle-sequence', cause: 'contact', nodeId: attacker!.atNode, attacker: attacker!.id, defender: defender!.id, wild: [], processedSkirmishIds: [] };
  return { attacker: attacker!, defender: defender!, pending: war.pendingBattle };
}
function placeDivision(war: ReturnType<typeof makeWar>, d: typeof war.divisions[number], node: string, previous: string | null) {
  d.atNode = node; d.previousNode = previous;
  for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.nodeId = node;
}
function setupSkirmish(war: ReturnType<typeof makeWar>) {
  const { attacker, defender, pending } = contact(war);
  attacker.generals = attacker.generals.filter(id => !war.generals.find(g => g.id === id)!.isHero).slice(0, 2);
  defender.generals = defender.generals.filter(id => !war.generals.find(g => g.id === id)!.isHero).slice(0, 2);
  expect(attacker.generals.length).toBeGreaterThan(0); expect(defender.generals.length).toBeGreaterThan(0);
  const aNode = war.nodes.find(n => n.kind === 'castle' && n.owner === attacker.factionId)!.id;
  const dNode = war.nodes.find(n => n.kind === 'castle' && n.owner === defender.factionId)!.id;
  const common = war.nodes.find(n => war.routes.some(r => (r.from === n.id && r.to === aNode) || (r.to === n.id && r.from === aNode)) && war.routes.some(r => (r.from === n.id && r.to === dNode) || (r.to === n.id && r.from === dNode)))?.id;
  const battleNode = common ?? pending.nodeId;
  placeDivision(war, attacker, battleNode, aNode); placeDivision(war, defender, battleNode, dNode); pending.nodeId = battleNode;
  // Keep the recorded route specific to each division.
  internal(war).paths[attacker.id] = [aNode]; internal(war).paths[defender.id] = [dNode];
  const seq = sequenceEncounter(war, pending); commitDefender(war, seq, seq.defenderGeneralIds[0]!);
  const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
  const ids = battle.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
  const snapshot = (winner: 0 | 1, hp?: [number, number]): TerminalBattleSnapshot => ({ result: { winner, reason: 'generalDefeated', durationS: 1, hadDuel: false, dead: [[], []], survivors: ids }, generalHp: hp ?? (winner === 0 ? [battle.setup.sides[0]!.general!.hp, 0] : [0, battle.setup.sides[1]!.general!.hp]) });
  return { attacker, defender, pending, seq, battle, snapshot };
}

describe('battle sequencing', () => {
  it('retains seven garrison defenders and five attackers, committing defender first', () => {
    const war = makeWar();
    const { attacker, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 5);
    const hostile = war.factions.find(f => f.id !== attacker.factionId)!;
    const node = war.nodes.find(n => n.kind === 'castle' && n.owner === hostile.id)!;
    pending.nodeId = node.id;
    // Garrison holds seven unassigned authored records.
    const defenders = war.divisions.find(d => d.factionId === hostile.id)!;
    defenders.generals = [];
    const candidates = war.generals.filter(g => g.factionId === hostile.id).slice(0, 3);
    defenders.generals = candidates.map(g => g.id);
    for (let i = 3; i < 7; i++) {
      const template = candidates[0]!;
      const extra = { ...structuredClone(template), id: `extra-${i}`, name: `Extra ${i}`, troops: template.troops.map((t, j) => ({ ...t, id: `extra-${i}-troop-${j}` })) };
      war.generals.push(extra);
      candidates.push(extra);
    }
    defenders.atNode = pending.nodeId;
    for (const g of candidates) g.nodeId = pending.nodeId;
    for (const d of war.divisions.filter(d => d.factionId === hostile.id)) d.generals = [];
    for (const g of war.generals.filter(g => g.factionId === hostile.id)) g.nodeId = pending.nodeId;
    pending.defender = null;
    const seq = sequenceEncounter(war, pending);
    expect(seq.defenderGeneralIds).toHaveLength(7);
    expect(seq.attackerGeneralIds).toHaveLength(5);
    expect(() => commitAttacker(war, seq, seq.attackerGeneralIds[0]!)).toThrow(/defender first/i);
    expect(seq.selectedAttacker).toBeNull();
    expect(commitDefender(war, seq, seq.defenderGeneralIds[0]!)).toBeNull();
    const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    expect(battle.generalIds).toEqual([seq.defenderGeneralIds[0], seq.attackerGeneralIds[0]]);
    expect(battle.setup.sides.map(s => s.generalId)).toEqual(battle.generalIds.map(id => war.generals.find(g => g.id === id)!.generalId));
  });

  it('rejects duplicate records, missing records, and enemy ownership', () => {
    const duplicate = makeWar(); const { attacker, defender, pending } = contact(duplicate);
    defender.generals.push(attacker.generals[0]!);
    duplicate.generals.find(g => g.id === attacker.generals[0])!.factionId = defender.factionId;
    expect(() => sequenceEncounter(duplicate, pending)).toThrow(/duplicate/i);
    const missingWar = makeWar(); const missing = contact(missingWar);
    missing.attacker.generals[0] = 'absent-general';
    expect(() => sequenceEncounter(missingWar, missing.pending)).toThrow(/missing/i);
    const enemyWar = makeWar(); const enemy = contact(enemyWar);
    enemy.defender.factionId = enemy.attacker.factionId;
    expect(() => sequenceEncounter(enemyWar, enemy.pending)).toThrow(/hostile/i);
  });

  it('leaves sequence unchanged after invalid selections and uses fresh records plus progression multipliers', () => {
    const war = makeWar();
    const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 2); defender.generals = defender.generals.slice(0, 2);
    const seq = sequenceEncounter(war, pending);
    const before = structuredClone(seq);
    expect(() => commitDefender(war, seq, seq.attackerGeneralIds[0]!)).toThrow(/eligible/i);
    expect(seq).toEqual(before);
    commitDefender(war, seq, seq.defenderGeneralIds[0]!);
    const ag = war.generals.find(g => g.id === seq.attackerGeneralIds[0])!;
    ag.hp = Math.max(1, Math.floor(ag.hp / 2));
    ag.troops = ag.troops.slice(1);
    const battle = commitAttacker(war, seq, ag.id);
    const side = battle.setup.sides[1];
    expect(side.general?.hp).toBe(ag.hp);
    expect(side.squads.flatMap(s => s.troops).map(t => t.troopId).sort()).toEqual(ag.troops.map(t => t.id).sort());
    for (const troop of ag.troops) {
      const unit = game.unitById.get(troop.unitId)!;
      expect(side.squads.flatMap(s => s.troops).find(t => t.troopId === troop.id)?.statMult).toBe(deriveTroopStats(unit, troop.level).damageMultiplier);
    }
    const world = createBattle(game, battle.setup);
    for (let i = 0; i < 20000 && !world.result; i++) step(world);
    expect(world.result).not.toBeNull();
  });

  it('roundtrips the actual terminal sim result, survivors, dead troop identities, and terminal HP', () => {
    const war = makeWar();
    const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 1); defender.generals = defender.generals.slice(0, 1);
    const seq = sequenceEncounter(war, pending);
    commitDefender(war, seq, seq.defenderGeneralIds[0]!);
    const skirmish = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    const world = createBattle(game, skirmish.setup);
    for (let i = 0; i < 20000 && !world.result; i++) step(world);
    expect(world.result).not.toBeNull();
    const snapshot = snapshotBattleResult(world);
    expect(snapshot.generalHp).toEqual(world.generals.map(g => world.ents.hp[g.entity]));
    expect(applySkirmishResult(war, seq, skirmish.id, snapshot)).toMatchObject({ resolved: true });
    const records = skirmish.generalIds.map(id => war.generals.find(g => g.id === id)!);
    expect(records.map(g => g.hp)).toEqual(snapshot.generalHp);
    expect(records.map(g => g.troops.map(t => t.id).sort())).toEqual(snapshot.result.survivors.map(ids => [...ids].sort()));
  });

  it('is idempotent for replayed terminal results, including RNG state', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 1); defender.generals = defender.generals.slice(0, 1);
    const seq = sequenceEncounter(war, pending); commitDefender(war, seq, seq.defenderGeneralIds[0]!);
    const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    const world = createBattle(game, battle.setup); for (let i=0;i<20000&&!world.result;i++) step(world);
    const snapshot = snapshotBattleResult(world);
    applySkirmishResult(war, seq, battle.id, snapshot);
    const before = structuredClone(war); const state = structuredClone((war._internal as {rng:unknown}).rng);
    expect(applySkirmishResult(war, seq, battle.id, snapshot)).toMatchObject({ duplicate: true });
    expect(war.generals).toEqual(before.generals);
    expect((war._internal as {rng:unknown}).rng).toEqual(state);
  });

  it('rejects unresolved, malformed, and out of order results atomically', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 1); defender.generals = defender.generals.slice(0, 1);
    const seq = sequenceEncounter(war, pending); commitDefender(war, seq, seq.defenderGeneralIds[0]!);
    const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    const before = structuredClone(war);
    expect(() => applySkirmishResult(war, seq, 'wrong-id', { result: {} as never, generalHp: [1,1] })).toThrow();
    expect(() => applySkirmishResult(war, seq, battle.id, { result: {} as never, generalHp: [1,1] })).toThrow();
    expect(war.generals).toEqual(before.generals); expect(war.pendingBattle).toEqual(before.pendingBattle);
  });

  it('retreats the selected defender along its own recorded path and rejects blocked retreats atomically', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    const aHome = war.nodes.find(n => n.kind === 'castle' && n.owner === attacker.factionId)!.id;
    const dHome = war.nodes.find(n => n.kind !== 'castle' && n.owner === null)!.id;
    const meet = pending.nodeId;
    placeDivision(war, attacker, meet, aHome); placeDivision(war, defender, meet, dHome);
    internal(war).paths[attacker.id] = [aHome]; internal(war).paths[defender.id] = [dHome];
    for (const d of war.divisions.filter(d => d.id !== attacker.id && d.id !== defender.id)) d.generals = [];
    for (const g of war.generals.filter(g => !attacker.generals.includes(g.id) && !defender.generals.includes(g.id))) g.nodeId = war.nodes.find(n => n.kind === 'castle' && n.owner === g.factionId)!.id;
    const seq = sequenceEncounter(war, pending);
    expect(defender.previousNode).not.toBe(attacker.previousNode);
    expect(retreatEncounter(war, seq, defender.id)).toEqual({ resolved: true });
    expect(defender.atNode).toBe(dHome); expect(defender.generals.every(id => war.generals.find(g => g.id === id)!.nodeId === dHome)).toBe(true);

    const blocked = makeWar(); const f = contact(blocked); const home = blocked.nodes.find(n => n.id !== f.pending.nodeId && n.kind !== 'castle' && n.owner === null)!.id;
    placeDivision(blocked, f.attacker, f.pending.nodeId, home); placeDivision(blocked, f.defender, f.pending.nodeId, home);
    f.defender.previousNode = null; internal(blocked).paths[f.defender.id] = [];
    const s = sequenceEncounter(blocked, f.pending); const before = structuredClone(blocked); const rng = structuredClone(internal(blocked).rng);
    expect(() => retreatEncounter(blocked, s, f.defender.id)).toThrow(/retreat/i);
    expect(blocked).toEqual(before); expect(internal(blocked).rng).toEqual(rng);
  });

  it('uses actual recorded retreat path and rejects retreat during an active skirmish', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    const home = war.nodes.find(n => n.id !== pending.nodeId && n.kind !== 'castle' && n.owner === null)!.id;
    placeDivision(war, attacker, pending.nodeId, null); placeDivision(war, defender, pending.nodeId, home);
    const blockedNode = pending.nodeId;
    defender.previousNode = blockedNode; internal(war).paths[defender.id] = [home, blockedNode];
    for (const d of war.divisions.filter(d => d.id !== attacker.id && d.id !== defender.id)) d.generals = [];
    for (const g of war.generals.filter(g => !attacker.generals.includes(g.id) && !defender.generals.includes(g.id))) g.nodeId = war.nodes.find(n => n.kind === 'castle' && n.owner === g.factionId)!.id;
    for (const d of war.divisions.filter(d => d.id !== attacker.id && d.id !== defender.id)) d.generals = [];
    for (const g of war.generals.filter(g => !attacker.generals.includes(g.id) && !defender.generals.includes(g.id))) g.nodeId = war.nodes.find(n => n.kind === 'castle' && n.owner === g.factionId)!.id;
    const seq = sequenceEncounter(war, pending);
    expect(retreatEncounter(war, seq, defender.id).resolved).toBe(true); expect(defender.atNode).toBe(home);
    const active = makeWar(); const x = setupSkirmish(active); const before = structuredClone(active); const rng = structuredClone(internal(active).rng);
    expect(() => retreatEncounter(active, x.seq, x.defender.id)).toThrow(/between skirmishes/i);
    expect(active).toEqual(before); expect(internal(active).rng).toEqual(rng);
  });

  it.each(['CAPTURE_WEIGHT', 'INJURE_WEIGHT', 'KILL_WEIGHT'] as const)('applies forced nonhero loser outcome %s without reviving or duplicating captives', weight => {
    const war = makeWar(); const x = setupSkirmish(war); const constants = internal(war).data.constants;
    const forced = { ...constants, CAPTURE_WEIGHT: 0, INJURE_WEIGHT: 0, KILL_WEIGHT: 0, [weight]: 100 };
    (internal(war) as unknown as { data: { constants: typeof constants } }).data.constants = forced;
    const loserId = x.battle.generalIds[1]!; const loser = war.generals.find(g => g.id === loserId)!;
    expect(loser.isHero).toBe(false);
    applySkirmishResult(war, x.seq, x.battle.id, x.snapshot(0));
    expect(x.attacker.generals).not.toContain(loserId);
    const captors = war.factions.find(f => f.id === x.defender.factionId)!;
    if (weight === 'CAPTURE_WEIGHT') {
      expect(captors.captives.filter(id => id === loserId)).toHaveLength(1);
      expect(war.divisions.some(d => d.factionId === captors.id && d.generals.includes(loserId))).toBe(false);
    } else expect(loser.injuredTurns).toBe(weight === 'INJURE_WEIGHT' ? forced.INJURY_TURNS : 0);
    expect(loser.hp).toBe(0);
  });

  it('explicitly resolves player hero death as lost and clears pending battle', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.filter(id => !war.generals.find(g => g.id === id)!.isHero);
    const hero = war.generals.find(g => g.isHero)!; defender.generals = [hero.id]; hero.factionId = defender.factionId;
    const seq = sequenceEncounter(war, pending); commitDefender(war, seq, hero.id); const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    const ids = battle.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
    applySkirmishResult(war, seq, battle.id, { result: { winner: 1, reason: 'generalDefeated', durationS: 1, hadDuel: false, dead: [[], []], survivors: ids }, generalHp: [0, battle.setup.sides[1]!.general!.hp] });
    expect(war.phase).toBe('lost'); expect(seq.status).toBe('resolved'); expect(war.pendingBattle).toBeNull();
  });

  it('rejects troop identity changes, roster changes, invalid terminal HP, and out of order snapshots atomically', () => {
    const war = makeWar(); const x = setupSkirmish(war); const before = structuredClone(war); const rng = structuredClone(internal(war).rng);
    const valid = x.snapshot(0);
    const cases = [
      { ...valid, result: { ...valid.result, survivors: [[], valid.result.survivors[1]!] as [string[], string[]] } },
      { ...valid, generalHp: [-1, 0] as [number, number] },
      { ...valid, result: { ...valid.result, winner: 1 as const } },
    ];
    x.attacker.generals[0] && (war.generals.find(g => g.id === x.attacker.generals[0])!.troops[0]!.id += '-changed');
    for (const snapshot of cases) expect(() => applySkirmishResult(war, x.seq, x.battle.id, snapshot)).toThrow();
    expect(() => applySkirmishResult(war, x.seq, 'future-skirmish', valid)).toThrow();
    expect(war.phase).toBe(before.phase); expect(war.pendingBattle).toEqual(before.pendingBattle); expect(internal(war).rng).toEqual(rng);

    const appended = makeWar(); const y = setupSkirmish(appended); const record = appended.generals.find(g => g.id === y.battle.generalIds[1])!;
    record.troops.push({ ...structuredClone(record.troops[0]!), id: 'unknown-appended-troop' });
    const appendedBefore = structuredClone(appended); const appendedRng = structuredClone(internal(appended).rng);
    expect(() => applySkirmishResult(appended, y.seq, y.battle.id, y.snapshot(0))).toThrow(/roster changed/i);
    expect(appended).toEqual(appendedBefore); expect(internal(appended).rng).toEqual(appendedRng);
  });

  it('allows an undefeated winner to fight the next enemy with persisted HP and casualties', () => {
    const war = makeWar(); const { attacker, defender, pending } = contact(war);
    attacker.generals = attacker.generals.slice(0, 1);
    // A hero's defeat correctly ends the war; exercise continuation with a nonhero loser.
    defender.generals = defender.generals.filter(id => !war.generals.find(g => g.id === id)!.isHero);
    expect(defender.generals.length).toBeGreaterThanOrEqual(2);
    for (const g of war.generals.filter(g => defender.generals.includes(g.id))) { g.troops = g.troops.slice(0, 2); }
    const seq = sequenceEncounter(war, pending);
    commitDefender(war, seq, seq.defenderGeneralIds[0]!);
    const battle = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    const troopIds = battle.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
    const snapshot: TerminalBattleSnapshot = { result: { winner: 1, reason: 'generalDefeated', durationS: 1, hadDuel: false, dead: [[], []], survivors: troopIds }, generalHp: [0, battle.setup.sides[1]!.general!.hp - 1] };
    applySkirmishResult(war, seq, battle.id, snapshot);
    expect(seq.status).toBe('selecting-defender');
    const persisted = war.generals.find(g => g.id === battle.generalIds[1])!;
    expect(() => commitDefender(war, seq, seq.defenderGeneralIds[1]!)).not.toThrow();
    const next = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
    expect(next.setup.sides[1]!.general!.hp).toBe(persisted.hp);
    expect(next.setup.sides[1]!.squads.flatMap(s=>s.troops).map(t=>t.troopId).sort()).toEqual(persisted.troops.map(t=>t.id).sort());
  });

  it('continues after a constructed nonhero defeat with deterministic winner positions and reserves', () => {
    const war = makeWar(); const x = setupSkirmish(war);
    x.attacker.generals = [...x.attacker.generals, ...war.generals.filter(g => g.factionId === x.attacker.factionId && !g.isHero && !x.attacker.generals.includes(g.id)).slice(0, 1).map(g => g.id)];
    for (const id of x.attacker.generals) war.generals.find(g => g.id === id)!.nodeId = x.attacker.atNode;
    x.seq.attackerGeneralIds = [...x.attacker.generals];
    const winnerId = x.battle.generalIds[1]!; const loserId = x.battle.generalIds[0]!;
    expect(war.generals.find(g => g.id === loserId)!.isHero).toBe(false);
    applySkirmishResult(war, x.seq, x.battle.id, x.snapshot(1));
    expect(x.seq.status).toBe('selecting-defender'); expect(war.pendingBattle).not.toBeNull();
    expect(war.generals.find(g => g.id === winnerId)!.nodeId).toBe(x.attacker.atNode);
    expect(() => commitDefender(war, x.seq, x.seq.defenderGeneralIds[1]!)).not.toThrow();
    const next = commitAttacker(war, x.seq, x.seq.attackerGeneralIds[0]!);
    const persisted = war.generals.find(g => g.id === winnerId)!;
    expect(next.setup.sides[1]!.general!.hp).toBe(persisted.hp);
    expect(next.setup.sides[1]!.squads.flatMap(s => s.troops).map(t => t.troopId).sort()).toEqual(persisted.troops.map(t => t.id).sort());
  });
});
