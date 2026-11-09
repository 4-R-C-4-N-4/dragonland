import { freshTroops } from './engine';
import { maxMpOf } from './mp';
import { musterOf } from './muster';
import { internal } from './rng';
import type { Division, War } from './types';

export function applyRest(war: War, division: Division): void {
  const node = war.nodes.find(n => n.id === division.atNode);
  if (!node || node.owner !== division.factionId || (node.kind !== 'castle' && node.kind !== 'town')) return;
  const state = internal(war);
  const faction = war.factions.find(f => f.id === division.factionId)!;
  const members = division.generals.map(id => war.generals.find(g => g.id === id)!);
  for (const g of members) {
    const healed = Math.min(g.maxHp - g.hp, g.maxHp * state.data.constants.HEAL_HP_PER_REST_FRAC);
    if (healed > 0) { g.hp += healed; war.events.push({ type: 'healed', general: g.id, hp: healed }); }
    g.mp = maxMpOf(g);
  }
  // Refill the division's losses up to its muster, within the node's weekly stock, the per-rest
  // limit and each general's command. Troops are pooled, so who holds them does not matter.
  const held = members.reduce((n, g) => n + g.troops.length, 0);
  let budget = Math.max(0, Math.min(musterOf(war, division) - held, state.data.constants.RESUPPLY_TROOPS_PER_REST, state.supply[node.id] ?? 0));
  for (const g of members) {
    const count = Math.min(budget, Math.max(0, g.capacity - g.troops.length));
    if (count <= 0) continue;
    g.troops.push(...freshTroops(war, faction.classes, count));
    state.supply[node.id] = (state.supply[node.id] ?? 0) - count;
    budget -= count;
    war.events.push({ type: 'resupplied', general: g.id, troops: count });
  }
}
export function applyUpkeep(war: War): void {
  for (const faction of war.factions) faction.gold += war.nodes.filter(n => n.owner === faction.id).reduce((sum, n) => sum + n.incomePerTurn, 0);
  for (const g of war.generals) g.injuredTurns = Math.max(0, g.injuredTurns - 1);
}
export function resetWeeklySupply(war: War): void {
  internal(war).supply = Object.fromEntries(war.nodes.map(n => [n.id, n.supplyPerWeek]));
}
