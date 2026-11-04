import { internal } from './rng';
import type { Division, War, WorldOrder } from './types';

export function canMarch(war: War, division: Division, toNode: string): boolean {
  return division.generals.length > 0 && war.nodes.some(n => n.id === toNode) && war.routes.some(r => (r.from === division.atNode && r.to === toNode) || (r.to === division.atNode && r.from === toNode));
}
/** Snapshot all legal destinations before applying any movement. */
export function moveDivisions(war: War, orders: WorldOrder[]): Map<string, string> {
  const starts = new Map(war.divisions.map(d => [d.id, d.atNode]));
  const moves = orders.flatMap(order => {
    const division = war.divisions.find(d => d.id === order.division);
    return order.type === 'march' && division && canMarch(war, division, order.toNode) ? [{ division, to: order.toNode }] : [];
  }).sort((a, b) => a.division.id.localeCompare(b.division.id));
  for (const { division: d, to } of moves) {
    const from = starts.get(d.id)!;
    d.previousNode = from; d.atNode = to;
    (internal(war).paths[d.id] ??= []).push(from);
    for (const g of war.generals.filter(g => d.generals.includes(g.id))) g.nodeId = to;
    war.events.push({ type: 'moved', division: d.id, from, to });
  }
  return starts;
}
/** Garrison means actual castle generals outside a field division, not empty capacity. */
export function hasGarrison(war: War, nodeId: string, owner: string): boolean {
  const assigned = new Set(war.divisions.flatMap(d => d.generals));
  return war.generals.some(g => g.nodeId === nodeId && g.factionId === owner && g.hp > 0 && g.injuredTurns === 0 && !assigned.has(g.id));
}
export function captureUndefended(war: War, starts: Map<string, string>): void {
  for (const d of [...war.divisions].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!d.generals.length || starts.get(d.id) === d.atNode) continue;
    const node = war.nodes.find(n => n.id === d.atNode)!;
    if (node.owner === d.factionId || war.divisions.some(other => other.atNode === d.atNode && other.factionId !== d.factionId && other.generals.length > 0)) continue;
    if (node.kind === 'castle' && node.owner !== null && hasGarrison(war, node.id, node.owner)) continue;
    node.owner = d.factionId;
    war.events.push({ type: 'captured', nodeId: node.id, factionId: d.factionId });
  }
}
/** Walk only this division's actual arrival path; unrelated graph branches are not retreats. */
export function retreatNode(war: War, division: Division): string | null {
  if (division.previousNode === null) return null;
  const history = [...(internal(war).paths[division.id] ?? [])];
  if (history.at(-1) !== division.previousNode) history.push(division.previousNode);
  for (const id of history.reverse()) {
    if (id === division.atNode || !war.nodes.some(n => n.id === id)) continue;
    const node = war.nodes.find(n => n.id === id)!;
    if (node.kind === 'castle' && node.owner !== null && node.owner !== division.factionId && hasGarrison(war, id, node.owner)) continue;
    if (!war.divisions.some(d => d.factionId !== division.factionId && d.atNode === id && d.generals.length > 0)) return id;
  }
  return null;
}
