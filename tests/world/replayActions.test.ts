import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { adoptCaptive, buildWorldData, createWar, hashWar, issueOrder, joinDivision, leaveAsGarrison, loadWar, rawWorldData, replayWar, resolveTurn, saveWar } from '../../src/world';
import { legacyOpening } from '../helpers/war';

const data = buildWorldData(rawWorldData);
const setup = { seed: 17, heroId: 'paladin' as const, heroName: 'Ivy' };
const holdAll = (war: ReturnType<typeof createWar>) => { for (const d of war.divisions) issueOrder(war, { type: 'hold', division: d.id }); resolveTurn(war); };

describe('actions outside orders are part of the replay log', () => {
  it('replays garrison changes to the same world', () => {
    // legacyOpening adds companions; replay rebuilds from the seed, so apply it there too.
    const war = legacyOpening(createWar(data, setup));
    const own = war.divisions.find(d => d.factionId === 'player')!;
    const companion = own.generals[1]!;
    leaveAsGarrison(war, own.id, companion);
    holdAll(war);
    joinDivision(war, own.id, companion);
    holdAll(war);
    expect(war.turnLog.map(r => r.actions)).toEqual([
      [{ type: 'leaveGarrison', division: own.id, general: companion }],
      [{ type: 'joinDivision', division: own.id, general: companion }],
    ]);
    const replay = replayWar(data, setup, war.turnLog, war.turnLog.length, legacyOpening);
    expect(hashWar(replay)).toBe(hashWar(war));
  });

  it('refuses to replay an adoption whose capture it cannot reproduce, instead of diverging', () => {
    const war = createWar(data, setup);
    const player = war.factions.find(f => f.isPlayer)!;
    const own = war.divisions.find(d => d.factionId === player.id)!;
    const field = war.divisions.find(d => d.factionId !== player.id)!;
    const captive = field.generals.shift()!;
    war.divisions = war.divisions.filter(d => d.generals.length);
    war.generals.find(g => g.id === captive)!.hp = 0;
    player.captives.push(captive);
    adoptCaptive(war, player.id, captive, own.id);
    holdAll(war);
    expect(war.turnLog[0]!.actions).toEqual([{ type: 'adopt', faction: player.id, captive, division: own.id }]);
    expect(() => replayWar(data, setup, war.turnLog)).toThrow(/captive/i);
  });

  it('keeps recorded and not-yet-recorded actions across a save', () => {
    const war = legacyOpening(createWar(data, setup));
    const own = war.divisions.find(d => d.factionId === 'player')!;
    leaveAsGarrison(war, own.id, own.generals[1]!);
    holdAll(war);
    leaveAsGarrison(war, own.id, own.generals[1]!); // pending until the next turn settles
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveWar(storage, war);
    const loaded = loadWar(storage, data, getGameData());
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.state.turnLog).toEqual(war.turnLog);
    holdAll(loaded.state);
    expect(loaded.state.turnLog.at(-1)!.actions).toHaveLength(1);
  });
});
