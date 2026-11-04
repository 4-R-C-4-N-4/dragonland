// Disposition exploration (MVP2 / DECISIONS D21). Mirror armies (identical species per squad),
// only dispositions differ; every pairing is played both ways round to cancel side bias.
// Usage: npx tsx tools/dispo.ts [--runs 20] [--set fierce.blockRadius=80 ...]
import { getGameData, type Disposition, type GameData } from '../src/data';
import { DispositionBehaviorSchema } from '../src/data/schemas';
import { createBattle, createRng, nextInt, step, type SideSetup } from '../src/sim';

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1] ?? 20) || 20;
const base = getGameData();
const beh = structuredClone(base.behaviors) as Record<string, Record<string, unknown> | unknown>;
args.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, raw] = args[i + 1]!.split('=');
  const [group, key] = path!.split('.');
  const value = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
  if (key) (beh[group!] as Record<string, unknown>)[key] = value;
  else beh[group!] = value;
});
const data: GameData = { ...base, behaviors: DispositionBehaviorSchema.parse(beh) };

const pool = data.units.filter((u) => u.stage < 3).map((u) => u.id);
function army(seed: number): string[][] {
  const rng = createRng(seed);
  return [0, 1, 2, 3].map(() => Array.from({ length: 25 }, () => pool[nextInt(rng, pool.length)]!));
}
function side(units: string[][], disp: Disposition[], tag: string, general: 'paladin' | 'dragon'): SideSetup {
  return {
    generalId: general,
    formationId: 'line',
    squads: units.map((us, s) => ({
      id: `${tag}${s}`, name: `${tag}${s}`, disposition: disp[s]!,
      troops: us.map((unitId, k) => ({ troopId: `${tag}-${s}-${k}`, name: `${tag}${s}${k}`, unitId })),
    })),
  };
}

const SETS: Record<string, Disposition[]> = {
  FFFF: ['fierce', 'fierce', 'fierce', 'fierce'],
  MMMM: ['mixed', 'mixed', 'mixed', 'mixed'],
  GGGG: ['guard', 'guard', 'guard', 'guard'],
  FMMG: ['fierce', 'mixed', 'mixed', 'guard'],
  FFMG: ['fierce', 'fierce', 'mixed', 'guard'],
  MMMG: ['mixed', 'mixed', 'mixed', 'guard'],
  FFMM: ['fierce', 'fierce', 'mixed', 'mixed'],
};
const names = Object.keys(SETS);
const score = new Map<string, { w: number; n: number }>(names.map((n) => [n, { w: 0, n: 0 }]));
const reasons = { generalDefeated: 0, duel: 0 };
let totalDur = 0, battles = 0;
const rows: string[] = [];
for (const a of names) {
  const cells: string[] = [];
  for (const b of names) {
    if (a === b) { cells.push('  -  '); continue; }
    let aw = 0, n = 0;
    for (let r = 0; r < runs; r++) {
      const units = army(1000 + r);
      for (const flip of [false, true]) {
        const sa = side(units, SETS[a]!, 'a', r % 2 ? 'dragon' : 'paladin');
        const sb = side(units, SETS[b]!, 'b', r % 2 ? 'dragon' : 'paladin');
        const w = createBattle(data, { seed: 7 + r, sides: flip ? [sb, sa] : [sa, sb] });
        for (let t = 0; t < 20 * 60 * 6 && !w.result; t++) step(w);
        const res = w.result!;
        const aSide = flip ? 1 : 0;
        if (res.winner === aSide) aw++;
        n++;
        reasons[res.reason]++;
        totalDur += res.durationS;
        battles++;
      }
    }
    score.get(a)!.w += aw;
    score.get(a)!.n += n;
    cells.push(`${String(Math.round((100 * aw) / n)).padStart(3)}% `);
  }
  rows.push(`${a}  ${cells.join(' ')}`);
}
console.log(`row beats column (win %), ${runs * 2} battles per cell, mirror species`);
console.log(`      ${names.map((n) => n.padEnd(5)).join(' ')}`);
for (const r of rows) console.log(r);
console.log('overall', names.map((n) => `${n} ${Math.round((100 * score.get(n)!.w) / score.get(n)!.n)}%`).join('  '));
console.log(`end reasons ${JSON.stringify(reasons)}, mean fight ${(totalDur / battles).toFixed(0)}s`);
