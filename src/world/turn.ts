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
  const starts = new Map(war.divisions.map(d => [d.id, d.atNode]));
  state.activeTurn = { turn: war.turn, orders: structuredClone(orders), starts: Object.fromEntries(starts), resolved: [], ordinal: 0, current: null };
  moveDivisions(war, orders);
  // Capture safe arrivals immediately; keep every contested destination neutral until its encounter resolves.
  const safeStarts = new Map(starts);
  for (const d of war.divisions) {
    const hostile = war.divisions.some(other => other.id !== d.id && other.factionId !== d.factionId && other.generals.length && (other.atNode === d.atNode || (starts.get(d.id) === other.atNode && starts.get(other.id) === d.atNode)));
    if (hostile) safeStarts.set(d.id, d.atNode);
  }
  captureUndefended(war, safeStarts);
  if (detectEncounters(war, starts)) return;
  settleTurn(war);
}

function settleTurn(war: War): void {
  const state = internal(war); const frame = state.activeTurn;
  if (!frame || war.phase === 'lost' || war.phase === 'won') return;
  const hero = war.generals.find(g => g.isHero);
  if (hero && hero.hp <= 0) { war.phase = 'lost'; state.activeTurn = undefined; state.pending = []; return; }
  const divisions = [...war.divisions].sort((a, b) => a.id.localeCompare(b.id));
  for (const order of frame.orders) {
    const division = divisions.find(d => d.id === order.division);
    if (!division || !division.generals.length) continue;
    if (order.type === 'rest') applyRest(war, division);
    if (order.type === 'search') war.events.push({ type: 'searchedNothing', division: division.id, nodeId: division.atNode });
  }
  applyUpkeep(war);
  war.turnLog.push({ turn: frame.turn, orders: structuredClone(frame.orders) });
  state.pending = [];
  state.activeTurn = undefined;
  war.turn++;
  war.phase = 'orders';
  war.events.push({ type: 'turnPassed', turn: war.turn });
  if ((war.turn - 1) % state.data.constants.TURNS_PER_WEEK === 0) {
    war.phase = 'admin'; war.week++;
    resetWeeklySupply(war);
    war.events.push({ type: 'weekPassed', week: war.week });
  }
  if (hero && hero.hp <= 0) { war.phase = 'lost'; return; }
  const player = war.factions.find(f => f.isPlayer)!;
  if (!war.nodes.some(n => n.kind === 'castle' && n.owner === player.id)) { war.phase = 'lost'; return; }
  if (war.factions.filter(f => !f.isPlayer).every(f => !war.nodes.some(n => n.kind === 'castle' && n.owner === f.id))) war.phase = 'won';
}

/** Continue a committed turn after its sequence encounter has cleared. */
export function resumeTurn(war: War): void {
  if (war.phase !== 'battle' || war.pendingBattle || !internal(war).activeTurn) return;
  const state = internal(war), frame = state.activeTurn!;
  const hero = war.generals.find(g => g.isHero);
  if (hero && hero.hp <= 0) { settleTurn(war); return; }
  if (frame.current) { frame.resolved.push(frame.current); frame.current = null; }
  const starts = new Map(Object.entries(frame.starts));
  if (detectEncounters(war, starts)) return;
  captureUndefended(war, starts);
  settleTurn(war);
}

/** Leave the weekly admin screen without advancing the world. */
export function completeAdmin(war: War): void { if (war.phase === 'admin') war.phase = 'orders'; }
