#!/usr/bin/env tsx
// Headless batch simulator (implementation.md §9.2). The main balancing tool.
//
//   npm run sim -- --a <loadoutId> --b <loadoutId> --runs 200 --seed 1
//   npm run sim -- --matrix --runs 50              every non-test loadout vs every other
//   npm run sim -- --a x --b y --set BASE_DAMAGE=12 --set SKIRMISH_TIME_S=120
//   npm run sim -- --list                          loadout ids
//   add --json for machine-readable output
//
// Both sides are driven by the in-battle AI policy. Seeds run seed..seed+runs-1.
import { getGameData, withConstants, type Constants, type GameData } from '../src/data';
import { buildSideSetupFromLoadout } from '../src/ai/commit';
import { createAiController } from '../src/ai/policy';
import { createBattle, createRng, step, type BattleSetup } from '../src/sim';

interface Args {
  a: string;
  b: string;
  runs: number;
  seed: number;
  json: boolean;
  matrix: boolean;
  list: boolean;
  help: boolean;
  set: Partial<Constants>;
}

const USAGE = `usage: npm run sim -- [--a ID --b ID | --matrix | --list] [--runs N] [--seed N] [--set KEY=VALUE ...] [--json]`;

function parseArgs(argv: string[]): Args {
  const out: Args = { a: 'human-legion', b: 'beast-horde', runs: 50, seed: 1, json: false, matrix: false, list: false, help: false, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
      return v;
    };
    if (arg === '--a') out.a = next();
    else if (arg === '--b') out.b = next();
    else if (arg === '--runs') out.runs = Number(next());
    else if (arg === '--seed') out.seed = Number(next());
    else if (arg === '--json') out.json = true;
    else if (arg === '--matrix') out.matrix = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--set') {
      const [k, v] = next().split('=');
      if (!k || v === undefined || Number.isNaN(Number(v))) throw new Error(`--set expects KEY=NUMBER\n${USAGE}`);
      (out.set as Record<string, number>)[k] = Number(v);
    } else throw new Error(`unknown argument ${arg}\n${USAGE}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error('--runs must be a positive integer');
  return out;
}

interface RunStats {
  winner: 0 | 1 | -1;
  reason: string;
  durationS: number;
  hadDuel: boolean;
  lossesA: number;
  lossesB: number;
  /** Side with more surviving troops when the fight phase ended (-1 = tie). */
  troopLeader: 0 | 1 | -1;
  winnerHpFrac: number;
  ticks: number;
  ms: number;
}

function runOne(data: GameData, idA: string, idB: string, seed: number): RunStats {
  const rng = createRng(seed);
  const loadoutA = data.aiLoadoutById.get(idA);
  const loadoutB = data.aiLoadoutById.get(idB);
  if (!loadoutA) throw new Error(`unknown loadout ${idA} (try --list)`);
  if (!loadoutB) throw new Error(`unknown loadout ${idB} (try --list)`);
  const setup: BattleSetup = {
    seed,
    sides: [buildSideSetupFromLoadout(data, loadoutA, rng), buildSideSetupFromLoadout(data, loadoutB, rng)],
  };
  const t0 = performance.now();
  const world = createBattle(data, setup);
  const controllers = [createAiController(data, 0), createAiController(data, 1)] as const;
  const maxTicks = Math.ceil((data.constants.SKIRMISH_TIME_S + data.constants.DEPLOY_COUNTDOWN_S) * data.constants.SIM_HZ) + data.constants.DUEL_MAX_ROUNDS * Math.ceil(data.constants.DUEL_CADENCE_S * data.constants.SIM_HZ) + 100;
  let troopLeader: RunStats['troopLeader'] = -1;
  let ticks = 0;
  while (world.result === null && ticks < maxTicks) {
    const wasFight = world.phase === 'fight';
    controllers[0].update(world);
    controllers[1].update(world);
    step(world);
    ticks++;
    if (wasFight && world.phase !== 'fight') {
      let alive0 = 0;
      let alive1 = 0;
      for (const s of world.squads) if (s.side === 0) alive0 += s.alive; else alive1 += s.alive;
      troopLeader = alive0 === alive1 ? -1 : alive0 > alive1 ? 0 : 1;
    }
  }
  const ms = performance.now() - t0;
  const r = world.result;
  if (!r) return { winner: -1, reason: 'unfinished', durationS: world.fightTimeS, hadDuel: false, lossesA: 0, lossesB: 0, troopLeader, winnerHpFrac: 0, ticks, ms };
  const g = world.generals[r.winner];
  return {
    winner: r.winner,
    reason: r.reason,
    durationS: r.durationS,
    hadDuel: r.hadDuel,
    lossesA: r.dead[0].length,
    lossesB: r.dead[1].length,
    troopLeader,
    winnerHpFrac: world.ents.hp[g.entity]! / world.ents.maxHp[g.entity]!,
    ticks,
    ms,
  };
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function summarize(data: GameData, a: string, b: string, runs: number, seed: number) {
  const stats: RunStats[] = [];
  for (let i = 0; i < runs; i++) stats.push(runOne(data, a, b, seed + i));
  const finished = stats.filter((s) => s.winner !== -1);
  const winsA = finished.filter((s) => s.winner === 0).length;
  const winsB = finished.filter((s) => s.winner === 1).length;
  const durations = finished.map((s) => s.durationS).sort((x, y) => x - y);
  const reasons: Record<string, number> = {};
  for (const s of stats) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  const duels = finished.filter((s) => s.hadDuel);
  const leaderWonDuel = duels.filter((s) => s.troopLeader !== -1 && s.troopLeader === s.winner).length;
  const ticks = stats.reduce((n, s) => n + s.ticks, 0);
  const ms = stats.reduce((n, s) => n + s.ms, 0);
  return {
    a,
    b,
    runs,
    seedStart: seed,
    unfinished: runs - finished.length,
    winRateA: pct(winsA, runs),
    winRateB: pct(winsB, runs),
    avgDurationS: durations.reduce((n, d) => n + d, 0) / Math.max(1, durations.length),
    p50DurationS: quantile(durations, 0.5),
    p90DurationS: quantile(durations, 0.9),
    decidedBeforeTimeLimit: pct(finished.filter((s) => !s.hadDuel).length, runs),
    duelFrequency: pct(duels.length, runs),
    duelWonByTroopLeader: pct(leaderWonDuel, duels.length),
    avgLossesA: finished.reduce((n, s) => n + s.lossesA, 0) / Math.max(1, finished.length),
    avgLossesB: finished.reduce((n, s) => n + s.lossesB, 0) / Math.max(1, finished.length),
    avgWinnerGeneralHp: finished.reduce((n, s) => n + s.winnerHpFrac, 0) / Math.max(1, finished.length),
    endReasons: reasons,
    avgStepMs: ms / Math.max(1, ticks),
    wallMs: ms,
  };
}

const p = (x: number) => `${(x * 100).toFixed(1)}%`;

function printSummary(r: ReturnType<typeof summarize>): void {
  console.log(`${r.a} (A) vs ${r.b} (B) — ${r.runs} runs, seeds ${r.seedStart}..${r.seedStart + r.runs - 1}`);
  console.log(`  Win rate          A ${p(r.winRateA)}   B ${p(r.winRateB)}${r.unfinished ? `   unfinished ${r.unfinished}` : ''}`);
  console.log(`  Fight duration    avg ${r.avgDurationS.toFixed(1)}s   p50 ${r.p50DurationS.toFixed(1)}s   p90 ${r.p90DurationS.toFixed(1)}s`);
  console.log(`  Decided in fight  ${p(r.decidedBeforeTimeLimit)}   duel ${p(r.duelFrequency)} (troop leader won ${p(r.duelWonByTroopLeader)} of duels)`);
  console.log(`  Avg losses        A ${r.avgLossesA.toFixed(1)}   B ${r.avgLossesB.toFixed(1)}   winner general HP left ${p(r.avgWinnerGeneralHp)}`);
  console.log(`  End reasons       ${JSON.stringify(r.endReasons)}`);
  console.log(`  Perf              ${r.avgStepMs.toFixed(4)} ms/tick, ${(r.wallMs / 1000).toFixed(1)} s wall`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const base = getGameData();
  const data = Object.keys(args.set).length ? withConstants(base, args.set) : base;
  if (args.list) {
    for (const l of base.aiLoadouts) console.log(`${l.id.padEnd(18)} ${l.generalId.padEnd(8)} ${l.formation.padEnd(6)} ${l.test ? '(test)' : ''}`);
    return;
  }
  if (Object.keys(args.set).length && !args.json) console.log(`Constant overrides: ${JSON.stringify(args.set)}`);

  if (args.matrix) {
    const ids = base.aiLoadouts.filter((l) => !l.test).map((l) => l.id);
    const rows: ReturnType<typeof summarize>[] = [];
    for (const a of ids) for (const b of ids) if (a !== b) rows.push(summarize(data, a, b, args.runs, args.seed));
    if (args.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    const w = Math.max(...ids.map((i) => i.length)) + 2;
    console.log(`Win rate of row (side A) vs column (side B), ${args.runs} runs each:`);
    console.log(''.padEnd(w) + ids.map((i) => i.slice(0, 12).padStart(14)).join(''));
    for (const a of ids) {
      const cells = ids.map((b) => (a === b ? '—' : p(rows.find((r) => r.a === a && r.b === b)!.winRateA)).padStart(14));
      console.log(a.padEnd(w) + cells.join(''));
    }
    const duel = rows.reduce((n, r) => n + r.duelFrequency, 0) / rows.length;
    const dur = rows.reduce((n, r) => n + r.avgDurationS, 0) / rows.length;
    console.log(`Overall: duel frequency ${p(duel)}, avg fight duration ${dur.toFixed(1)}s`);
    return;
  }

  const r = summarize(data, args.a, args.b, args.runs, args.seed);
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else printSummary(r);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
