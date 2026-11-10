// Rivals rebuild a field force. The opening sends a small field force and keeps the rest home;
// once that force is beaten, a rival with only a garrison would sit still for the rest of the
// war. At each weekly muster, a rival with no field division sends two generals from a castle
// garrison of three or more out as a new division, keeping at least one home.
import { nextId, internal } from './rng';
import type { War } from './types';

const SEND = 2;
const KEEP_HOME = 1;

export function rivalsTakeTheField(war: War): void {
  const state = internal(war);
  for (const faction of [...war.factions].filter(f => !f.isPlayer).sort((a, b) => a.id.localeCompare(b.id))) {
    if (war.divisions.some(d => d.factionId === faction.id && d.generals.length > 0)) continue;
    const castles = war.nodes.filter(n => n.kind === 'castle' && n.owner === faction.id).sort((a, b) => a.id.localeCompare(b.id));
    for (const castle of castles) {
      const home = war.generals
        .filter(g => g.factionId === faction.id && g.nodeId === castle.id && g.hp > 0 && g.injuredTurns === 0
          && !war.divisions.some(d => d.generals.includes(g.id)) && !war.factions.some(f => f.captives.includes(g.id)))
        // Strongest first; ties by id so replays agree.
        .sort((a, b) => b.troops.length - a.troops.length || a.id.localeCompare(b.id));
      if (home.length < SEND + KEEP_HOME) continue;
      const id = nextId(state.rng, 'division');
      const generals = home.slice(0, SEND).map(g => g.id);
      war.divisions.push({ id, factionId: faction.id, generals, muster: home.slice(0, SEND).reduce((n, g) => n + g.troops.length, 0), atNode: castle.id, previousNode: null });
      state.paths[id] = [];
      break;
    }
  }
}
