// Finite roguelike run (MVP2). Pure, deterministic functions over a persisted RunState.
// Never reads wall time or Math.random; every random choice derives from (run seed, depth, index).
import type { ClassId, Disposition, GameData, GeneralId, UnitDef } from '../data';
import { uniqueName } from '../data/names';
import {
  awardHeroXp, awardTroopXp, chooseHeroUpgrade as progressionUpgrade, deriveHeroDef, deriveTroopStats,
  getProgressionConfig, pendingMilestones, type HeroProgress, type HeroUpgradeKind, type ProgressTroop, type UnitById,
} from '../progression';
import { createRng, nextFloat, nextInt, pick, type Rng } from '../sim/rng';
import type { BattleResult, SideSetup, SquadSetup, TroopSetup } from '../sim/types';
import { getRunConfig, type RunConfig } from './config';
import type { BattleSummary, Encounter, RecruitOffer, RunState } from './schema';

export interface NewRunOptions {
  seed: number;
  generalId: GeneralId;
  color?: string;
}

export interface PlayerSquad {
  name: string;
  disposition: Disposition;
  troopIds: string[];
  color?: string;
}

export interface PlayerArmy {
  formationId: string;
  squads: PlayerSquad[];
}

export type RunBattleOutcome = Pick<BattleResult, 'winner' | 'dead' | 'survivors'>;

const SALT = { roster: 0x52a1, encounter: 0xe7c0, recruit: 0x4ec1, battle: 0xba77, wounded: 0x3d11 } as const;

/** FNV-style mix of integers into a 32-bit seed. */
export function mixSeed(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) h = Math.imul(h ^ (p >>> 0), 16777619) >>> 0;
  return h >>> 0;
}

const unitRecord = (data: GameData): UnitById => Object.fromEntries(data.unitById) as UnitById;

function stage1Of(data: GameData, classId?: ClassId): UnitDef[] {
  return data.units.filter((u) => u.stage === 1 && (!classId || u.classId === classId));
}

/** The class a general leads with: general's unit -> that unit's class (D24). */
function heroClassOf(data: GameData, generalId: GeneralId): ClassId {
  const g = data.generalById.get(generalId);
  if (!g) throw new Error(`unknown general ${generalId}`);
  const unit = data.unitById.get(g.unitId);
  if (!unit) throw new Error(`general ${generalId} has unknown unit ${g.unitId}`);
  return unit.classId;
}

function evolveTo(data: GameData, unit: UnitDef, stage: number): UnitDef {
  let u = unit;
  while (u.stage < stage) {
    const next = u.evolvesTo ? data.unitById.get(u.evolvesTo) : undefined;
    if (!next) throw new Error(`unit ${u.id} has no stage ${u.stage + 1}`);
    u = next;
  }
  return u;
}

function requirePhase(state: RunState, ...phases: RunState['phase'][]): void {
  if (!phases.includes(state.phase)) throw new Error(`run is in phase '${state.phase}', expected ${phases.join(' or ')}`);
}

// ---------------------------------------------------------------- new run

export function newRun(data: GameData, opts: NewRunOptions, cfg: RunConfig = getRunConfig()): RunState {
  if (!data.generalById.has(opts.generalId)) throw new Error(`unknown general ${opts.generalId}`);
  const heroClass = heroClassOf(data, opts.generalId);
  const partnerClass = cfg.startingPartners[heroClass];
  if (!partnerClass) throw new Error(`class ${heroClass} has no configured starting partner`);
  const seed = opts.seed >>> 0;
  const rng = createRng(mixSeed(seed, SALT.roster));
  const taken = new Set<string>();
  const roster: ProgressTroop[] = [];
  for (const classId of [heroClass, partnerClass]) {
    const lines = stage1Of(data, classId).sort((a, b) => a.line.localeCompare(b.line));
    if (lines.length !== 3) throw new Error(`class ${classId} needs three stage-1 lines, has ${lines.length}`);
    for (const unit of lines) {
      for (let i = 0; i < cfg.startingTroopsPerLine; i++) {
        roster.push({ id: `t${roster.length}-${seed.toString(36)}`, name: uniqueName(rng, data.names, taken), unitId: unit.id, xp: 0, level: 1 });
      }
    }
  }
  const hero: HeroProgress = { generalId: opts.generalId, xp: 0, level: 1, upgrades: { vitality: 0, might: 0, mastery: 0 }, claimedMilestones: [] };
  const unlockedClasses: ClassId[] = [heroClass, partnerClass];
  return {
    version: 2,
    id: `run-${seed.toString(36)}`,
    seed,
    phase: 'select',
    depth: 0,
    unlockedClasses,
    color: opts.color ?? cfg.defaultTeamColor,
    hero,
    pendingMilestones: [],
    roster,
    offers: encounterOffers(data, seed, 0, cfg, unlockedClasses),
    encounter: null,
    battle: null,
    recruitOffers: [],
    lastSummary: null,
    processedBattleIds: [],
    battleCounter: 0,
  };
}

