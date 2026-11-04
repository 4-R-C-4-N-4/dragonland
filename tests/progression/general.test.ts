import { describe, expect, it } from 'vitest';
import { getGameData } from '../../src/data';
import { createWar } from '../../src/world';
import type { War, GeneralRecord } from '../../src/world/types';
import { awardTroopXp, getProgressionConfig, type ProgressTroop } from '../../src/progression';
import { promoteTroop, recruitCaptive, generalTrackXp, canPromoteTroop, capacityForGeneralTrackXp, GENERAL_TRACK_TUNING } from '../../src/progression/general';
import { buildWorldData, rawWorldData } from '../../src/world/data';

const veteran: ProgressTroop = { id: 'troop-1', name: 'Ash', unitId: 'paladin', xp: 1200, level: 12 };
function fixture(): War { return createWar(buildWorldData(rawWorldData), { seed: 19, heroId: getGameData().generals[0]!.id, heroName: 'Test Hero' }); }
function putTroop(war: War, factionId: string, troop: ProgressTroop): string {
  const owner = war.generals.find(g => g.factionId === factionId)!;
  owner.troops = [troop];
  return owner.id;
}
function captiveRecord(id: string, factionId: string): GeneralRecord {
  return { id, name: 'Captured', generalId: getGameData().generals[0]!.id, factionId, isHero: false, level: 7, xp: 900, hp: 43, maxHp: 100, capacity: 6, troops: [{ id: 'nested', name: 'Nested', unitId: 'paladin', xp: 50, level: 1 }], injuredTurns: 3, nodeId: 'node' };
}

