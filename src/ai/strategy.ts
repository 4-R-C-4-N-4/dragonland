// Deterministic, read-only overworld order policy. This plans only the current orders phase;
// the world engine remains responsible for validation and resolving movement/combat.
import { createRng, nextInt } from '../sim/rng';
import type { War, WorldNode, WorldOrder } from '../world/types';

/** Provisional policy cutoffs; tune against simulated campaigns before treating as balance. */
export const STRATEGY_TUNING = {
  injuredHpFraction: 0.6,
  depletedTroopFraction: 0.55,
  superiorEnemyRatio: 1.25,
  economicIncomeWeight: 0.25,
} as const;

function adjacent(war: War, nodeId: string): string[] {
  return war.routes.flatMap(route => route.from === nodeId ? [route.to] : route.to === nodeId ? [route.from] : []).sort();
}

/** Public ownership/topology visibility: owned and occupied nodes plus their direct neighbours. */
export function visibleNodes(war: War, factionId: string): Set<string> {
  const visible = new Set<string>();
  for (const node of war.nodes) {
    const occupied = war.divisions.some(d => d.factionId === factionId && d.generals.length > 0 && d.atNode === node.id);
    if (node.owner !== factionId && !occupied) continue;
    visible.add(node.id);
    for (const id of adjacent(war, node.id)) visible.add(id);
  }
  return visible;
}

function shortestFirstSteps(war: War, start: string, goals: ReadonlySet<string>): Map<string, number> {
  const distance = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (const next of adjacent(war, at)) {
      if (distance.has(next)) continue;
      distance.set(next, distance.get(at)! + 1);
      queue.push(next);
    }
  }
  return new Map([...goals].flatMap(goal => distance.has(goal) ? [[goal, distance.get(goal)!] as [string, number]] : []));
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function choose<T extends { id: string }>(war: War, factionId: string, divisionId: string, candidates: T[]): T | undefined {
  if (!candidates.length) return undefined;
  const salt = hashText(`${factionId}:${divisionId}`);
  const rng = createRng((war.seed ^ Math.imul(war.turn, 0x9e3779b9) ^ salt) >>> 0);
  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))[nextInt(rng, candidates.length)];
}

function divisionStrength(war: War, divisionId: string): number {
  const division = war.divisions.find(d => d.id === divisionId);
  if (!division) return 0;
  return division.generals.reduce((sum, id) => {
    const general = war.generals.find(g => g.id === id);
    return sum + (general ? general.troops.length + general.maxHp * general.hp / Math.max(1, general.maxHp) : 0);
  }, 0);
}

function nearestSupply(war: War, factionId: string, divisionId: string, from: string): { id: string; distance: number } | undefined {
  const supplies = new Set(war.nodes.filter(n => n.owner === factionId && n.supplyPerWeek > 0).map(n => n.id));
  const distances = shortestFirstSteps(war, from, supplies);
  const bestDistance = Math.min(...distances.values());
  if (!Number.isFinite(bestDistance)) return undefined;
  const candidates = [...distances].filter(([, d]) => d === bestDistance).map(([id, distance]) => ({ id, distance }));
  return choose(war, factionId, divisionId, candidates);
}

function firstStep(war: War, from: string, goal: string, factionId: string, divisionId: string): string | undefined {
  if (from === goal) return undefined;
  const distances = new Map<string, number>([[goal, 0]]);
  const queue = [goal];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (const next of adjacent(war, at)) {
      if (distances.has(next)) continue;
      distances.set(next, distances.get(at)! + 1);
      queue.push(next);
    }
  }
  const distance = distances.get(from);
  if (distance === undefined || distance === 0) return undefined;
  const steps = adjacent(war, from).filter(id => distances.get(id) === distance - 1).map(id => ({ id }));
  return choose(war, factionId, divisionId, steps)?.id;
}

function economicObjectives(war: War, factionId: string, from: string): WorldNode[] {
  const visible = visibleNodes(war, factionId);
  const visibleEnemyAt = new Set(war.divisions.filter(d => d.factionId !== factionId && visible.has(d.atNode)).map(d => d.atNode));
  const distances = shortestFirstSteps(war, from, new Set(war.nodes.filter(n => visible.has(n.id) && n.owner !== factionId && n.incomePerTurn > 0 && !visibleEnemyAt.has(n.id)).map(n => n.id)));
  return war.nodes.filter(n => distances.has(n.id)).sort((a, b) => {
    const scoreA = distances.get(a.id)! - a.incomePerTurn * STRATEGY_TUNING.economicIncomeWeight;
    const scoreB = distances.get(b.id)! - b.incomePerTurn * STRATEGY_TUNING.economicIncomeWeight;
    return scoreA - scoreB || a.id.localeCompare(b.id);
  });
}