// ---------------------------------------------------------------- encounters

function encounterOffers(data: GameData, seed: number, depth: number, cfg: RunConfig, unlockedClasses: ClassId[]): Encounter[] {
  const boss = depth === cfg.battles - 1;
  const offers: Encounter[] = [];
  for (let i = 0; i < cfg.encounterOfferCount; i++) {
    // Offers should be real alternatives: re-roll (deterministically) a general already on offer.
    let e = generateEncounter(data, seed, depth, i, boss, cfg, unlockedClasses);
    for (let k = 1; k < 10 && offers.some((o) => o.side.generalId === e.side.generalId); k++) {
      e = { ...generateEncounter(data, seed, depth, i + 100 * k, boss, cfg, unlockedClasses), id: `enc-${depth}-${i}` };
    }
    offers.push(e);
  }
  return offers;
}

type Doctrine = NonNullable<Encounter['doctrine']>;
const DOCTRINES: Doctrine[] = ['balanced', 'assault', 'defensive', 'skirmish'];
const SQUAD_NAMES: Record<Disposition, string> = { fierce: 'Raiders', mixed: 'Host', guard: 'Wardens' };

/**
 * How many Fierce / Guard squads a doctrine fields out of k (D23). The rest are Mixed.
 * balanced: one Guard, plus one Fierce with 4 squads; assault: Fierce-heavy with one Mixed anchor;
 * defensive: half Guard; skirmish: all Mixed.
 */
function doctrineCounts(doctrine: Doctrine, k: number): { fierce: number; guard: number } {
  switch (doctrine) {
    case 'balanced': return { fierce: k >= 4 ? 1 : 0, guard: 1 };
    case 'assault': return { fierce: Math.max(1, k - 1), guard: 0 };
    case 'defensive': return { fierce: 0, guard: Math.ceil(k / 2) };
    case 'skirmish': return { fierce: 0, guard: 0 };
  }
}

/** Assign dispositions by squad content: Fierce to the fastest squads (they flank), Guard to the toughest. */
function assignDispositions(data: GameData, squads: SquadSetup[], doctrine: Doctrine): void {
  const { fierce, guard } = doctrineCounts(doctrine, squads.length);
  const mean = (q: SquadSetup, f: (u: UnitDef) => number) => q.troops.reduce((n, t) => n + f(data.unitById.get(t.unitId)!), 0) / q.troops.length;
  const speed = (q: SquadSetup) => mean(q, (u) => u.moveSpeed);
  const toughness = (q: SquadSetup) => mean(q, (u) => (u.line === 'Z' ? 2 : u.line === 'M' ? 1 : 0) + u.stage * 0.1);
  const order = squads.map((_, i) => i);
  const byFast = [...order].sort((a, b) => speed(squads[b]!) - speed(squads[a]!) || a - b);
  const fierceIdx = new Set(byFast.slice(0, fierce));
  const byTough = order.filter((i) => !fierceIdx.has(i)).sort((a, b) => toughness(squads[b]!) - toughness(squads[a]!) || a - b);
  const guardIdx = new Set(byTough.slice(0, guard));
  squads.forEach((q, i) => {
    q.disposition = fierceIdx.has(i) ? 'fierce' : guardIdx.has(i) ? 'guard' : 'mixed';
    q.name = `${SQUAD_NAMES[q.disposition]} ${i + 1}`;
  });
}

function enemyLevel(stage: number, depth: number, rng: Rng): number {
  const bump = Math.min(2, Math.floor(depth / 3)) + (nextFloat(rng) < 0.5 ? 0 : 1);
  if (stage === 1) return Math.min(2, 1 + bump);
  if (stage === 2) return Math.min(5, 3 + bump);
  return Math.min(12, 6 + bump + Math.max(0, depth - 6));
}

/**
 * Deterministic enemy for (seed, depth, index). Depends only on run seed and depth, never on the
 * player's army, so committing first stays honest.
 */
