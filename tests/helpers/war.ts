// Test-only: rebuild the pre-solo opening (hero + two companions with 50 troops each, rival
// field division of five) for mechanics tests that are about garrisons, sequencing, upkeep and
// continuation rather than the opening itself. The shipped opening is covered by createWar.test.ts.
import { getGameData } from '../../src/data';
import { freshTroops } from '../../src/world/engine';
import type { GeneralRecord, War } from '../../src/world';

export function legacyOpening(war: War): War {
  const game = getGameData();
  const player = war.factions.find(f => f.isPlayer)!;
  const division = war.divisions.find(d => d.factionId === player.id)!;
  const hero = war.generals.find(g => g.isHero)!;
  hero.troops = hero.troops.slice(0, 50);
  hero.capacity = 70;
  const profiles = game.generals.filter(g => player.classes.includes(game.unitById.get(g.unitId)!.classId) && g.id !== hero.generalId);
  ['Morurth', 'Sefenric'].forEach((name, i) => {
    const profile = profiles[i % profiles.length]!;
    const g: GeneralRecord = { id: `general-companion-${i}`, name, generalId: profile.id, factionId: player.id, isHero: false, level: 1, xp: 0, hp: profile.hp, maxHp: profile.hp, capacity: 70, troops: [], injuredTurns: 0, nodeId: hero.nodeId };
    war.generals.push(g);
    g.troops = freshTroops(war, player.classes, 50);
    division.generals.push(g.id);
  });
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
