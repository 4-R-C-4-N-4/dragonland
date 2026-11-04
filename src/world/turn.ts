import { internal } from './rng';
import { detectEncounters } from './encounter';
import { applyRest, applyUpkeep, resetWeeklySupply } from './upkeep';
import { canMarch, moveDivisions, captureUndefended } from './movement';
import type { War, WorldOrder } from './types';

/** Resolve every division from the same pre-movement order/position snapshot. */
export function resolveTurn(war: War): void {
  if (war.phase !== 'orders' || war.pendingBattle) return;
  war.events = [];
  const state = internal(war);
  const divisions = [...war.divisions].sort((a, b) => a.id.localeCompare(b.id));
  const orders: WorldOrder[] = divisions.map(d => {
    const order = state.pending.find(o => o.division === d.id);
    return !order || (order.type === 'march' && !canMarch(war, d, order.toNode)) ? { type: 'hold', division: d.id } : { ...order };
  });
  const starts = moveDivisions(war, orders);
  captureUndefended(war, starts);
  if (detectEncounters(war, starts)) return;
  for (const order of orders) {
    const division = divisions.find(d => d.id === order.division)!;
    if (order.type === 'rest') applyRest(war, division);
    if (order.type === 'search') war.events.push({ type: 'searchedNothing', division: division.id, nodeId: division.atNode });
  }
  applyUpkeep(war);
  war.turnLog.push({ turn: war.turn, orders });
  state.pending = [];
  war.turn++;
  war.events.push({ type: 'turnPassed', turn: war.turn });
  if ((war.turn - 1) % state.data.constants.TURNS_PER_WEEK === 0) {
    war.phase = 'admin'; war.week++;
    resetWeeklySupply(war);
    war.events.push({ type: 'weekPassed', week: war.week });
  }
}
