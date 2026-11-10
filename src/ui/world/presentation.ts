import { visibleNodes } from '../../ai/strategy';
import { hasGarrison } from '../../world/movement';
import { garrisonAt } from '../../world/garrison';
import type { Division, War, WorldNode, WorldOrder } from '../../world/types';

export function adjacentNodeIds(war: War, nodeId: string): string[] {
  if (!war.nodes.some(node => node.id === nodeId)) return [];
  return [...new Set(war.routes.flatMap(route => route.from === nodeId ? [route.to] : route.to === nodeId ? [route.from] : []))].sort();
}

export function visibleEnemyDivisions(war: War, factionId: string): Division[] {
  const visible = visibleNodes(war, factionId);
  return war.divisions.filter(d => d.factionId !== factionId && d.generals.length > 0 && visible.has(d.atNode));
}

export function orderIntent(war: War, factionId: string, divisionId: string, action: 'search' | 'rest' | 'hold' | 'march', target?: string): WorldOrder | null {
  if (war.phase !== 'orders') return null;
  const division = war.divisions.find(d => d.id === divisionId && d.factionId === factionId && d.generals.length > 0);
  if (!division) return null;
  if (action === 'march') return target && adjacentNodeIds(war, division.atNode).includes(target) ? { type: 'march', division: division.id, toNode: target } : null;
  return { type: action, division: division.id };
}

export { nodeTone, type NodeTone } from '../../render/worldTone';

const nodeName = (war: War, id: string) => war.nodes.find(n => n.id === id)?.name ?? id;
const generalName = (war: War, id: string | undefined) => (id ? war.generals.find(g => g.id === id)?.name : undefined);
const factionName = (war: War, id: string) => war.factions.find(f => f.id === id)?.name;

/** Players never see division ids: a division is named after the general leading it. */
export function divisionName(war: War, division: Division): string {
  const lead = generalName(war, division.generals[0]);
  return lead ? `${lead}'s division` : 'A broken division';
}

/** What a division will do this turn; no queued order means it holds. */
export function orderLabel(war: War, order: WorldOrder | undefined): string {
  if (!order) return 'Holding (default)';
  switch (order.type) {
    case 'march': return `Marching to ${nodeName(war, order.toNode)}`;
    case 'search': return 'Searching';
    case 'rest': return 'Resting';
    case 'hold': return 'Holding';
  }
}

/** One-line description of a node in player words (no internal biome ids such as "settled"). */
export function nodeSummary(war: War, node: WorldNode, factionId: string): string {
  const wild = node.biome !== 'settled';
  const owner = node.owner === null ? 'unclaimed' : node.owner === factionId ? 'yours' : `held by ${factionName(war, node.owner) ?? 'the enemy'}`;
  const parts: string[] = [node.kind];
  if (wild) parts.push(node.biome);
  parts.push(owner);
  if (wild) parts.push(node.kind === 'lair' ? 'rich in wild troops' : 'wild troops');
  return parts.join(' · ');
}

/**
 * Enemy generals and troops standing on a node (garrison and divisions alike), or null when
 * the node is out of sight or holds no enemy general.
 */
export function enemyForce(war: War, nodeId: string, factionId: string): { generals: number; troops: number } | null {
  if (!visibleNodes(war, factionId).has(nodeId)) return null;
  const inDivision = (id: string) => war.divisions.find(d => d.generals.includes(id));
  const here = war.generals.filter(g => g.factionId !== factionId && g.hp > 0 && !war.factions.some(f => f.captives.includes(g.id))
    && (inDivision(g.id)?.atNode ?? g.nodeId) === nodeId);
  return here.length ? { generals: here.length, troops: here.reduce((n, g) => n + g.troops.length, 0) } : null;
}

/** Hero's division first, then the first live division by id. */
export function defaultDivision(war: War, factionId: string): Division | undefined {
  const own = war.divisions.filter(d => d.factionId === factionId && d.generals.length > 0).sort((a, b) => a.id.localeCompare(b.id));
  const hero = war.generals.find(g => g.isHero && g.factionId === factionId);
  return own.find(d => hero && d.generals.includes(hero.id)) ?? own[0];
}

/** Whether holding no castle ends the war (LOSE_WITHOUT_CASTLES); false means only the hero's death does. */
export function castleLossEndsWar(war: War): boolean {
  return (war._internal as { data: { constants: { LOSE_WITHOUT_CASTLES: boolean } } }).data.constants.LOSE_WITHOUT_CASTLES;
}

/** Where an adopted general would go: the preferred division if it has room, else the first that does. */
export function adoptionTarget(war: War, factionId: string, preferred: string | null): { division: string } | { division: null; reason: string } {
  const cap = (war._internal as { data: { constants: { MAX_DIVISION_GENERALS: number } } }).data.constants.MAX_DIVISION_GENERALS;
  const own = war.divisions.filter(d => d.factionId === factionId && d.generals.length > 0).sort((a, b) => a.id.localeCompare(b.id));
  const open = own.filter(d => d.generals.length < cap);
  const pick = open.find(d => d.id === preferred) ?? open[0];
  if (pick) return { division: pick.id };
  return { division: null, reason: own.length ? `Every division is full (${cap} generals each).` : 'You have no division in the field to join.' };
}

