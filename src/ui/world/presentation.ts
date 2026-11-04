import { visibleNodes } from '../../ai/strategy';
import type { Division, War, WorldOrder } from '../../world/types';

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
