// Adopting beaten generals: a captured rival switches sides and joins one of your divisions.
// With a solo-hero start this is the main way to grow an army during a war; promotion from the
// ranks is too slow to matter in one campaign.
import { raiseMuster } from './muster';
import { internal } from './rng';
import type { War } from './types';

/** Move a captive from `factionId`'s prisoner list into `divisionId`. Throws without mutating. */
export function adoptCaptive(war: War, factionId: string, captiveId: string, divisionId: string): void {
  if (war.phase !== 'orders' && war.phase !== 'admin') throw new Error(`Generals cannot be adopted during ${war.phase === 'battle' ? 'a battle' : `the ${war.phase} phase`}`);
  const faction = war.factions.find(f => f.id === factionId);
  if (!faction) throw new Error(`Unknown faction ${factionId}`);
  if (!faction.captives.includes(captiveId)) throw new Error('That general is not your captive');
  const captive = war.generals.find(g => g.id === captiveId);
  if (!captive) throw new Error(`Unknown captive ${captiveId}`);
  if (captive.factionId === factionId) throw new Error('That captive already serves you');
  if (war.divisions.some(d => d.generals.includes(captiveId))) throw new Error('That captive still serves in a division');
  const division = war.divisions.find(d => d.id === divisionId);
  if (!division || division.factionId !== factionId || !division.generals.length) throw new Error('Choose one of your own divisions');
  const { MAX_DIVISION_GENERALS: cap, ADOPTED_HP_FRAC: hpFrac } = internal(war).data.constants;
  if (division.generals.length >= cap) throw new Error(`No room: a division leads at most ${cap} generals`);

  faction.captives = faction.captives.filter(id => id !== captiveId);
  captive.factionId = factionId;
  captive.nodeId = division.atNode;
  captive.injuredTurns = 0;
  // Beaten generals come back hurt; one still standing keeps what it had.
  captive.hp = Math.max(captive.hp, Math.ceil(captive.maxHp * hpFrac));
  division.generals.push(captiveId);
  raiseMuster(war, division);
  (internal(war).actions ??= []).push({ type: 'adopt', faction: factionId, captive: captiveId, division: divisionId });
}
