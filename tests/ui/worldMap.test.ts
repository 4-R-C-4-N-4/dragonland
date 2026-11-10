import { describe, expect, it } from 'vitest';
import { legacyOpening } from '../helpers/war';
import { buildWorldData, createWar, issueOrder, leaveAsGarrison, rawWorldData, resolveTurn } from '../../src/world';
import { visibleNodes } from '../../src/ai/strategy';
import {
  actionBlocker, adjacentNodeIds, defaultDivision, divisionName, garrisonStatus, nodeSummary, nodeTone, orderIntent, orderLabel,
  turnReport, undefendedCastles, visibleEnemyDivisions, adoptionTarget, castleLossEndsWar, enemyForce,
} from '../../src/ui/world/presentation';
import { hasGarrison } from '../../src/world/movement';

const data = buildWorldData(rawWorldData);
const makeWar = () => legacyOpening(createWar(data, { seed: 17, heroId: 'paladin', heroName: 'Ivy' }));

describe('world map presentation helpers', () => {
  it('limits march targets to one authored route away', () => {
    const war = makeWar();
    const division = war.divisions.find(d => d.factionId === 'player')!;
    const targets = adjacentNodeIds(war, division.atNode);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(id => war.routes.some(r => (r.from === division.atNode && r.to === id) || (r.to === division.atNode && r.from === id)))).toBe(true);
    expect(adjacentNodeIds(war, 'missing-node')).toEqual([]);
  });

  it('sizes up an enemy force only where it can be seen', () => {
    const war = createWar(data, { seed: 17, heroId: 'warg', heroName: 'Ivy' });
    const castle = war.nodes.find(n => n.kind === 'castle' && n.owner !== 'player')!;
    const there = war.generals.filter(g => g.factionId === castle.owner && g.nodeId === castle.id && g.hp > 0);
    expect(enemyForce(war, castle.id, 'player')).toBeNull();
    const own = war.divisions.find(d => d.factionId === 'player')!;
    const next = war.routes.find(r => r.from === castle.id || r.to === castle.id)!;
    own.atNode = next.from === castle.id ? next.to : next.from;
    expect(visibleNodes(war, 'player').has(castle.id)).toBe(true);
    expect(enemyForce(war, castle.id, 'player')).toEqual({ generals: there.length, troops: there.reduce((n, g) => n + g.troops.length, 0) });
    expect(enemyForce(war, own.atNode, 'player')).toBeNull();
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
    expect(orderLabel(war, undefined)).toBe('No order yet: will hold');
    expect(orderLabel(war, { type: 'march', division: id, toNode: 'reedhaven' })).toBe('Marching to Reedhaven');
    expect(orderLabel(war, { type: 'search', division: id })).toBe('Searching');
    expect(orderLabel(war, { type: 'rest', division: id })).toBe('Resting');
    expect(orderLabel(war, { type: 'hold', division: id })).toBe('Holding');
  });

  it('summarises nodes in player words', () => {
    const war = makeWar();
    expect(nodeSummary(war, node(war, 'reedhaven'), 'player')).toBe('village · swamp · unclaimed · wild troops');
    expect(nodeSummary(war, node(war, 'dawnkeep'), 'player')).toBe('castle · yours');
    expect(nodeSummary(war, node(war, 'eastgate'), 'player')).toBe('town · held by Night Host');
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

  it('does not count injured or town-stationed generals as defenders, matching capture rules', () => {
    const war = makeWar(); const d = own(war);
    const [, second, third] = d.generals;
    leaveAsGarrison(war, d.id, third!);
    expect(garrisonStatus(war, 'dawnkeep', 'player')).toEqual({ defenders: [third], idle: [] });
    expect(hasGarrison(war, 'dawnkeep', 'player')).toBe(true);
    war.generals.find(g => g.id === third)!.injuredTurns = 2;
    expect(garrisonStatus(war, 'dawnkeep', 'player')).toEqual({ defenders: [], idle: [third] });
    expect(hasGarrison(war, 'dawnkeep', 'player')).toBe(false);
    // A town keeps a stationed general but never stops a capture.
    d.atNode = 'westmere';
    for (const id of d.generals) war.generals.find(g => g.id === id)!.nodeId = 'westmere';
    leaveAsGarrison(war, d.id, second!);
    expect(garrisonStatus(war, 'westmere', 'player')).toEqual({ defenders: [], idle: [second] });
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

  it('tells you whom you captured and points at Prisoners', () => {
    const war = makeWar(); const e = enemy(war);
    war.events = [{ type: 'generalDefeated', general: e.generals[0]!, by: 'player', outcome: 'captured' }];
    const name = war.generals.find(g => g.id === e.generals[0])!.name;
    expect(turnReport(war, 'player')).toEqual([`You captured ${name}. Adopt them from Prisoners.`]);
  });

  it('adopts into the selected division when it has room, else the first that does', () => {
    const war = makeWar(); const d = own(war);
    expect(adoptionTarget(war, 'player', d.id)).toEqual({ division: d.id });
    expect(adoptionTarget(war, 'player', null)).toEqual({ division: d.id });
    d.generals.push('f1', 'f2'); // now full at MAX_DIVISION_GENERALS
    expect(d.generals.length).toBe(5);
    expect(adoptionTarget(war, 'player', d.id)).toEqual({ division: null, reason: expect.stringMatching(/full/) });
  });

  it('reads whether losing every castle ends the war from the war rules', () => {
    const war = makeWar();
    expect(castleLossEndsWar(war)).toBe(false);
    (war._internal as { data: { constants: { LOSE_WITHOUT_CASTLES: boolean } } }).data.constants.LOSE_WITHOUT_CASTLES = true;
    expect(castleLossEndsWar(war)).toBe(true);
  });

  it('keeps enemy recovery out of the report', () => {
    const war = makeWar(); const e = enemy(war);
    war.events = [{ type: 'healed', general: e.generals[0]!, hp: 50 }, { type: 'resupplied', general: e.generals[0]!, troops: 4 }];
    expect(turnReport(war, 'player')).toEqual([]);
  });
});

/** Browser smoke fixture: await createWorldMapBrowserFixture(document.querySelector('#fixture')!).
 * The hero's division starts selected: click a gold-ringed node (or a "March to" button), check
 * the arrow and "This turn" label, Cancel, then handle.update(war) and handle.destroy(); verify the
 * canvas and section disappear.
 */
export async function createWorldMapBrowserFixture(root: HTMLElement) {
  const war = makeWar();
  const intents: unknown[] = [];
  const { mountWorldMap } = await import('../../src/ui/world');
  const handle = await mountWorldMap(root, { war, factionId: 'player', onOrder: intent => intents.push(intent), onEndTurn: () => intents.push('end-turn') });
  return { war, intents, handle };
}
