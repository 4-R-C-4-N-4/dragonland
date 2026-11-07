import type { WorldNode } from '../world/types';

export type NodeTone = 'own' | 'enemy' | 'neutral';

/** Colour follows ownership; node kind is carried by shape. Pure, shared by render and UI. */
export function nodeTone(node: WorldNode, factionId: string): NodeTone {
  return node.owner === null ? 'neutral' : node.owner === factionId ? 'own' : 'enemy';
}
