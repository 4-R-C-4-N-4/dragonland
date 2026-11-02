// Reproducible release diagnostics: every hero, both AIs using specials, real mixed campaign armies.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getGameData, withConstants, type Approach, type GameData } from '../src/data';
import { createBattle, issueApproach, step, type BattleResult } from '../src/sim';
import { createAiController } from '../src/ai/policy';
import { applyBattleResult, chooseEncounter, chooseHeroUpgrade, chooseRecruitOffer, getRunConfig, newRun, startBattle, type RunState } from '../src/run';
import { autoPlan, classEdge, planToArmy } from '../src/ui/run/logic';

export interface DiagnosticOptions {
  runsPerHero: number;
  seed: number;
  fieldWidth: number;
  approach: Approach | 'default';
}

export function parseDiagnosticArgs(args: string[]): DiagnosticOptions {
  const out: DiagnosticOptions = { runsPerHero: 2, seed: 1, fieldWidth: getGameData().constants.FIELD_W, approach: 'default' };
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (value === undefined) throw new Error(`missing value for ${args[i]}`);
    switch (args[i]) {
      case '--runs-per-hero': out.runsPerHero = Number(value); break;
      case '--seed': out.seed = Number(value); break;
      case '--field-width': out.fieldWidth = Number(value); break;
      case '--approach':
        if (!['default', 'direct', 'farFlank', 'nearFlank'].includes(value)) throw new Error(`unknown approach ${value}`);
        out.approach = value as DiagnosticOptions['approach'];
        break;
      default: throw new Error(`unknown option ${args[i]}`);
    }
  }
  if (!Number.isSafeInteger(out.runsPerHero) || out.runsPerHero < 1) throw new Error('runs-per-hero must be a positive integer');
  if (!Number.isSafeInteger(out.seed) || out.seed < 0 || !Number.isSafeInteger(out.seed + out.runsPerHero - 1)) throw new Error('seed ensemble must contain safe nonnegative integers');
  if (!Number.isFinite(out.fieldWidth) || out.fieldWidth <= 0) throw new Error('field-width must be finite and positive');
  return out;
}

type End = Pick<BattleResult, 'durationS' | 'reason' | 'hadDuel'>;
export function summarizeBattles(battles: End[], timeLimitS: number) {
  const durations = battles.map((b) => b.durationS);
  return {
    battles: battles.length,
    generalDefeated: battles.filter((b) => b.reason === 'generalDefeated').length,
    duel: battles.filter((b) => b.hadDuel).length,
    timeouts: battles.filter((b) => b.durationS + 1e-6 >= timeLimitS).length,
    meanDurationS: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    minDurationS: durations.length ? Math.min(...durations) : null,
    maxDurationS: durations.length ? Math.max(...durations) : null,
  };
}

function edgeScore(data: GameData, s: RunState, enc: RunState['offers'][number]): number {
  const enemy = new Map<string, number>();
  for (const t of enc.side.squads.flatMap((sq) => sq.troops)) {
    const c = data.unitById.get(t.unitId)!.classId;
    enemy.set(c, (enemy.get(c) ?? 0) + 1);
  }
  return s.roster.reduce((total, t) => {
    const edge = classEdge(data, data.unitById.get(t.unitId)!.classId, enemy);
    return total + (edge === 'strong' ? 1 : edge === 'weak' ? -1 : 0);
  }, 0);
}

export interface DiagnosticBattle extends BattleResult {
  battleId: string;
  seed: number;
  firstHitS: number | null;
  specials: number[];
  playerApproaches: Approach[];
}
export interface DiagnosticCampaign {
  hero: RunState['hero']['generalId'];
  classId: GameData['units'][number]['classId'];
  seed: number;
  phase: RunState['phase'];
  victories: number;
  roster: number;
  blocked: string | null;
  battles: DiagnosticBattle[];
}

