import { describe, expect, it } from 'vitest';
import { buildWorldData, rawWorldData, createWar, issueOrder, resolveTurn, resumeTurn, completeAdmin, hashWar, replayWar } from '../../src/world';
import { sequenceEncounter, commitDefender, commitAttacker, applySkirmishResult, snapshotBattleResult } from '../../src/world/sequence';
import { createBattle, step } from '../../src/sim';
import { getGameData } from '../../src/data';
import { internal } from '../../src/world/rng';
const data = buildWorldData(rawWorldData);
const make = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });
// Reassign existing authored records only; the hero stays safely unassigned at home.
function contactFixture(nodes: string[]) {
  const war = make();
  const player = war.factions.find(f => f.isPlayer)!;
  const enemy = war.factions.find(f => !f.isPlayer)!;
  const hero = war.generals.find(g => g.isHero)!;
  const records = [player, enemy].map(f => war.generals.filter(g => g.factionId === f.id && !g.isHero));
  const used = new Map([[player.id, 0], [enemy.id, 0]]);
  for (const d of war.divisions) d.generals = [];
  const divisions = nodes.map((node, i) => {
    const faction = i % 2 ? enemy : player;
    const g = records[i % 2]![used.get(faction.id)!] ?? records[i % 2]![0]!;
    used.set(faction.id, used.get(faction.id)! + 1);
    let d = war.divisions.find(x => x.factionId === faction.id)!;
    if (nodes.filter((_, j) => j % 2 === i % 2).length > 1) {
      d = structuredClone(d); d.id = `fixture-${i}`; war.divisions.push(d);
      internal(war).paths[d.id] = [];
    }
    d.generals = [g.id]; d.atNode = node; d.previousNode = null; g.nodeId = node;
    return d;
  });
  hero.nodeId = war.nodes.find(n => n.kind === 'castle' && n.owner === player.id)!.id;
  return { war, divisions, player, enemy };
}
// Deliberately forced valid terminal snapshot, not a result produced by the simulator.
function finishPending(war: ReturnType<typeof make>, winningFaction?: string) {
  const pending = war.pendingBattle!; const seq = sequenceEncounter(war, pending);
  commitDefender(war, seq, seq.defenderGeneralIds[0]!);
  const sk = commitAttacker(war, seq, seq.attackerGeneralIds[0]!);
  const ids = sk.setup.sides.map(s => s.squads.flatMap(q => q.troops.map(t => t.troopId))) as [string[], string[]];
  const winner = (winningFaction ? sk.generalIds.findIndex(id => war.generals.find(g => g.id === id)!.factionId === winningFaction) : 0) as 0 | 1;
  expect([0, 1]).toContain(winner);
  const hp: [number, number] = [0, 0];
  hp[winner] = Math.max(1, sk.setup.sides[winner].general!.hp - 1);
  const snapshot = { result: { winner, reason: 'generalDefeated' as const, durationS: 1, hadDuel: false, dead: [[], []] as [string[], string[]], survivors: ids }, generalHp: hp };
  applySkirmishResult(war, seq, sk.id, snapshot);
  return { encounterId: pending.id, skirmishId: sk.id };
}
describe('interrupted turn continuation', () => {
  it('keeps a committed turn paused through sequence resolution and settles it once', () => {
    const war = make(); const [a,b] = war.divisions;
    const nonHero = (d: typeof a) => d!.generals.find(id => !war.generals.find(g => g.id === id)!.isHero)!;
    a!.generals = [nonHero(a)]; b!.generals = [nonHero(b)];
    const old = a!.atNode; const target = 'greenfield';
    a!.atNode = target; b!.atNode = target;
    for (const g of war.generals.filter(g => a!.generals.includes(g.id))) g.nodeId = a!.atNode;
    for (const g of war.generals.filter(g => b!.generals.includes(g.id))) g.nodeId = b!.atNode;
    issueOrder(war,{type:'hold',division:a!.id}); issueOrder(war,{type:'rest',division:b!.id}); resolveTurn(war);
    expect(war.phase).toBe('battle'); expect(war.turn).toBe(1); expect(war.turnLog).toHaveLength(0);
    const committed=structuredClone(internal(war).activeTurn); const pendingOrders=structuredClone(internal(war).pending);
    issueOrder(war,{type:'rest',division:a!.id});
    expect(internal(war).activeTurn).toEqual(committed); expect(internal(war).pending).toEqual(pendingOrders);
    const pending=war.pendingBattle!; const seq=sequenceEncounter(war,pending);
    const def=commitDefender(war,seq,seq.defenderGeneralIds[0]!); expect(def).toBeNull();
    const sk=commitAttacker(war,seq,seq.attackerGeneralIds[0]!);
    const game=createBattle(getGameData(),sk.setup); for(let i=0;i<20000 && game.phase!=='result';i++) step(game); expect(game.phase).toBe('result');
    // Preserve the simulator's terminal snapshot exactly; both selected generals are non-heroes.
    const winner=game.result!.winner as 0|1;
    applySkirmishResult(war,seq,sk.id,snapshotBattleResult(game));
    expect(war.pendingBattle).toBeNull(); expect(war.phase).toBe('battle');
    const gold=war.factions.map(f=>f.gold); resumeTurn(war);
    expect(war.turn).toBe(2); expect(war.phase).toBe('orders'); expect(war.turnLog).toHaveLength(1); expect(war.factions.some((f,i)=>f.gold!==gold[i])).toBe(true);
    const settled=structuredClone(war); resumeTurn(war); expect(war).toEqual(settled);
    const next=war.divisions.find(d=>d.generals.length)!;
    issueOrder(war,{type:'hold',division:next.id}); resolveTurn(war);
    expect(war.turn).toBe(3); expect(war.turnLog).toHaveLength(2);
    expect(internal(war).pending).toEqual([]); expect(old).not.toBe(target);
  });
  it('allows admin completion without consuming a turn',()=>{const war=make(); war.phase='admin'; completeAdmin(war); expect(war.phase).toBe('orders'); expect(war.turn).toBe(1);});
  it('stops a committed rest before healing or income when the hero is already terminal',()=>{
    const war=make(); const hero=war.generals.find(g=>g.isHero)!; const division=war.divisions.find(d=>d.generals.includes(hero.id))!;
    hero.hp=0; const gold=war.factions.map(f=>f.gold); const hp=hero.hp;
    issueOrder(war,{type:'rest',division:division.id}); resolveTurn(war);
    expect(war.phase).toBe('lost'); expect(hero.hp).toBe(hp); expect(war.factions.map(f=>f.gold)).toEqual(gold);
    const terminal=structuredClone(war); resumeTurn(war); resolveTurn(war); expect(war).toEqual(terminal);
  });
  it('enters weekly admin once after a resumed turn seven and admin completion does not advance',()=>{
    const war=make(); war.turn=7; war.phase='battle';
    internal(war).activeTurn={turn:7,orders:[],starts:{},resolved:[],ordinal:0,current:null,applied:[]};
    resumeTurn(war);
    expect(war.phase).toBe('admin'); expect(war.turn).toBe(8); expect(war.week).toBe(2);
    const admin=structuredClone(war); resumeTurn(war); expect(war).toEqual(admin);
    completeAdmin(war); expect(war.phase).toBe('orders'); expect(war.turn).toBe(8);
  });
  it('resumes through two independent contacts and settles upkeep once',()=>{
    const nodes=['greenfield','greenfield','pinewatch','pinewatch']; const {war,divisions}=contactFixture(nodes);
    for (const d of divisions) issueOrder(war,{type:'hold',division:d.id});
    resolveTurn(war); expect(war.pendingBattle).not.toBeNull(); const first=finishPending(war); resumeTurn(war);
    expect(war.pendingBattle).not.toBeNull(); const second=finishPending(war); resumeTurn(war);
    expect(first.encounterId).not.toBe(second.encounterId); expect(first.skirmishId).not.toBe(second.skirmishId);
    expect(war.phase).toBe('orders'); expect(war.turn).toBe(2); expect(war.turnLog).toHaveLength(1);
  });
  it('handles multiple hostile divisions at one node without dropping or repeating encounters', () => {
    const { war, enemy } = contactFixture(['greenfield', 'greenfield', 'greenfield']);
    resolveTurn(war);
    const first = finishPending(war, enemy.id);
    resumeTurn(war);
    expect(war.phase).toBe('battle');
    expect(war.pendingBattle).not.toBeNull();
    const second = finishPending(war, enemy.id);
    expect(first.encounterId).not.toBe(second.encounterId);
    expect(first.skirmishId).not.toBe(second.skirmishId);
    resumeTurn(war);
    expect(war.pendingBattle).toBeNull();
    expect(war.phase).toBe('orders');
    expect(war.turn).toBe(2);
    expect(war.turnLog).toHaveLength(1);
  });
  it('resolves shared-node contacts identically after reversing input arrays', () => {
    const a = contactFixture(['greenfield', 'greenfield', 'greenfield']);
    const b = contactFixture(['greenfield', 'greenfield', 'greenfield']);
    b.war.factions.reverse(); b.war.divisions.reverse(); b.war.generals.reverse();
    b.war.nodes.reverse(); b.war.routes.reverse();
    const histories = [a, b].map(({ war, enemy }) => {
      resolveTurn(war);
      const history = [];
      for (let i = 0; i < 2; i++) {
        expect(war.pendingBattle).not.toBeNull();
        history.push(finishPending(war, enemy.id));
        resumeTurn(war);
      }
      expect(war.phase).toBe('orders');
      return { history, hash: hashWar(war), events: war.events, log: war.turnLog };
    });
    expect(histories[0]).toEqual(histories[1]);
  });
  it('defers capture of an ungarrisoned castle during a hostile edge swap', () => {
    const { war, divisions, player, enemy } = contactFixture(['dawnkeep', 'westmere']);
    // Keep the hero alive but outside the contested castle, so its capacity is not a garrison.
    for (const g of war.generals.filter(g => g.factionId === player.id)) g.nodeId = 'westmere';
    const castle = war.nodes.find(n => n.id === 'dawnkeep')!;
    issueOrder(war, { type: 'march', division: divisions[0]!.id, toNode: 'westmere' });
    issueOrder(war, { type: 'march', division: divisions[1]!.id, toNode: 'dawnkeep' });
    resolveTurn(war);
    expect(war.pendingBattle?.cause).toBe('swap');
    expect(castle.owner).toBe(player.id);
    finishPending(war, enemy.id);
    expect(castle.owner).toBe(player.id);
    resumeTurn(war);
    expect(castle.owner).toBe(enemy.id);
    expect(war.phase).toBe('lost');
  });
  it('preserves castle ownership until its actual garrison has been defeated', () => {
    const { war, divisions, player, enemy } = contactFixture(['dawnkeep', 'westmere']);
    const garrisonId = divisions[0]!.generals[0]!;
    divisions[0]!.generals = [];
    for (const g of war.generals.filter(g => g.factionId === player.id)) g.nodeId = g.id === garrisonId ? 'dawnkeep' : 'westmere';
    const castle = war.nodes.find(n => n.id === 'dawnkeep')!;
    issueOrder(war, { type: 'march', division: divisions[1]!.id, toNode: castle.id });
    resolveTurn(war);
    expect(war.pendingBattle?.cause).toBe('assault');
    expect(castle.owner).toBe(player.id);
    finishPending(war, enemy.id);
    expect(castle.owner).toBe(enemy.id);
    resumeTurn(war);
    expect(war.phase).toBe('lost');
  });
  it('keeps a simultaneous castle wipeout a loss rather than a victory', () => {
    const war = make();
    const player = war.factions.find(f => f.isPlayer)!;
    for (const n of war.nodes) if (n.kind === 'castle') n.owner = null;
    for (const d of war.divisions) issueOrder(war, { type: 'hold', division: d.id });
    resolveTurn(war);
    expect(war.nodes.filter(n => n.kind === 'castle' && n.owner === player.id)).toHaveLength(0);
    expect(war.phase).toBe('lost');
  });
  it('treats a general left behind at a swapped castle as a real garrison instead of capturing it', () => {
    const { war, divisions, player, enemy } = contactFixture(['dawnkeep', 'westmere']);
    // One unassigned player general stays home; the rest, including the hero, leave.
    for (const g of war.generals.filter(g => g.factionId === player.id)) g.nodeId = 'westmere';
    const garrison = war.generals.find(g => g.factionId === player.id && !g.isHero && !divisions.some(d => d.generals.includes(g.id)))!;
    garrison.nodeId = 'dawnkeep';
    const castle = war.nodes.find(n => n.id === 'dawnkeep')!;
    issueOrder(war, { type: 'march', division: divisions[0]!.id, toNode: 'westmere' });
    issueOrder(war, { type: 'march', division: divisions[1]!.id, toNode: 'dawnkeep' });
    resolveTurn(war);
    expect(war.pendingBattle?.cause).toBe('swap');
    finishPending(war, enemy.id);
    resumeTurn(war);
    // The garrison must be fought, so the castle neither flips nor settles this turn.
    expect(castle.owner).toBe(player.id);
    expect(war.pendingBattle?.cause).toBe('assault');
    expect(war.phase).toBe('battle');
    expect(war.turn).toBe(1);
  });
  it('replays completed no battle turns to the same world hash',()=>{
    const war=make();
    for(let n=0;n<6;n++){ for(const d of war.divisions) issueOrder(war,{type:'hold',division:d.id}); resolveTurn(war); }
    const replay=replayWar(data,{seed:17,heroId:'paladin',heroName:'Ivy'},war.turnLog);
    expect(hashWar(replay)).toBe(hashWar(war));
  });
});
