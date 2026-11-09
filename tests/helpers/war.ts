// Test-only: rebuild the earlier opening shape (hero + two companions holding 50 troops each,
// command 70; one rival field division of up to five) for mechanics tests about garrisons,
// sequencing, upkeep, strategy and continuation rather than the opening itself. The shipped
// opening is covered by createWar.test.ts.
import { freshTroops } from '../../src/world/engine';
import type { War } from '../../src/world';

export function legacyOpening(war: War): War {
  const player = war.factions.find(f => f.isPlayer)!;
  const division = war.divisions.find(d => d.factionId === player.id)!;
  for (const id of division.generals) {
    const g = war.generals.find(x => x.id === id)!;
    g.capacity = 70;
    g.troops = [];
    g.troops = freshTroops(war, player.classes, 50);
  }
  for (const rival of war.factions.filter(f => !f.isPlayer)) {
    const field = war.divisions.find(d => d.factionId === rival.id);
    if (!field) continue;
    // One rival field division, as the old opening had.
    for (const extra of war.divisions.filter(d => d.factionId === rival.id && d !== field)) field.generals.push(...extra.generals);
    const paths = (war._internal as { paths: Record<string, string[]> }).paths;
    for (const extra of war.divisions.filter(d => d.factionId === rival.id && d !== field)) delete paths[extra.id];
    war.divisions = war.divisions.filter(d => d.factionId !== rival.id || d === field);
    const reserve = war.generals.filter(g => g.factionId === rival.id && !war.divisions.some(d => d.generals.includes(g.id)));
    while (field.generals.length < 5 && reserve.length) {
      const g = reserve.shift()!;
      g.nodeId = field.atNode;
      field.generals.push(g.id);
    }
  }
  return war;
}