function objective(war: War, factionId: string, divisionId: string, from: string): string | undefined {
  const faction = war.factions.find(f => f.id === factionId);
  if (!faction) return undefined;
  if (faction.personality === 'defensive') {
    const visible = visibleNodes(war, factionId);
    const threatened = war.nodes.filter(n => n.owner === factionId && n.kind === 'castle' && adjacent(war, n.id).concat(n.id).some(id =>
      visible.has(id) && war.divisions.some(d => d.factionId !== factionId && d.atNode === id && d.generals.length > 0),
    ));
    if (threatened.length) return choose(war, factionId, divisionId, threatened)?.id;
  }
  if (faction.personality === 'opportunist') {
    const economy = economicObjectives(war, factionId, from);
    if (economy.length) {
      const distances = shortestFirstSteps(war, from, new Set(economy.map(n => n.id)));
      const score = (node: WorldNode) => distances.get(node.id)! - node.incomePerTurn * STRATEGY_TUNING.economicIncomeWeight;
      const best = Math.min(...economy.map(score));
      return choose(war, factionId, divisionId, economy.filter(n => score(n) === best))?.id;
    }
  }
  const hostileCastles = war.nodes.filter(n => n.kind === 'castle' && n.owner !== null && n.owner !== factionId);
  const distances = shortestFirstSteps(war, from, new Set(hostileCastles.map(n => n.id)));
  const reachable = hostileCastles.filter(n => distances.has(n.id));
  if (!reachable.length) return undefined;
  const shortest = Math.min(...reachable.map(n => distances.get(n.id)!));
  return choose(war, factionId, divisionId, reachable.filter(n => distances.get(n.id) === shortest))?.id;
}

function orderFor(war: War, factionId: string, division: War['divisions'][number]): WorldOrder {
  const generals = war.generals.filter(g => division.generals.includes(g.id));
  const hp = generals.reduce((sum, g) => sum + g.hp, 0);
  const maxHp = generals.reduce((sum, g) => sum + g.maxHp, 0);
  const troops = generals.reduce((sum, g) => sum + g.troops.length, 0);
  const capacity = generals.reduce((sum, g) => sum + g.capacity, 0);
  const needsRest = (maxHp > 0 && hp / maxHp < STRATEGY_TUNING.injuredHpFraction) || (capacity > 0 && troops / capacity < STRATEGY_TUNING.depletedTroopFraction);
  const injured = maxHp > 0 && hp / maxHp < STRATEGY_TUNING.injuredHpFraction;
  const depleted = capacity > 0 && troops / capacity < STRATEGY_TUNING.depletedTroopFraction;
  const friendlySupply = war.nodes.some(n => n.id === division.atNode && n.owner === factionId && (n.kind === 'castle' || n.kind === 'town'));
  const weeklySupply = (war._internal as { supply?: Record<string, number> } | undefined)?.supply?.[division.atNode] ?? 0;
  const canRest = injured || (depleted && weeklySupply > 0);
  if (needsRest && friendlySupply && canRest) return { type: 'rest', division: division.id };
  if (needsRest) {
    const supply = nearestSupply(war, factionId, division.id, division.atNode);
    if (supply && supply.id !== division.atNode) {
      const step = firstStep(war, division.atNode, supply.id, factionId, division.id);
      if (step) return { type: 'march', division: division.id, toNode: step };
    }
  }

  const target = objective(war, factionId, division.id, division.atNode);
  if (target && target !== division.atNode) {
    let step = firstStep(war, division.atNode, target, factionId, division.id);
    if (step) {
      const faction = war.factions.find(f => f.id === factionId);
      if (faction?.personality === 'opportunist') {
        const visible = visibleNodes(war, factionId);
        const enemies = visible.has(step) ? war.divisions.filter(d => d.factionId !== factionId && d.atNode === step) : [];
        const ownStrength = divisionStrength(war, division.id);
        const strongestEnemy = Math.max(0, ...enemies.map(enemy => divisionStrength(war, enemy.id)));
        if (strongestEnemy > ownStrength * STRATEGY_TUNING.superiorEnemyRatio) step = undefined;
      }
      if (step) return { type: 'march', division: division.id, toNode: step };
    }
  }
  // Defensive factions without an immediate castle threat consolidate at the nearest supply site.
  const faction = war.factions.find(f => f.id === factionId);
  if (faction?.personality === 'defensive') {
    const supply = nearestSupply(war, factionId, division.id, division.atNode);
    if (supply && supply.id !== division.atNode) {
      const step = firstStep(war, division.atNode, supply.id, factionId, division.id);
      if (step) return { type: 'march', division: division.id, toNode: step };
    }
  }
  return { type: 'hold', division: division.id };
}

/** Plan one current-turn action per nonempty division. This function never mutates `war`. */
export function planFactionOrders(war: War, factionId: string): WorldOrder[] {
  if (war.phase !== 'orders') return [];
  return war.divisions.filter(d => d.factionId === factionId && d.generals.length > 0)
    .slice().sort((a, b) => a.id.localeCompare(b.id))
    .map(division => orderFor(war, factionId, division));
}
