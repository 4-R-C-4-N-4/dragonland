import { hasGarrison } from './movement';
import { internal, nextInt } from './rng';
import type { BattleCause, Division, PendingBattle, War } from './types';

/** Canonical sweep followed by seeded tie selection: array order never awards initiative. */
export function detectEncounters(war: War, starts = new Map(war.divisions.map(d => [d.id, d.atNode]))): PendingBattle | null {
  if (war.pendingBattle) return war.pendingBattle;
  const divisions = war.divisions.filter(d => d.generals.length > 0).sort((a, b) => a.id.localeCompare(b.id));
  const candidates: { cause: BattleCause; nodeId: string; a: Division; b: Division | null }[] = [];
  for (let i = 0; i < divisions.length; i++) {
    const a = divisions[i]!;
    for (const b of divisions.slice(i + 1)) {
      if (a.factionId === b.factionId) continue;
      if (a.atNode === b.atNode) candidates.push({ cause: 'contact', nodeId: a.atNode, a, b });
      else if (starts.get(a.id) === b.atNode && starts.get(b.id) === a.atNode && war.routes.some(r => (r.from === a.atNode && r.to === b.atNode) || (r.to === a.atNode && r.from === b.atNode))) candidates.push({ cause: 'swap', nodeId: [a.atNode, b.atNode].sort()[0]!, a, b });
    }
    const node = war.nodes.find(n => n.id === a.atNode)!;
    if (node.kind === 'castle' && node.owner !== null && node.owner !== a.factionId && hasGarrison(war, node.id, node.owner) && !divisions.some(d => d.atNode === node.id && d.factionId !== a.factionId)) candidates.push({ cause: 'assault', nodeId: node.id, a, b: null });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.cause.localeCompare(b.cause) || a.a.id.localeCompare(b.a.id) || (a.b?.id ?? '').localeCompare(b.b?.id ?? ''));
  const rng = internal(war).rng;
  const chosen = candidates[nextInt(rng, candidates.length)]!;
  let attacker = chosen.a; let defender = chosen.b;
  if (defender && nextInt(rng, 2) === 1) [attacker, defender] = [defender, attacker];
  const id = `battle-${war.turn}-${chosen.nodeId}`;
  war.pendingBattle = { id, cause: chosen.cause, nodeId: chosen.nodeId, attacker: attacker.id, defender: defender?.id ?? null, wild: [], processedSkirmishIds: [] };
  war.phase = 'battle'; war.events.push({ type: 'battleTriggered', battleId: id, cause: chosen.cause });
  return war.pendingBattle;
}