describe('general track, promotion and captive recruitment', () => {
  it('can recruit a legitimately promoted general without reinterpreting its troop XP as hero XP', () => {
    const war = fixture();
    const owner = war.factions[0]!;
    const captor = war.factions[1]!;
    const sourceId = putTroop(war, owner.id, { ...veteran });
    const promoted = promoteTroop(war, owner.id, sourceId, veteran.id, getGameData());
    war.generals.find(g => g.id === sourceId)!.troops = promoted.roster;
    war.generals.push(promoted.general);
    captor.captives.push(promoted.general.id);
    const destination = war.nodes.find(n => n.owner === captor.id)!.id;
    const before = structuredClone(war);
    const recruited = recruitCaptive(war, captor.id, promoted.general.id, destination, getGameData());
    expect(recruited.general).toMatchObject({ id: veteran.id, level: 12, xp: 1200, factionId: captor.id });
    expect(war).toEqual(before);
  });
  it('counts overflow XP independently of capped troop level and checks threshold boundaries', () => {
    const awarded = awardTroopXp(veteran, 200, Object.fromEntries(getGameData().units.map(u => [u.id, u])));
    expect(awarded).toMatchObject({ level: 12, xp: 1400 });
    const threshold = GENERAL_TRACK_TUNING.trackXpThreshold;
    const maxTroopXp = getProgressionConfig().troop.xpPerLevel * (getProgressionConfig().troop.maxLevel - 1);
    expect(generalTrackXp({ ...veteran, xp: maxTroopXp + threshold - 1 })).toBe(threshold - 1);
    expect(canPromoteTroop({ ...veteran, xp: maxTroopXp + threshold - 1 }, getGameData())).toBe(false);
    expect(canPromoteTroop({ ...veteran, xp: maxTroopXp + threshold }, getGameData())).toBe(true);
    expect(canPromoteTroop({ ...veteran, xp: maxTroopXp + threshold + 1 }, getGameData())).toBe(true);
  });

  it('requires actual ownership, source membership, unique identity and eligible level/stage/track', () => {
    const war = fixture();
    const blue = war.factions[0]!.id;
    const red = war.factions.find(f => f.id !== blue)!.id;
    const source = putTroop(war, blue, veteran);
    expect(() => promoteTroop(war, red, source, veteran.id, getGameData())).toThrow();
    const sourceGeneral = war.generals.find(g => g.id === source)!;
    const copy = { ...sourceGeneral.troops[0]! };
    sourceGeneral.troops = [];
    war.generals.find(g => g.factionId === red)!.troops = [copy];
    expect(() => promoteTroop(war, blue, source, veteran.id, getGameData())).toThrow();
    war.generals.find(g => g.factionId === red)!.troops = [];
    sourceGeneral.troops = [copy];
    expect(() => promoteTroop(war, blue, source, veteran.id, getGameData())).not.toThrow();

    for (const troop of [{ ...veteran, xp: 1099, level: 11 }, { ...veteran, unitId: 'monk' }, { ...veteran, unitId: 'not-a-species' }, { ...veteran, xp: GENERAL_TRACK_TUNING.trackXpThreshold - 1 }]) {
      sourceGeneral.troops = [troop];
      expect(() => promoteTroop(war, blue, source, troop.id, getGameData())).toThrow();
    }
  });

  it('uses catalog profile, returns copied roster and does not mutate war', () => {
    const war = fixture(); const faction = war.factions[0]!.id;
    const source = putTroop(war, faction, veteran);
    const original = structuredClone(war);
    const result = promoteTroop(war, faction, source, veteran.id, getGameData());
    expect(result.general).toMatchObject({ id: veteran.id, name: veteran.name, generalId: 'paladin', factionId: faction, xp: 1200, capacity: capacityForGeneralTrackXp(100) });
    expect(result.roster).toEqual([]);
    expect(result.roster).not.toBe(war.generals.find(g => g.id === source)!.troops);
    expect(war).toEqual(original);
  });

  it('grows capacity from configured base, applies increments and hard cap, rejects invalid inputs', () => {
    expect(capacityForGeneralTrackXp(0)).toBe(GENERAL_TRACK_TUNING.baseCapacity);
    expect(capacityForGeneralTrackXp(GENERAL_TRACK_TUNING.trackXpThreshold)).toBe(GENERAL_TRACK_TUNING.baseCapacity + GENERAL_TRACK_TUNING.capacityPerTrackIncrement);
    expect(capacityForGeneralTrackXp(Number.MAX_VALUE)).toBe(GENERAL_TRACK_TUNING.maxCapacity);
    for (const invalid of [-1, NaN, Infinity]) expect(() => capacityForGeneralTrackXp(invalid)).toThrow();
  });

  it('requires one real captor-list reference, valid living captive and legal friendly node', () => {
    const war = fixture(); const faction = war.factions[0]!; const enemy = war.factions.find(f => f.id !== faction.id)!;
    const captive = captiveRecord('captive-1', enemy.id); war.generals.push(captive); faction.captives = [captive.id];
    const friendlyNode = war.nodes.find(n => n.owner === faction.id)!.id;
    expect(() => recruitCaptive(war, faction.id, captive.id, friendlyNode, getGameData())).not.toThrow();
    faction.captives = [];
    expect(() => recruitCaptive(war, faction.id, captive.id, friendlyNode, getGameData())).toThrow();
    faction.captives = [captive.id, captive.id];
    expect(() => recruitCaptive(war, faction.id, captive.id, friendlyNode, getGameData())).toThrow();
    faction.captives = [captive.id];
    captive.hp = 0;
    expect(() => recruitCaptive(war, faction.id, captive.id, friendlyNode, getGameData())).toThrow();
    captive.hp = NaN;
    expect(() => recruitCaptive(war, faction.id, captive.id, friendlyNode, getGameData())).toThrow();
    captive.hp = 43;
    expect(() => recruitCaptive(war, faction.id, captive.id, war.nodes.find(n => n.owner !== faction.id)!.id, getGameData())).toThrow();
  });

  it('transfers an authorized third-faction captive once, preserving identity, profile and injury without aliases', () => {
    const war = fixture(); const captor = war.factions[0]!; const prior = war.factions.find(f => f.id !== captor.id)!;
    const captive = captiveRecord('captive-2', prior.id); war.generals.push(captive); captor.captives = [captive.id];
    const before = structuredClone(war); const destination = war.nodes.find(n => n.owner === captor.id)!.id;
    const result = recruitCaptive(war, captor.id, captive.id, destination, getGameData());
    expect(result.general).toMatchObject({ id: captive.id, name: captive.name, generalId: captive.generalId, factionId: captor.id, hp: 43, maxHp: 100, injuredTurns: 3, nodeId: destination });
    expect(result.general.troops).toEqual(captive.troops);
    expect(result.general.troops).not.toBe(captive.troops);
    expect(result.general.troops[0]).not.toBe(captive.troops[0]);
    expect(result.captives).toEqual([]); expect(result.captives).not.toBe(captor.captives);
    expect(war).toEqual(before);
  });
});
