import { describe, expect, it } from 'vitest';
import { buildWorldData, createWar, rawWorldData } from '../../src/world';
import { visibleNodes } from '../../src/ai/strategy';
import { adjacentNodeIds, orderIntent, visibleEnemyDivisions } from '../../src/ui/world/presentation';

const data = buildWorldData(rawWorldData);
const makeWar = () => createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' });

describe('world map presentation helpers', () => {
  it('limits march targets to one authored route away', () => {
    const war = makeWar();
    const division = war.divisions.find(d => d.factionId === 'player')!;
    const targets = adjacentNodeIds(war, division.atNode);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(id => war.routes.some(r => (r.from === division.atNode && r.to === id) || (r.to === division.atNode && r.from === id)))).toBe(true);
    expect(adjacentNodeIds(war, 'missing-node')).toEqual([]);
  });

  it('exposes enemy divisions only at visible nodes', () => {
    const war = makeWar();
    const visible = visibleEnemyDivisions(war, 'player');
    expect(visible.every(d => d.factionId !== 'player' && d.generals.length > 0)).toBe(true);
    expect(visible.every(d => visibleNodes(war, 'player').has(d.atNode))).toBe(true);
  });

  it('routes only own legal intents during the orders phase', () => {
    const war = makeWar();
    const own = war.divisions.find(d => d.factionId === 'player')!;
    const adjacent = adjacentNodeIds(war, own.atNode)[0]!;
    expect(orderIntent(war, 'player', own.id, 'march', adjacent)).toEqual({ type: 'march', division: own.id, toNode: adjacent });
    expect(orderIntent(war, 'player', own.id, 'march', 'non-adjacent')).toBeNull();
    expect(orderIntent(war, 'enemy', own.id, 'hold')).toBeNull();
    expect(orderIntent({ ...war, phase: 'battle' }, 'player', own.id, 'hold')).toBeNull();
    expect(orderIntent(war, 'player', own.id, 'search')).toEqual({ type: 'search', division: own.id });
  });
});

/** Browser smoke fixture: await createWorldMapBrowserFixture(document.querySelector('#fixture')!).
 * Then keyboard-tab through the node buttons, select a division, issue a legal order,
 * call handle.update(war), and finally handle.destroy(); verify the canvas and section disappear.
 */
export async function createWorldMapBrowserFixture(root: HTMLElement) {
  const war = makeWar();
  const intents: unknown[] = [];
  const { mountWorldMap } = await import('../../src/ui/world');
  const handle = await mountWorldMap(root, { war, factionId: 'player', onOrder: intent => intents.push(intent), onEndTurn: () => intents.push('end-turn') });
  return { war, intents, handle };
}
