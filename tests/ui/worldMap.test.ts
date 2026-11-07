import { describe, expect, it } from 'vitest';
import { buildWorldData, createWar, issueOrder, leaveAsGarrison, rawWorldData, resolveTurn } from '../../src/world';
import { visibleNodes } from '../../src/ai/strategy';
import {
  actionBlocker, adjacentNodeIds, defaultDivision, divisionName, nodeSummary, nodeTone, orderIntent, orderLabel,
  turnReport, undefendedCastles, visibleEnemyDivisions,
} from '../../src/ui/world/presentation';

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

describe('overworld readability helpers', () => {
  const node = (war: ReturnType<typeof makeWar>, id: string) => war.nodes.find(n => n.id === id)!;
  const own = (war: ReturnType<typeof makeWar>) => war.divisions.find(d => d.factionId === 'player')!;
  const enemy = (war: ReturnType<typeof makeWar>) => war.divisions.find(d => d.factionId !== 'player')!;

  it('colours by owner, not kind', () => {
    const war = makeWar();
    expect(nodeTone(node(war, 'westmere'), 'player')).toBe('own');
    expect(nodeTone(node(war, 'eastgate'), 'player')).toBe('enemy');
    expect(nodeTone(node(war, 'greenfield'), 'player')).toBe('neutral');
  });

  it('names divisions after their lead general, never by id', () => {
    const war = makeWar(); const d = own(war);
    expect(divisionName(war, d)).toBe("Ivy's division");
    expect(divisionName(war, { ...d, generals: [] })).not.toContain(d.id);
  });

  it('labels every order and the default hold', () => {
    const war = makeWar(); const id = own(war).id;
    expect(orderLabel(war, undefined)).toBe('Holding (default)');
    expect(orderLabel(war, { type: 'march', division: id, toNode: 'reedhaven' })).toBe('Marching to Reedhaven');
    expect(orderLabel(war, { type: 'search', division: id })).toBe('Searching');
    expect(orderLabel(war, { type: 'rest', division: id })).toBe('Resting');
    expect(orderLabel(war, { type: 'hold', division: id })).toBe('Holding');
  });

  it('summarises nodes in player words', () => {
    const war = makeWar();
    expect(nodeSummary(war, node(war, 'reedhaven'), 'player')).toBe('village · swamp · unclaimed · +3 gold/turn · wild troops');
    expect(nodeSummary(war, node(war, 'dawnkeep'), 'player')).toBe('castle · yours');
    expect(nodeSummary(war, node(war, 'eastgate'), 'player')).toBe('town · held by Night Host · +2 gold/turn');
    expect(nodeSummary(war, node(war, 'wyrmpeak'), 'player')).toContain('rich in wild troops');
    expect(nodeSummary(war, node(war, 'dawnkeep'), 'player')).not.toContain('settled');
  });

  it('selects the hero\'s division by default', () => {
    const war = makeWar();
    const hero = war.generals.find(g => g.isHero)!;
    expect(defaultDivision(war, 'player')?.generals).toContain(hero.id);
    expect(defaultDivision(war, 'player')?.factionId).toBe('player');
  });

  it('explains when Search or Rest would be wasted', () => {
    const war = makeWar(); const d = own(war);
    expect(actionBlocker(war, d, 'search')).toMatch(/no wild troops/);
    expect(actionBlocker(war, d, 'rest')).toBeNull();
    d.atNode = 'reedhaven';
    expect(actionBlocker(war, d, 'search')).toBeNull();
    expect(actionBlocker(war, d, 'rest')).toMatch(/own castles and towns/);
    d.atNode = 'eastgate';
    expect(actionBlocker(war, d, 'rest')).toMatch(/own castles and towns/);
  });

  it('flags a castle left without a garrison or a staying division', () => {
    const war = makeWar(); const d = own(war);
    expect(undefendedCastles(war, 'player', [])).toEqual([]);
    expect(undefendedCastles(war, 'player', [{ type: 'search', division: d.id }])).toEqual([]);
    const marching = [{ type: 'march' as const, division: d.id, toNode: 'reedhaven' }];
    expect(undefendedCastles(war, 'player', marching).map(n => n.id)).toEqual(['dawnkeep']);
    leaveAsGarrison(war, d.id, d.generals[1]!);
    expect(undefendedCastles(war, 'player', marching)).toEqual([]);
  });

  it('counts a division marching into a castle as defending it', () => {
    const war = makeWar(); const d = own(war);
    d.atNode = 'westmere';
    expect(undefendedCastles(war, 'player', []).map(n => n.id)).toEqual(['dawnkeep']);
    expect(undefendedCastles(war, 'player', [{ type: 'march', division: d.id, toNode: 'dawnkeep' }])).toEqual([]);
  });

  it('reports own actions and public captures after a turn', () => {
    const war = makeWar(); const d = own(war);
    issueOrder(war, { type: 'march', division: d.id, toNode: 'reedhaven' });
    resolveTurn(war);
    const report = turnReport(war, 'player');
    expect(report).toContain("Ivy's division marched from Dawnkeep to Reedhaven.");
    expect(report).toContain('You took Reedhaven.');
  });

  it('never reveals enemy movement inside fog', () => {
    const war = makeWar(); const e = enemy(war);
    war.events = [{ type: 'moved', division: e.id, from: 'eastgate', to: 'nightspire' }];
    expect(turnReport(war, 'player')).toEqual([]);
  });

  it('names only the origin when a visible enemy walks into fog', () => {
    const war = makeWar(); const e = enemy(war);
    // Reedhaven borders your castle; Mirehollow lies beyond your sight.
    war.events = [{ type: 'moved', division: e.id, from: 'reedhaven', to: 'mirehollow' }];
    expect(turnReport(war, 'player')).toEqual(['An enemy division left Reedhaven.']);
  });

  it('reports a visible enemy arrival with its faction and leader', () => {
    const war = makeWar(); const e = enemy(war);
    const lead = war.generals.find(g => g.id === e.generals[0])!.name;
    war.events = [{ type: 'moved', division: e.id, from: 'pinewatch', to: 'greenfield' }];
    expect(turnReport(war, 'player')).toEqual([`Night Host (${lead}) marched to Greenfield.`]);
  });

  it('keeps enemy recovery out of the report', () => {
    const war = makeWar(); const e = enemy(war);
    war.events = [{ type: 'healed', general: e.generals[0]!, hp: 50 }, { type: 'resupplied', general: e.generals[0]!, troops: 4 }];
    expect(turnReport(war, 'player')).toEqual([]);
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