export function runReleaseDiagnostics(base: GameData, options: DiagnosticOptions) {
  const data = withConstants(base, { FIELD_W: options.fieldWidth });
  if (options.fieldWidth <= 2 * data.constants.GENERAL_START_INSET) throw new Error('field width leaves no space between general deployment points');
  const cfg = getRunConfig();
  const campaigns: DiagnosticCampaign[] = [];
  for (const general of data.generals) for (let repetition = 0; repetition < options.runsPerHero; repetition++) {
    // The same seed ensemble for every hero, rather than different hero-specific seeds.
    const seed = options.seed + repetition;
    let s = newRun(data, { seed, generalId: general.id }, cfg);
    const battles = [];
    let blocked: string | null = null;
    while (s.phase === 'select') {
      const best = [...s.offers].sort((a, b) => edgeScore(data, s, b) - edgeScore(data, s, a))[0]!;
      s = chooseEncounter(s, best.id);
      const plan = autoPlan(data, s.roster);
      const army = planToArmy(data, s.roster, plan);
      if (!army.squads.length) { blocked = 'no deployable troops'; break; }
      s = startBattle(data, s, army);
      const battleId = s.battle!.id;
      const w = createBattle(data, s.battle!.setup);
      if (options.approach !== 'default') issueApproach(w, 0, 'all', options.approach);
      const ais = [createAiController(data, 0), createAiController(data, 1)];
      const specials = [0, 0];
      let firstHitS: number | null = null;
      const maxTicks = data.constants.SIM_HZ * 60 * 8;
      for (let t = 0; t < maxTicks && !w.result; t++) {
        for (const ai of ais) ai.update(w);
        step(w);
        for (const event of w.events) {
          if (event.type === 'special') specials[event.side]!++;
          if (event.type === 'hit' && firstHitS === null) firstHitS = w.fightTimeS;
        }
      }
      if (!w.result) throw new Error(`${general.id} seed ${seed} depth ${s.depth}: battle exceeded safety tick limit`);
      battles.push({ ...w.result, battleId, seed: w.setup.seed, firstHitS, specials, playerApproaches: w.squads.filter((sq) => sq.side === 0).map((sq) => sq.approach) });
      s = applyBattleResult(data, s, battleId, w.result, cfg);
      while (s.pendingMilestones.length && (s.phase === 'rewards' || s.phase === 'won')) s = chooseHeroUpgrade(s, 'vitality');
      if (s.phase === 'rewards') {
        const fit = s.recruitOffers.find((o) => s.roster.length + o.troops.length <= cfg.rosterCap);
        s = chooseRecruitOffer(data, s, fit?.id ?? null, cfg);
      }
    }
    campaigns.push({ hero: general.id, classId: data.unitById.get(general.unitId)!.classId, seed, phase: s.phase, victories: s.depth, roster: s.roster.length, blocked, battles });
  }
  const allBattles = campaigns.flatMap((r) => r.battles);
  const perHero = data.generals.map((g) => {
    const rows = campaigns.filter((r) => r.hero === g.id);
    return { hero: g.id, runs: rows.length, won: rows.filter((r) => r.phase === 'won').length, meanVictories: rows.reduce((n, r) => n + r.victories, 0) / rows.length, ...summarizeBattles(rows.flatMap((r) => r.battles), data.constants.SKIRMISH_TIME_S) };
  });
  return {
    options, policy: { encounters: 'best roster class edge', deployment: 'autoPlan', recruitment: 'first affordable offer', milestones: 'vitality', playerAi: true, enemyAi: true },
    config: { constants: data.constants, behaviors: data.behaviors, run: cfg },
    contentFingerprint: createHash('sha256').update(JSON.stringify({ constants: data.constants, behaviors: data.behaviors, cfg, units: data.units, generals: data.generals })).digest('hex'),
    summary: { runs: campaigns.length, won: campaigns.filter((r) => r.phase === 'won').length, blocked: campaigns.filter((r) => r.blocked !== null).length, ...summarizeBattles(allBattles, data.constants.SKIRMISH_TIME_S) },
    perHero, campaigns,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) {
    console.log('npx tsx tools/releaseDiagnostics.ts [--runs-per-hero 2] [--seed 1] [--field-width 1600] [--approach default|direct|farFlank|nearFlank] > report.json');
  } else {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirtyInputs = execFileSync('git', ['status', '--porcelain', '--', 'src/sim', 'src/data', 'src/run', 'src/ai', 'src/ui/run/logic.ts', 'data'], { encoding: 'utf8' }).trim();
    if (dirtyInputs) throw new Error(`commit simulation inputs before running diagnostics:\n${dirtyInputs}`);
    console.log(JSON.stringify({ commit, ...runReleaseDiagnostics(getGameData(), parseDiagnosticArgs(process.argv.slice(2))) }, null, 2));
  }
}
