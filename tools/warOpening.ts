// Opening-fight probe: the solo hero against the rival's first field division, both sides on AI.
// Reproduces the figures in DECISIONS D32. Usage: npx tsx tools/warOpening.ts [wars=60] [stack=0]
// stack > 0 merges that many rival field generals into one division (the old opening shape).
import { getGameData } from '../src/data';
import { createBattle, step } from '../src/sim';
import { buildWorldData, rawWorldData, createWar } from '../src/world';
import { applySkirmishResult, commitAttacker, commitDefender, sequenceEncounter, snapshotBattleResult } from '../src/world/sequence';

const wars = Number(process.argv[2] ?? 60);
const stack = Number(process.argv[3] ?? 0);
const data = buildWorldData(rawWorldData);
const game = getGameData();
const heroes = game.generals.map(g => g.id);
let won = 0, captured = 0;
for (let s = 1; s <= wars; s++) {
  const war = createWar(data, { seed: s, heroId: heroes[s % heroes.length]!, heroName: 'Ivy' });
  const own = war.divisions.find(d => d.factionId === 'player')!;
  const rivalDivisions = war.divisions.filter(d => d.factionId !== 'player');
  const foe = rivalDivisions[0]!;
  if (stack > 0) {
    const reserve = war.generals.filter(g => g.factionId !== 'player' && !foe.generals.includes(g.id));
    while (foe.generals.length < stack && reserve.length) { const g = reserve.shift()!; for (const d of rivalDivisions) d.generals = d.generals.filter(id => id !== g.id); g.nodeId = foe.atNode; foe.generals.push(g.id); }
    war.divisions = war.divisions.filter(d => d.generals.length);
  }
  war.pendingBattle = { id: `battle-${s}-probe`, cause: 'contact', nodeId: own.atNode, attacker: own.id, defender: foe.id, wild: [], processedSkirmishIds: [] };
  const seq = sequenceEncounter(war, war.pendingBattle);
  while (seq.status !== 'resolved' && war.phase !== 'lost') {
    const avail = (ids: string[]) => ids.filter(id => !seq.defeatedGeneralIds.includes(id) && !seq.usedGeneralIds.includes(id) && war.generals.find(g => g.id === id)!.hp > 0);
    const d = avail(seq.defenderGeneralIds)[0], a = avail(seq.attackerGeneralIds)[0];
    if (!d || !a) break;
    commitDefender(war, seq, d);
    const sel = commitAttacker(war, seq, a);
    const w = createBattle(game, sel.setup);
    for (let i = 0; i < 200_000 && !w.result; i++) step(w);
    if (!w.result) throw new Error(`war ${s}: unfinished battle`);
    applySkirmishResult(war, seq, sel.id, snapshotBattleResult(w));
  }
  if (war.phase !== 'lost' && foe.generals.length === 0) won++;
  captured += war.factions.find(f => f.isPlayer)!.captives.length;
}
console.log(`${wars} wars, rival division of ${stack || data.constants.RIVAL_OPENING_DIVISION_SIZE}: hero won the encounter ${won}/${wars}, captives taken ${captured}`);