export function generateEncounter(
  data: GameData, seed: number, depth: number, index: number, boss: boolean, cfg: RunConfig = getRunConfig(),
  unlockedClasses?: ClassId[],
): Encounter {
  const rng = createRng(mixSeed(seed, SALT.encounter, depth, index));
  const total = Math.min(cfg.enemyMaxTroops, cfg.enemyStartingTroops + cfg.enemyTroopsPerDepth * depth);
  const classPool = [...cfg.startingClasses];
  const nClasses = Math.min(classPool.length, depth >= 4 ? 3 : 2);
  const classes: ClassId[] = [];
  while (classes.length < nClasses) classes.push(classPool.splice(nextInt(rng, classPool.length), 1)[0]!);

  const n3 = depth >= cfg.enemyStage3Depth ? Math.max(1, Math.round(total * cfg.enemyStage3Share)) : 0;
  const n2 = depth >= cfg.enemyStage2Depth ? Math.round(total * cfg.enemyStage2Share) : 0;
  const squadCount = Math.min(data.constants.MAX_SQUADS, Math.max(2, Math.ceil(total / 25)));
  // Offer 0 nudges toward a general whose class is still locked, so unlocking stays reachable.
  const locked = unlockedClasses ? data.generals.filter((g) => !unlockedClasses.includes(data.unitById.get(g.unitId)!.classId)) : [];
  const generalPool = index === 0 && locked.length > 0 ? locked : data.generals;
  const generalId = pick(rng, generalPool).id;
  const generalClass = data.unitById.get(data.generalById.get(generalId)!.unitId)!.classId;
  if (!classes.includes(generalClass)) {
    if (classes.length >= nClasses) classes[0] = generalClass;
    else classes.push(generalClass);
  }
  const taken = new Set<string>();
  const troops: { unit: UnitDef; level: number }[] = [];
  for (let i = 0; i < total; i++) {
    const classId = classes[i % classes.length]!;
    const base = pick(rng, stage1Of(data, classId));
    const stage = i < n3 ? 3 : i < n3 + n2 ? 2 : 1;
    troops.push({ unit: evolveTo(data, base, stage), level: enemyLevel(stage, depth, rng) });
  }
  // Group by line so squads read as roles; then split evenly across squads.
  troops.sort((a, b) => a.unit.line.localeCompare(b.unit.line) || a.unit.id.localeCompare(b.unit.id));
  const squads: SquadSetup[] = [];
  for (let s = 0; s < squadCount; s++) {
    const from = Math.floor((s * total) / squadCount);
    const to = Math.floor(((s + 1) * total) / squadCount);
    const members: TroopSetup[] = troops.slice(from, to).map((t, k) => ({
      troopId: `enemy-${depth}-${index}-${from + k}`,
      name: uniqueName(rng, data.names, taken),
      unitId: t.unit.id,
      statMult: deriveTroopStats(t.unit, t.level).damageMultiplier,
    }));
    squads.push({ id: `enemy-${depth}-${index}-sq${s}`, name: `Company ${s + 1}`, disposition: 'mixed', troops: members });
  }
  const doctrine = pick(rng, DOCTRINES);
  assignDispositions(data, squads, doctrine);
  const baseGeneral = data.generalById.get(generalId)!;
  const growth = (1 + cfg.enemyGeneralGrowthPerDepth * depth) * (boss ? cfg.bossGeneralMultiplier : 1);
  const general = { ...baseGeneral, level: 1 + depth, hp: baseGeneral.hp * growth, attack: baseGeneral.attack * growth };
  const classNames = classes.map((c) => data.classById.get(c)!.name).join('/');
  return {
    id: `enc-${depth}-${index}`,
    depth,
    boss,
    name: `${boss ? 'Warlord ' : ''}${baseGeneral.name}'s ${classNames} host`,
    doctrine,
    side: { generalId, formationId: pick(rng, data.formations).id, squads, general },
  };
}

export function chooseEncounter(state: RunState, encounterId: string): RunState {
  requirePhase(state, 'select');
  const encounter = state.offers.find((o) => o.id === encounterId);
  if (!encounter) throw new Error(`no encounter ${encounterId} on offer`);
  return { ...state, phase: 'prepare', encounter, offers: [] };
}

// ---------------------------------------------------------------- battle

