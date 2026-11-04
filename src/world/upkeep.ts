import { freshTroops } from './engine';
import { internal } from './rng';
import type { Division, War } from './types';

export function applyRest(war: War, division: Division): void {
  const node = war.nodes.find(n => n.id === division.atNode);
  if (!node || node.owner !== division.factionId || (node.kind !== 'castle' && node.kind !== 'town')) return;
  const state = internal(war);
  const faction = war.factions.find(f => f.id === division.factionId)!;
  for (const id of division.generals) {
    const g = war.generals.find(g => g.id === id)!;
    const healed = Math.min(g.maxHp - g.hp, g.maxHp * state.data.constants.HEAL_HP_PER_REST_FRAC);
    if (healed > 0) { g.hp += healed; war.events.push({ type: 'healed', general: g.id, hp: healed }); }
    const count = Math.max(0, Math.min(state.data.constants.RESUPPLY_TROOPS_PER_REST, g.capacity - g.troops.length, state.supply[node.id] ?? 0));
    if (count > 0) {
      g.troops.push(...freshTroops(war, faction.classes, count));
      state.supply[node.id] = (state.supply[node.id] ?? 0) - count;
      war.events.push({ type: 'resupplied', general: g.id, troops: count });
    }
  }
}
export function applyUpkeep(war: War): void {
  for (const faction of war.factions) faction.gold += war.nodes.filter(n => n.owner === faction.id).reduce((sum, n) => sum + n.incomePerTurn, 0);
  for (const g of war.generals) g.injuredTurns = Math.max(0, g.injuredTurns - 1);
}
export function resetWeeklySupply(war: War): void {
  internal(war).supply = Object.fromEntries(war.nodes.map(n => [n.id, n.supplyPerWeek]));
}
