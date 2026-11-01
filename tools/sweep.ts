
// Unit-stat sweep: npx tsx tools/sweep.ts '<json patch>' runs  — patch = {"units":{"archer":{"attackCooldownS":2}},"constants":{...}}
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
import { buildGameData, rawGameData } from '../src/data';
import { buildSideSetupFromLoadout } from '../src/ai/commit';
import { createAiController } from '../src/ai/policy';
import { createBattle, createRng, step } from '../src/sim';
const patch = JSON.parse(process.argv[2] ?? '{}');
const runs = Number(process.argv[3] ?? 30);
const pairs = (process.argv[4] ?? 'lean-human:lean-beast').split(',').map((p) => p.split(':'));
const raw = structuredClone(rawGameData) as any;
for (const [id, o] of Object.entries(patch.units ?? {})) Object.assign(raw.units.find((u: any) => u.id === id), o);
Object.assign(raw.constants, patch.constants ?? {});
const data = buildGameData(raw);
for (const [a, b] of pairs) {
  let wa = 0, dur = 0, la = 0, lb = 0, duel = 0;
  for (let s = 1; s <= runs; s++) {
    const rng = createRng(s);
    const w = createBattle(data, { seed: s, sides: [buildSideSetupFromLoadout(data, data.aiLoadoutById.get(a!)!, rng), buildSideSetupFromLoadout(data, data.aiLoadoutById.get(b!)!, rng)] });
    const c = [createAiController(data, 0), createAiController(data, 1)];
    while (!w.result && w.tick < 8000) { c[0]!.update(w); c[1]!.update(w); step(w); }
    if (w.result!.winner === 0) wa++;
    dur += w.result!.durationS; la += w.result!.dead[0].length; lb += w.result!.dead[1].length; if (w.result!.hadDuel) duel++;
  }
  console.log(`${a} vs ${b}: A wins ${(100 * wa / runs).toFixed(0)}%  dur ${(dur / runs).toFixed(0)}s  losses ${(la / runs).toFixed(0)}/${(lb / runs).toFixed(0)}  duel ${(100 * duel / runs).toFixed(0)}%`);
}
