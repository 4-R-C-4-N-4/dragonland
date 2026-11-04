/** Provisional general-track balance proposals; campaign integration is not included. */
export const GENERAL_TRACK_TUNING = Object.freeze({
  promotionMinLevel: 12,
  trackXpThreshold: 100,
  baseCapacity: 6,
  capacityPerTrackIncrement: 1,
  capacityXpIncrement: 100,
  maxCapacity: 100,
});

import { getProgressionConfig, type ProgressTroop } from './index';
import type { GameData } from '../data';
import type { GeneralRecord, War } from '../world/types';

export interface PromotionResult { general: GeneralRecord; roster: ProgressTroop[] }
export interface CaptiveRecruitmentResult { general: GeneralRecord; captives: string[] }

function troopProgressValid(troop: ProgressTroop): boolean {
  const c = getProgressionConfig().troop;
  return Number.isInteger(troop.level) && troop.level >= 1 && troop.level <= c.maxLevel &&
    Number.isFinite(troop.xp) && troop.xp >= 0 &&
    troop.level === Math.min(c.maxLevel, 1 + Math.floor(troop.xp / c.xpPerLevel));
}

export function generalTrackXp(troop: Pick<ProgressTroop, 'xp'>): number {
  if (!Number.isFinite(troop.xp) || troop.xp < 0) throw new Error('Invalid troop XP');
  const c = getProgressionConfig().troop;
  return Math.max(0, troop.xp - c.xpPerLevel * (c.maxLevel - 1));
}

export function capacityForGeneralTrackXp(trackXp: number): number {
  if (!Number.isFinite(trackXp) || trackXp < 0) throw new Error('Track XP must be finite and nonnegative');
  const growth = Math.floor(trackXp / GENERAL_TRACK_TUNING.capacityXpIncrement) * GENERAL_TRACK_TUNING.capacityPerTrackIncrement;
  return Math.min(GENERAL_TRACK_TUNING.maxCapacity, GENERAL_TRACK_TUNING.baseCapacity + growth);
}

export function canPromoteTroop(troop: ProgressTroop, data: GameData): boolean {
  if (!troopProgressValid(troop) || troop.level < GENERAL_TRACK_TUNING.promotionMinLevel || generalTrackXp(troop) < GENERAL_TRACK_TUNING.trackXpThreshold) return false;
  const unit = data.unitById.get(troop.unitId);
  return !!unit && unit.stage === 3 && data.generals.some(g => g.unitId === troop.unitId);
}

/** Pure proposal: validates identity and eligibility from authoritative war state. */
export function promoteTroop(war: War, factionId: string, sourceGeneralId: string, troopId: string, data: GameData): PromotionResult {
  const source = war.generals.find(g => g.id === sourceGeneralId);
  if (!source || source.factionId !== factionId) throw new Error('Source general is not owned by the requested faction');
  const troopMatches = war.generals.flatMap(g => g.troops.filter(t => t.id === troopId).map(t => ({ general: g, troop: t })));
  const generalMatches = war.generals.filter(g => g.id === troopId);
  if (troopMatches.length !== 1 || generalMatches.length !== 0 || troopMatches[0]!.general.id !== sourceGeneralId) throw new Error('Troop identity must occur exactly once in the source roster and nowhere else');
  const troop = troopMatches[0]!.troop;
  if (!canPromoteTroop(troop, data)) throw new Error('Troop is not eligible for promotion');
  const profile = data.generals.find(g => g.unitId === troop.unitId)!;
  const node = war.nodes.find(n => n.id === source.nodeId);
  if (!node) throw new Error('Source general has no legal world node');
  const general: GeneralRecord = {
    id: troop.id, name: troop.name, generalId: profile.id, factionId, isHero: false,
    level: troop.level, xp: troop.xp, hp: profile.hp, maxHp: profile.hp,
    capacity: capacityForGeneralTrackXp(generalTrackXp(troop)), troops: [], injuredTurns: 0, nodeId: source.nodeId,
  };
  const roster = source.troops.filter(t => t.id !== troopId).map(t => ({ ...t }));
  return { general, roster };
}

/** Pure transfer proposal; the caller applies both returned values to campaign state. */
export function recruitCaptive(war: War, factionId: string, captiveId: string, nodeId: string, data: GameData): CaptiveRecruitmentResult {
  const factionMatches = war.factions.filter(f => f.id === factionId);
  const faction = factionMatches[0];
  if (factionMatches.length !== 1 || !faction) throw new Error('Unknown recruiting faction');
  const node = war.nodes.find(n => n.id === nodeId);
  if (!node || node.owner !== factionId) throw new Error('Recruitment node must be owned by the requesting faction');
  const captiveRefs = faction.captives.filter(id => id === captiveId);
  const captives = war.generals.filter(g => g.id === captiveId);
  if (captiveRefs.length !== 1 || captives.length !== 1) throw new Error('Captive must exist exactly once in captor list and war');
  const captive = captives[0]!;
  if (captive.factionId === factionId) throw new Error('General is already owned by requester');
  if (war.divisions.some(d => d.factionId !== factionId && d.generals.includes(captiveId))) throw new Error('Captive is assigned to an active enemy division');
  const heroProgression = getProgressionConfig().hero;
  // Promoted veterans retain troop-track XP; do not apply the hero XP-to-level formula.
  if (!Number.isFinite(captive.hp) || !Number.isFinite(captive.maxHp) || captive.maxHp <= 0 || captive.hp <= 0 || captive.hp > captive.maxHp || !Number.isFinite(captive.xp) || captive.xp < 0 || !Number.isInteger(captive.level) || captive.level < 1 || captive.level > heroProgression.maxLevel) throw new Error('Captive has invalid HP or progression');
  const profile = data.generals.find(g => g.id === captive.generalId);
  if (!profile || !data.unitById.has(profile.unitId) || data.unitById.get(profile.unitId)!.stage !== 3) throw new Error('Captive has invalid general profile');
  const general: GeneralRecord = { ...captive, factionId, nodeId, troops: captive.troops.map(t => ({ ...t })) };
  return { general, captives: faction.captives.filter(id => id !== captiveId) };
}
