// Headless campaign runs for tuning (MVP2). Bot: picks the encounter with the best class edge,
// deploys the auto plan (all A/M/Z by line, highest stage first), takes the largest affordable
// recruit offer whose classes fare best against nothing in particular (first fitting), and spends
// milestones on vitality. Usage: npm run runsim -- [--runs 30] [--seed 1] [--set key=value ...]
import { getGameData } from '../src/data';
import { createBattle, step } from '../src/sim';
import { createAiController } from '../src/ai/policy';
import {
  applyBattleResult, chooseEncounter, chooseHeroUpgrade, chooseRecruitOffer, getRunConfig, newRun, RunConfigSchema, startBattle,
  type RunConfig, type RunState,
} from '../src/run';
import { autoPlan, classEdge, planToArmy } from '../src/ui/run/logic';

const args = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const overrides: Record<string, number> = {};
args.forEach((a, i) => {
  if (a === '--set') {
    const [k, v] = args[i + 1]!.split('=');
    overrides[k!] = Number(v);
  }
});
const data = getGameData();
const cfg: RunConfig = RunConfigSchema.parse({ ...getRunConfig(), ...overrides });
const runs = opt('runs', 30);
const seed0 = opt('seed', 1);

function edgeScore(s: RunState, enc: RunState['offers'][number]): number {
  const enemy = new Map<string, number>();
  for (const t of enc.side.squads.flatMap((q) => q.troops)) {
    const c = data.unitById.get(t.unitId)!.classId;
    enemy.set(c, (enemy.get(c) ?? 0) + 1);
  }
  let score = 0;
  for (const t of s.roster) {
    const v = classEdge(data, data.unitById.get(t.unitId)!.classId, enemy);
    score += v === 'strong' ? 1 : v === 'weak' ? -1 : 0;
  }
  return score;
}

const depths: number[] = [];
let wins = 0;
const lossDetail: string[] = [];
for (let r = 0; r < runs; r++) {
  const generalId = data.generals[r % data.generals.length]!.id;
  let s = newRun(data, { seed: seed0 + r, generalId }, cfg);
  while (s.phase === 'select') {
    const best = [...s.offers].sort((a, b) => edgeScore(s, b) - edgeScore(s, a))[0]!;
    s = chooseEncounter(s, best.id);
    const plan = autoPlan(data, s.roster);
    // DISP=a,b,c,d fixes dispositions; DISP=read counters the enemy's visible doctrine.
    const counter: Record<string, string> = {
      assault: 'guard,mixed,guard,mixed', defensive: 'mixed,mixed,mixed,mixed',
      skirmish: 'fierce,mixed,guard,mixed', balanced: 'mixed,mixed,guard,mixed',
    };
    const disp = process.env.DISP === 'read' ? counter[s.encounter!.doctrine ?? 'balanced'] : process.env.DISP;
    if (disp) plan.squads.forEach((q, i) => (q.disposition = disp.split(',')[i] as never));
    const army = planToArmy(data, s.roster, plan);
    if (army.squads.length === 0) break;
    try {
      s = startBattle(data, s, army);
    } catch {
      break;
    }
    const w = createBattle(data, s.battle!.setup);
    const enemyAi = createAiController(data, 1); // same in-battle policy the browser uses for the enemy
    for (let t = 0; t < 20 * 60 * 8 && !w.result; t++) {
      if (!process.env.NOAI) enemyAi.update(w);
      step(w);
    }
    s = applyBattleResult(data, s, s.battle!.id, w.result!, cfg);
    while (s.pendingMilestones.length && (s.phase === 'rewards' || s.phase === 'won')) s = chooseHeroUpgrade(s, 'vitality');
    if (s.phase === 'rewards') {
      const fit = s.recruitOffers.find((o) => s.roster.length + o.troops.length <= cfg.rosterCap);
      s = chooseRecruitOffer(data, s, fit?.id ?? null, cfg);
    }
  }
  depths.push(s.depth);
  if (s.phase === 'won') wins++;
  else lossDetail.push(`${generalId}@${s.depth}(roster ${s.roster.length})`);
}
const hist = new Map<number, number>();
for (const d of depths) hist.set(d, (hist.get(d) ?? 0) + 1);
console.log(`runs ${runs}, won ${wins} (${((100 * wins) / runs).toFixed(0)}%), mean victories ${(depths.reduce((a, b) => a + b, 0) / runs).toFixed(2)}`);
console.log('victories histogram', Object.fromEntries([...hist].sort((a, b) => a[0] - b[0])));
console.log('losses', lossDetail.join(' '));