export function buildPlayerSide(data: GameData, state: RunState, army: PlayerArmy): SideSetup {
  requirePhase(state, 'prepare');
  const c = data.constants;
  if (!data.formationById.has(army.formationId)) throw new Error(`unknown formation ${army.formationId}`);
  if (army.squads.length === 0 || army.squads.length > c.MAX_SQUADS) throw new Error(`need 1-${c.MAX_SQUADS} squads`);
  const byId = new Map(state.roster.map((t) => [t.id, t]));
  const used = new Set<string>();
  let total = 0;
  const squads: SquadSetup[] = army.squads.map((sq, i) => {
    if (sq.troopIds.length < c.MIN_SQUAD) throw new Error(`squad ${sq.name} needs at least ${c.MIN_SQUAD} troops`);
    total += sq.troopIds.length;
    const troops = sq.troopIds.map((id): TroopSetup => {
      const t = byId.get(id);
      if (!t) throw new Error(`troop ${id} is not in the run roster`);
      if (used.has(id)) throw new Error(`troop ${t.name} is deployed twice`);
      used.add(id);
      const unit = data.unitById.get(t.unitId);
      if (!unit) throw new Error(`troop ${t.name} has unknown unit ${t.unitId}`);
      return { troopId: t.id, name: t.name, unitId: t.unitId, statMult: deriveTroopStats(unit, t.level).damageMultiplier };
    });
    return { id: `sq${i}`, name: sq.name, disposition: sq.disposition, troops, ...(sq.color ? { color: sq.color } : {}) };
  });
  if (total > c.MAX_COMPANY) throw new Error(`company of ${total} exceeds ${c.MAX_COMPANY}`);
  const base = data.generalById.get(state.hero.generalId)!;
  return { generalId: state.hero.generalId, formationId: army.formationId, squads, general: deriveHeroDef(base, state.hero), color: state.color };
}

/** Freeze the exact battle (both sides + seed). Re-entering a saved run restarts this same setup. */
export function startBattle(data: GameData, state: RunState, army: PlayerArmy): RunState {
  const player = buildPlayerSide(data, state, army);
  const enemy = state.encounter!.side;
  const id = `${state.id}-b${state.battleCounter}`;
  const seed = mixSeed(state.seed, SALT.battle, state.battleCounter);
  return { ...state, phase: 'battle', battle: { id, setup: { seed, sides: [player, enemy] } }, battleCounter: state.battleCounter + 1 };
}

/** Apply a finished battle exactly once (repeat calls with the same id return the state unchanged). */
export function applyBattleResult(data: GameData, state: RunState, battleId: string, outcome: RunBattleOutcome, cfg: RunConfig = getRunConfig()): RunState {
  if (state.processedBattleIds.includes(battleId)) return state;
  requirePhase(state, 'battle');
  if (!state.battle || state.battle.id !== battleId) throw new Error(`battle ${battleId} is not the active battle`);
  const prog = getProgressionConfig();
  const deployed = new Set(state.battle.setup.sides[0].squads.flatMap((q) => q.troops.map((t) => t.troopId)));
  const won = outcome.winner === 0;
  const fallen = state.roster.filter((t) => deployed.has(t.id) && outcome.dead[0].includes(t.id));
  const survivorIds = new Set(outcome.survivors[0]);
  const fallenIds = new Set(fallen.map((t) => t.id));
  const survived = state.roster.filter((t) => deployed.has(t.id) && survivorIds.has(t.id) && !fallenIds.has(t.id))
    .map(({ id, name, unitId }) => ({ id, name, unitId }));
  const benched = state.roster.filter((t) => !deployed.has(t.id)).length;
  // After a victory a seeded share of the fallen were only wounded: they rejoin as survivors.
  const recoveredIds = new Set<string>();
  if (won) {
    const rng = createRng(mixSeed(state.seed, SALT.wounded, state.battleCounter));
    const pool = [...fallen];
    const n = Math.round(fallen.length * cfg.woundedRecoveryOnWin);
    for (let i = 0; i < n; i++) recoveredIds.add(pool.splice(nextInt(rng, pool.length), 1)[0]!.id);
  }
  const dead = new Set(fallen.filter((t) => !recoveredIds.has(t.id)).map((t) => t.id));
  const deadTroops = state.roster.filter((t) => dead.has(t.id));
  const recovered = fallen.filter((t) => recoveredIds.has(t.id)).map(({ id, name, unitId }) => ({ id, name, unitId }));
  const roster0 = state.roster.filter((t) => !dead.has(t.id));
  const boss = state.encounter?.boss ?? false;
  const common = { battle: null, encounter: null, processedBattleIds: [...state.processedBattleIds, battleId] };

  if (!won) {
    const summary: BattleSummary = {
      battleId, won: false, boss, survived, benched, dead: deadTroops.map(({ id, name, unitId }) => ({ id, name, unitId })), recovered: [],
      xpAwarded: 0, levelUps: 0, evolutions: [], heroLevelFrom: state.hero.level, heroLevelTo: state.hero.level,
    };
    return { ...state, ...common, phase: 'lost', roster: roster0, lastSummary: summary, recruitOffers: [] };
  }

  const xp = boss ? prog.troop.xpPerBossVictory : prog.troop.xpPerVictory;
  const units = unitRecord(data);
  let levelUps = 0;
  const evolutions: BattleSummary['evolutions'] = [];
  const roster = roster0.map((t) => {
    if (!deployed.has(t.id)) return t;
    const next = awardTroopXp(t, xp, units);
    levelUps += next.level - t.level;
    if (next.unitId !== t.unitId) evolutions.push({ troopId: t.id, name: t.name, from: t.unitId, to: next.unitId });
    return next;
  });
  const hero = awardHeroXp(state.hero, prog.hero.xpPerVictory);
  const depth = state.depth + 1;
  const finished = depth >= cfg.battles;
  const enemyGeneralClass = data.unitById.get(data.generalById.get(state.encounter!.side.generalId)!.unitId)!.classId;
  const unlockedClass = state.unlockedClasses.includes(enemyGeneralClass) ? undefined : enemyGeneralClass;
  const unlockedClasses = unlockedClass ? [...state.unlockedClasses, unlockedClass] : state.unlockedClasses;
  const summary: BattleSummary = {
    battleId, won: true, boss, survived, benched, dead: deadTroops.map(({ id, name, unitId }) => ({ id, name, unitId })), recovered,
    xpAwarded: xp, levelUps, evolutions, heroLevelFrom: state.hero.level, heroLevelTo: hero.level,
    ...(unlockedClass ? { unlockedClass } : {}),
  };
  return {
    ...state,
    ...common,
    phase: finished ? 'won' : 'rewards',
    depth,
    unlockedClasses,
    hero,
    pendingMilestones: pendingMilestones(hero),
    roster,
    lastSummary: summary,
    recruitOffers: finished ? [] : recruitOffers(data, state.seed, depth, roster, cfg, unlockedClasses),
  };
}