/** Why a node action would do nothing here, or null when it is useful. */
export function actionBlocker(war: War, division: Division, action: 'search' | 'rest'): string | null {
  const node = war.nodes.find(n => n.id === division.atNode);
  if (!node) return 'Unknown location.';
  if (action === 'search') return node.biome === 'settled' ? 'Castles and towns have no wild troops to find.' : null;
  return node.owner === division.factionId && (node.kind === 'castle' || node.kind === 'town') ? null : 'Resting only works in your own castles and towns.';
}

/**
 * Generals stationed at a node, split by whether they actually stop a capture. The engine only
 * lets an uninjured castle garrison block an enemy (movement.ts hasGarrison); injured generals
 * and generals left in towns stay put but do not defend, so the UI must not call them defenders.
 */
export function garrisonStatus(war: War, nodeId: string, factionId: string): { defenders: string[]; idle: string[] } {
  const node = war.nodes.find(n => n.id === nodeId);
  const defenders: string[] = [], idle: string[] = [];
  for (const id of garrisonAt(war, nodeId, factionId)) {
    const g = war.generals.find(x => x.id === id)!;
    (node?.kind === 'castle' && g.injuredTurns === 0 ? defenders : idle).push(id);
  }
  return { defenders, idle };
}

/** Castles that end this turn with neither a garrison nor one of your divisions standing on them. */
export function undefendedCastles(war: War, factionId: string, orders: WorldOrder[]): WorldNode[] {
  const endNode = (d: Division) => { const o = orders.find(x => x.division === d.id); return o?.type === 'march' ? o.toNode : d.atNode; };
  const held = new Set(war.divisions.filter(d => d.factionId === factionId && d.generals.length > 0).map(endNode));
  return war.nodes.filter(n => n.kind === 'castle' && n.owner === factionId && !held.has(n.id) && !hasGarrison(war, n.id, factionId));
}

/**
 * What the last resolved turn showed this faction. Enemy movement is reported only where an
 * endpoint is visible now; a move into fog names the origin and nothing else. Captures are
 * public because ownership is drawn on the map for every node.
 */
export function turnReport(war: War, factionId: string): string[] {
  const visible = visibleNodes(war, factionId);
  const lines: string[] = [];
  const division = (id: string) => war.divisions.find(d => d.id === id);
  const enemyName = (d: Division) => {
    const faction = factionName(war, d.factionId) ?? 'The enemy';
    const lead = generalName(war, d.generals[0]);
    return lead ? `${faction} (${lead})` : faction;
  };
  for (const event of war.events) {
    switch (event.type) {
      case 'moved': {
        const d = division(event.division); if (!d) break;
        if (d.factionId === factionId) lines.push(`${divisionName(war, d)} marched from ${nodeName(war, event.from)} to ${nodeName(war, event.to)}.`);
        else if (visible.has(event.to)) lines.push(`${enemyName(d)} marched ${visible.has(event.from) ? `from ${nodeName(war, event.from)} ` : ''}to ${nodeName(war, event.to)}.`);
        else if (visible.has(event.from)) lines.push(`An enemy division left ${nodeName(war, event.from)}.`);
        break;
      }
      case 'captured':
        lines.push(event.factionId === factionId ? `You took ${nodeName(war, event.nodeId)}.` : `${factionName(war, event.factionId) ?? 'The enemy'} took ${nodeName(war, event.nodeId)}.`);
        break;
      case 'searchedNothing': {
        const d = division(event.division);
        if (d?.factionId === factionId) lines.push(`${divisionName(war, d)} searched ${nodeName(war, event.nodeId)} and found nothing.`);
        break;
      }
      case 'retreated': {
        const d = division(event.division); if (!d) break;
        if (d.factionId === factionId) lines.push(`${divisionName(war, d)} fell back to ${nodeName(war, event.toNode)}.`);
        else if (visible.has(event.toNode)) lines.push(`${enemyName(d)} fell back to ${nodeName(war, event.toNode)}.`);
        break;
      }
      case 'healed': {
        const g = war.generals.find(x => x.id === event.general);
        if (g?.factionId === factionId) lines.push(`${g.name} recovered ${Math.round(event.hp)} HP.`);
        break;
      }
      case 'resupplied': {
        const g = war.generals.find(x => x.id === event.general);
        if (g?.factionId === factionId) lines.push(`${g.name} took on ${event.troops} fresh troops.`);
        break;
      }
      case 'generalDefeated': {
        const g = war.generals.find(x => x.id === event.general); if (!g) break;
        const ours = event.by === factionId;
        const what = event.outcome === 'captured' ? (ours ? `You captured ${g.name}. Adopt them from Prisoners.` : `${g.name} was captured.`)
          : event.outcome === 'injured' ? (ours ? `${g.name} escaped, injured.` : `${g.name} was injured and is out for a few turns.`)
          : (ours ? `${g.name} fell.` : `${g.name} was killed.`);
        lines.push(what);
        break;
      }
      case 'weekPassed': lines.push(`Week ${event.week} begins.`); break;
      default: break;
    }
  }
  return lines;
}
