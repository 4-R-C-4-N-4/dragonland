import { hasGarrison } from './movement';
import { internal, nextInt } from './rng';
import type { BattleCause, Division, PendingBattle, War } from './types';

/** Canonical sweep followed by seeded tie selection: array order never awards initiative. */
export function detectEncounters(war: War, starts = new Map(war.divisions.map(d => [d.id, d.atNode]))): PendingBattle | null {
  if (war.pendingBattle) return war.pendingBattle;
  const divisions = war.divisions.filter(d => d.generals.length > 0).sort((a, b) => a.id.localeCompare(b.id));
  const candidates: { cause: BattleCause; nodeId: string; a: Division; b: Division | null }[] = [];
  const frame = internal(war).activeTurn;
  const identity = (cause: BattleCause, node: string, a: Division, b: Division | null) => `${cause}:${node}:${[a.id, b?.id ?? 'garrison'].sort().join(':')}`;
  for (let i = 0; i < divisions.length; i++) {
    const a = divisions[i]!;
    for (const b of divisions.slice(i + 1)) {
      if (a.factionId === b.factionId) continue;
      if (a.atNode === b.atNode) { if (!frame?.resolved.includes(identity('contact', a.atNode, a, b))) candidates.push({ cause: 'contact', nodeId: a.atNode, a, b }); }
      else if (starts.get(a.id) === b.atNode && starts.get(b.id) === a.atNode && war.routes.some(r => (r.from === a.atNode && r.to === b.atNode) || (r.to === a.atNode && r.from === b.atNode))) { const node = [a.atNode, b.atNode].sort()[0]!; if (!frame?.resolved.includes(identity('swap', node, a, b))) candidates.push({ cause: 'swap', nodeId: node, a, b }); }
    }
    const node = war.nodes.find(n => n.id === a.atNode)!;
    if (node.kind === 'castle' && node.owner !== null && node.owner !== a.factionId && hasGarrison(war, node.id, node.owner) && !divisions.some(d => d.atNode === node.id && d.factionId !== a.factionId) && !frame?.resolved.includes(identity('assault', node.id, a, null))) candidates.push({ cause: 'assault', nodeId: node.id, a, b: null });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.cause.localeCompare(b.cause) || a.a.id.localeCompare(b.a.id) || (a.b?.id ?? '').localeCompare(b.b?.id ?? ''));
  const rng = internal(war).rng;
  const chosen = candidates[nextInt(rng, candidates.length)]!;
  let attacker = chosen.a; let defender = chosen.b;
  if (defender && nextInt(rng, 2) === 1) [attacker, defender] = [defender, attacker];
  const encounterIdentity = identity(chosen.cause, chosen.nodeId, chosen.a, chosen.b);
  const ordinal = frame ? ++frame.ordinal : 1;
  const id = `battle-${war.turn}-${chosen.nodeId}${ordinal > 1 ? `-${ordinal}` : ''}`;
  if (frame) frame.current = encounterIdentity;
  war.pendingBattle = { id, cause: chosen.cause, nodeId: chosen.nodeId, attacker: attacker.id, defender: defender?.id ?? null, wild: [], processedSkirmishIds: [] };
  war.phase = 'battle'; war.events.push({ type: 'battleTriggered', battleId: id, cause: chosen.cause });
  return war.pendingBattle;
}
