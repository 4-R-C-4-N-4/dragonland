// Controlled special comparisons, not a claim of equal campaign win rates.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildGameData, getGameData, rawGameData, type GameData, type GeneralId } from '../src/data';
import { createAiController } from '../src/ai/policy';
import { createBattle, step, type Side, type SideSetup } from '../src/sim';

export const specialFamilies: Record<string, GeneralId[]> = {
  healing: ['paladin', 'hierophant', 'shepherd'],
  buffs: ['warg', 'anima'],
  waves: ['dragon', 'diabolist', 'archangel'],
  targeted: ['deadeye', 'assassin', 'eagle'],
  field: ['archmage', 'devil', 'servitor', 'kyilkhor'],
};

/** Equal troop count, species, tiers, formation, roles and (optionally) hero profile. */
export function balanceSide(data: GameData, id: GeneralId, side: Side, native: boolean): SideSetup {
  const selected = data.generalById.get(id)!;
  const base = native ? selected : data.generalById.get('assassin')!;
  const units = data.units.filter(u => u.stage === 1).sort((a, b) => a.id.localeCompare(b.id));
  if (units.length !== 15) throw new Error('balance fixture expects five classes / three stage-1 lines');
  return {
    generalId: base.id, general: { ...base, special: selected.special }, formationId: 'line',
    squads: Array.from({ length: 4 }, (_, slot) => ({
      id: `s${side}-${slot}`, name: `Mixed ${slot}`, disposition: 'mixed',
      troops: units.map((u, k) => ({ troopId: `s${side}-${slot}-${k}`, name: u.name, unitId: u.id })),
    })),
  };
}

export function matchups(ids: GeneralId[], scope: 'all' | 'peers'): [GeneralId, GeneralId][] {
  const group = (id: GeneralId) => Object.keys(specialFamilies).find(k => specialFamilies[k]!.includes(id));
  const out: [GeneralId, GeneralId][] = [];
  for (const a of ids) for (const b of ids) if (scope === 'all' || group(a) === group(b)) out.push([a, b]);
  return out;
}

export function runMatch(data: GameData, a: GeneralId, b: GeneralId, seed: number, native: boolean, limit?: number) {
  const world = createBattle(data, { seed, sides: [balanceSide(data, a, 0, native), balanceSide(data, b, 1, native)] });
  const ai = [createAiController(data, 0), createAiController(data, 1)];
  const casts = [0, 0], firstCastS: (number | null)[] = [null, null];
  let firstHitS: number | null = null;
  let combatTimeS = 0;
  const maxTicks = limit ?? Math.ceil((data.constants.SKIRMISH_TIME_S + data.constants.DEPLOY_COUNTDOWN_S + data.constants.DUEL_MAX_ROUNDS * data.constants.DUEL_CADENCE_S + 5) * data.constants.SIM_HZ);
  for (let tick = 0; !world.result && tick < maxTicks; tick++) {
    if (world.phase === 'fight' || world.phase === 'duel') combatTimeS += 1 / data.constants.SIM_HZ;
    ai[0]!.update(world); ai[1]!.update(world); step(world);
    for (const e of world.events) {
      if (e.type === 'hit' && firstHitS === null) firstHitS = combatTimeS;
      if (e.type === 'special') {
        casts[e.side]!++;
        firstCastS[e.side] ??= combatTimeS;
      }
    }
  }
  if (!world.result) throw new Error(`unfinished ${a}/${b} seed ${seed}`);
  return { a, b, seed, winner: world.result.winner, durationS: combatTimeS, fightDurationS: world.result.durationS, duelDurationS: Math.max(0, combatTimeS - world.result.durationS), reason: world.result.reason,
    hadDuel: world.result.hadDuel, timeout: world.fightTimeS + 1e-6 >= data.constants.SKIRMISH_TIME_S,
    losses: world.result.dead.map(t => t.length), casts, firstCastS, firstHitS };
}

function main(args: string[]): void {
  const opts = { seeds: 4, seed: 701, scope: 'peers' as 'all' | 'peers', native: false, out: '', generals: '' };
  for (let i = 0; i < args.length; i += 2) {
    const v = args[i + 1];
    if (v === undefined) throw new Error(`missing value ${args[i]}`);
    switch (args[i]) {
      case '--seeds': opts.seeds = Number(v); break;
      case '--seed': opts.seed = Number(v); break;
      case '--scope': if (v !== 'all' && v !== 'peers') throw new Error('scope all|peers'); opts.scope = v; break;
      case '--profiles': if (!['native', 'normalized'].includes(v)) throw new Error('profiles native|normalized'); opts.native = v === 'native'; break;
      case '--out': opts.out = v; break;
      case '--generals': opts.generals = v; break;
      default: throw new Error(`unknown option ${args[i]}`);
    }
  }
  if (!Number.isSafeInteger(opts.seeds) || opts.seeds < 1 || !Number.isSafeInteger(opts.seed) || opts.seed < 0 || !Number.isSafeInteger(opts.seed + opts.seeds - 1)) throw new Error('invalid seed ensemble');
  if (!opts.out) throw new Error('--out required');
  const data = opts.generals ? buildGameData({ ...rawGameData, generals: JSON.parse(readFileSync(opts.generals, 'utf8')) }) : getGameData();
  const ids = data.generals.map(g => g.id);
  const pairs = matchups(ids, opts.scope);
  const rows: ReturnType<typeof runMatch>[] = [];
  for (const [a, b] of pairs) for (let n = 0; n < opts.seeds; n++) rows.push(runMatch(data, a, b, opts.seed + n, opts.native));
  if (rows.length !== pairs.length * opts.seeds || ids.length !== 15) throw new Error('incomplete collection');
  const summaries = ids.map(id => {
    const samples = rows.flatMap(r => r.a === id && r.b !== id ? [{ r, side: 0 }] : r.b === id && r.a !== id ? [{ r, side: 1 }] : []);
    const mean = (f: (s: typeof samples[number]) => number) => samples.reduce((v, s) => v + f(s), 0) / samples.length;
    return { id, samples: samples.length, wins: samples.filter(s => s.r.winner === s.side).length,
      winRate: mean(s => s.r.winner === s.side ? 1 : 0), meanDurationS: mean(s => s.r.durationS),
      meanCasts: mean(s => s.r.casts[s.side]!), timeouts: samples.filter(s => s.r.timeout).length };
  });
  const hashes = createHash('sha256');
  for (const dir of ['src/sim', 'src/ai']) for (const file of readdirSync(dir).filter(f => f.endsWith('.ts')).sort()) hashes.update(dir + '/' + file).update(readFileSync(dir + '/' + file));
  hashes.update(readFileSync('tools/specialBalance.ts'));
  const report = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceFingerprint: hashes.digest('hex'), contentFingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    options: opts, fixture: '60 stage-1 troops: all five classes and three lines, four identical mixed squads; same formation and both-side actual AI. Normalized mode fixes both general profiles to neutral-line Assassin (Human/M) and swaps ONLY specials. Native mode preserves general profiles. No campaign/evolution/economy inference.',
    families: specialFamilies, definitions: data.generals, battles: rows.length, unfinished: 0,
    timeouts: rows.filter(r => r.timeout).length, casts: rows.reduce((n, r) => n + r.casts[0]! + r.casts[1]!, 0),
    summaries, rows,
  };
  writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ battles: report.battles, unfinished: report.unfinished, timeouts: report.timeouts, casts: report.casts, summaries }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
