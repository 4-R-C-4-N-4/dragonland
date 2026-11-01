#!/usr/bin/env tsx
// Headless batch simulator (implementation.md §9.2). The main balancing tool.
import { getGameData } from '../src/data';
import { buildSideSetupFromLoadout } from '../src/ai/commit';
import { createAiController } from '../src/ai/policy';
import { createRng } from '../src/sim/rng';
import { createBattle } from '../src/sim/world';
import { step } from '../src/sim/step';
import type { BattleSetup } from '../src/sim/types';

interface Args {
  a: string;
  b: string;
  runs: number;
  seed: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { a: 'human-legion', b: 'beast-horde', runs: 50, seed: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--a') out.a = argv[++i]!;
    else if (arg === '--b') out.b = argv[++i]!;
    else if (arg === '--runs') out.runs = Number(argv[++i]);
    else if (arg === '--seed') out.seed = Number(argv[++i]);
    else if (arg === '--json') out.json = true;
  }
  return out;
}

function runOne(data: ReturnType<typeof getGameData>, idA: string, idB: string, seed: number) {
  const rng = createRng(seed);
  const loadoutA = data.aiLoadoutById.get(idA);
  const loadoutB = data.aiLoadoutById.get(idB);
  if (!loadoutA) throw new Error(`unknown loadout ${idA}`);
  if (!loadoutB) throw new Error(`unknown loadout ${idB}`);
  const setup: BattleSetup = {
    seed,
    sides: [buildSideSetupFromLoadout(data, loadoutA, rng), buildSideSetupFromLoadout(data, loadoutB, rng)],
  };
  const world = createBattle(data, setup);
  const controllers = [createAiController(data, 0), createAiController(data, 1)];
  const maxTicks = 20000;
  let ticks = 0;
  while (world.result === null && ticks < maxTicks) {
    controllers[0]!.update(world);
    controllers[1]!.update(world);
    step(world);
    ticks++;
  }
  const lossesA = world.result ? world.result.dead[0].length : 0;
  const lossesB = world.result ? world.result.dead[1].length : 0;
  return { world, ticks, lossesA, lossesB };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const data = getGameData();
  const wallStart = performance.now();

  let winsA = 0;
  let winsB = 0;
  let duels = 0;
  let totalDuration = 0;
  let totalLossesA = 0;
  let totalLossesB = 0;
  const reasonCounts: Record<string, number> = {};
  let stepTimeTotal = 0;
  let stepTimeCount = 0;

  for (let i = 0; i < args.runs; i++) {
    const seed = args.seed + i;
    const t0 = performance.now();
    const { world, ticks, lossesA, lossesB } = runOne(data, args.a, args.b, seed);
    const t1 = performance.now();
    stepTimeTotal += t1 - t0;
    stepTimeCount += ticks;

    const result = world.result;
    if (!result) continue;
    if (result.winner === 0) winsA++;
    else winsB++;
    if (result.hadDuel) duels++;
    totalDuration += result.durationS;
    totalLossesA += lossesA;
    totalLossesB += lossesB;
    reasonCounts[result.reason] = (reasonCounts[result.reason] ?? 0) + 1;
  }

  const wallMs = performance.now() - wallStart;
  const report = {
    runs: args.runs,
    a: args.a,
    b: args.b,
    seedStart: args.seed,
    winRateA: winsA / args.runs,
    winRateB: winsB / args.runs,
    avgDurationS: totalDuration / args.runs,
    avgLossesA: totalLossesA / args.runs,
    avgLossesB: totalLossesB / args.runs,
    duelFrequency: duels / args.runs,
    endReasonBreakdown: reasonCounts,
    avgStepTimeMs: stepTimeTotal / stepTimeCount,
    wallTimeMs: wallMs,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Runs: ${report.runs} (a=${report.a}, b=${report.b}, seed=${report.seedStart}..${report.seedStart + report.runs - 1})`);
    console.log(`Win rate: A(${report.a})=${(report.winRateA * 100).toFixed(1)}%  B(${report.b})=${(report.winRateB * 100).toFixed(1)}%`);
    console.log(`Avg duration: ${report.avgDurationS.toFixed(1)}s   Duel frequency: ${(report.duelFrequency * 100).toFixed(1)}%`);
    console.log(`Avg losses: A=${report.avgLossesA.toFixed(1)}  B=${report.avgLossesB.toFixed(1)}`);
    console.log(`End reasons: ${JSON.stringify(report.endReasonBreakdown)}`);
    console.log(`Avg step time: ${report.avgStepTimeMs.toFixed(4)} ms/tick   Wall time: ${report.wallTimeMs.toFixed(0)} ms`);
  }
}

main();
