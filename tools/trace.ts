// Single-battle timeline trace for tuning: npx tsx tools/trace.ts <loadoutA> <loadoutB> <seed>

import { getGameData } from '../src/data';
import { buildSideSetupFromLoadout } from '../src/ai/commit';
import { createAiController } from '../src/ai/policy';
import { createRng } from '../src/sim/rng';
import { createBattle, step } from '../src/sim';
const data = getGameData();
const [a,b,seed] = [process.argv[2]??'mirror-human', process.argv[3]??'mirror-beast', Number(process.argv[4]??1)];
const rng = createRng(seed);
const setup = { seed, sides: [buildSideSetupFromLoadout(data, data.aiLoadoutById.get(a)!, rng), buildSideSetupFromLoadout(data, data.aiLoadoutById.get(b)!, rng)] as any };
const w = createBattle(data, setup);
const c = [createAiController(data,0), createAiController(data,1)];
let hitsOnGeneral=[0,0];
while (!w.result && w.tick < 20000) {
  c[0]!.update(w); c[1]!.update(w); step(w);
  for (const ev of w.events) if (ev.type==='hit' && w.ents.isGeneral[ev.target]) hitsOnGeneral[w.ents.side[ev.target]!]!++;
  if (w.tick % 300 === 0 || w.result) {
    const e=w.ents;
    const sq = w.squads.map(s=>`${s.side}${s.name}:${s.alive}@${Math.round(s.centroidX)},${Math.round(s.centroidY)}`).join(' ');
    console.log(`t=${w.fightTimeS.toFixed(0)} ${w.phase} G0=${e.hp[w.generals[0].entity]!.toFixed(0)} G1=${e.hp[w.generals[1].entity]!.toFixed(0)} | ${sq}`);
  }
}
console.log('result', JSON.stringify({...w.result, dead:undefined, survivors:undefined}), 'hitsOnGeneral', hitsOnGeneral);
