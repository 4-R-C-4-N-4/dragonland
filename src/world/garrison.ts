// Garrisoning: move a general between a field division and its node's standing garrison.
// A garrison general is simply one that belongs to no division, which is exactly what
// sequenceEncounter already treats as a castle's defenders.
import { internal } from './rng';
import type { War } from './types';

function friendlyHold(war: War, nodeId: string, factionId: string): void {
  const node = war.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Unknown node ${nodeId}`);
  if (node.owner !== factionId) throw new Error('A garrison can only be left in a node you hold');
  if (node.kind !== 'castle' && node.kind !== 'town') throw new Error('Only castles and towns can hold a garrison');
}

/** Detach a general from its division and leave it holding the node. */
export function leaveAsGarrison(war: War, divisionId: string, generalId: string): void {
  if (war.phase !== 'orders') throw new Error('Garrisons change during the orders phase');
  const division = war.divisions.find(d => d.id === divisionId);
  if (!division) throw new Error(`Unknown division ${divisionId}`);
  if (!division.generals.includes(generalId)) throw new Error(`General ${generalId} is not in division ${divisionId}`);
  const general = war.generals.find(g => g.id === generalId);
  if (!general) throw new Error(`Unknown general ${generalId}`);
  friendlyHold(war, division.atNode, division.factionId);
  const cap = internal(war).data.constants.GARRISON_CAP;
  const standing = war.generals.filter(g => g.factionId === division.factionId && g.nodeId === division.atNode && !war.divisions.some(d => d.generals.includes(g.id)));
  if (standing.length >= cap) throw new Error(`This node already holds ${cap} generals`);
  division.generals = division.generals.filter(id => id !== generalId);
  general.nodeId = division.atNode;
}

/** Take a standing general back into a division sitting on the same node. */
export function joinDivision(war: War, divisionId: string, generalId: string): void {
  if (war.phase !== 'orders') throw new Error('Garrisons change during the orders phase');
  const division = war.divisions.find(d => d.id === divisionId);
  if (!division) throw new Error(`Unknown division ${divisionId}`);
  const general = war.generals.find(g => g.id === generalId);
  if (!general) throw new Error(`Unknown general ${generalId}`);
  if (general.factionId !== division.factionId) throw new Error('That general belongs to another faction');
  if (war.divisions.some(d => d.generals.includes(generalId))) throw new Error('That general already serves in a division');
  if (general.nodeId !== division.atNode) throw new Error('That general is not at this node');
  const cap = internal(war).data.constants.MAX_DIVISION_GENERALS;
  if (division.generals.length >= cap) throw new Error(`A division leads at most ${cap} generals`);
  division.generals.push(generalId);
}

/** Generals holding a node for a faction: alive, uninjured and in no division. */
export function garrisonAt(war: War, nodeId: string, factionId: string): string[] {
  return war.generals
    .filter(g => g.factionId === factionId && g.nodeId === nodeId && g.hp > 0 && !war.divisions.some(d => d.generals.includes(g.id)))
    .map(g => g.id);
}