// ---------------------------------------------------------------- rewards

function recruitOffers(data: GameData, seed: number, depth: number, roster: ProgressTroop[], cfg: RunConfig, unlockedClasses: ClassId[]): RecruitOffer[] {
  const rng = createRng(mixSeed(seed, SALT.recruit, depth));
  const taken = new Set(roster.map((t) => t.name));
  const pool = stage1Of(data).filter((u) => unlockedClasses.includes(u.classId));
  const seen = new Set<string>();
  return Array.from({ length: cfg.recruitOfferCount }, (_, o) => {
    let types: UnitDef[] = [];
    // Offers should be real alternatives: reroll a type set already offered (bounded attempts).
    for (let attempt = 0; attempt < 20; attempt++) {
      const choices = [...pool];
      types = Array.from({ length: Math.min(3, choices.length) }, () => choices.splice(nextInt(rng, choices.length), 1)[0]!);
      const key = types.map((t) => t.id).sort().join();
      if (!seen.has(key)) {
        seen.add(key);
        break;
      }
    }
    const troops: ProgressTroop[] = [];
    for (let n = 0; n < cfg.recruitsPerOffer; n++) {
      const unit = types[n % types.length]!;
      troops.push({ id: `r${depth}-${o}-${n}-${seed.toString(36)}`, name: uniqueName(rng, data.names, taken), unitId: unit.id, xp: 0, level: 1 });
    }
    return { id: `recruit-${depth}-${o}`, troops };
  });
}

export function chooseHeroUpgrade(state: RunState, kind: HeroUpgradeKind): RunState {
  requirePhase(state, 'rewards', 'won');
  const hero = progressionUpgrade(state.hero, kind);
  return { ...state, hero, pendingMilestones: pendingMilestones(hero) };
}

/** Take one recruit offer (or null to skip) and move on to the next encounter choice. */
export function chooseRecruitOffer(data: GameData, state: RunState, offerId: string | null, cfg: RunConfig = getRunConfig()): RunState {
  requirePhase(state, 'rewards');
  if (state.pendingMilestones.length) throw new Error('choose a hero milestone upgrade first');
  let roster = state.roster;
  if (offerId !== null) {
    const offer = state.recruitOffers.find((o) => o.id === offerId);
    if (!offer) throw new Error(`no recruit offer ${offerId}`);
    if (roster.length + offer.troops.length > cfg.rosterCap) {
      throw new Error(`recruiting ${offer.troops.length} would exceed the roster cap of ${cfg.rosterCap}`);
    }
    roster = [...roster, ...offer.troops];
  }
  return { ...state, phase: 'select', roster, recruitOffers: [], offers: encounterOffers(data, state.seed, state.depth, cfg, state.unlockedClasses) };
}
