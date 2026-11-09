import type { BattleSetup, World } from '../../sim';
import { snapshotBattleResult, type TerminalBattleSnapshot } from '../../world/sequence';

/** The tactical view controls side 0; strategic sequencing always uses defender first. */
export function campaignBattlePerspective(setup: BattleSetup, playerSide: 0 | 1): {
  setup: BattleSetup;
  snapshot(world: World): TerminalBattleSnapshot;
} {
  return {
    setup: playerSide === 0 ? setup : { ...setup, sides: [setup.sides[1], setup.sides[0]] },
    snapshot(world) {
      const snapshot = snapshotBattleResult(world);
      if (playerSide === 0) return snapshot;
      const { result, generalHp, generalMp } = snapshot;
      return {
        generalHp: [generalHp[1], generalHp[0]],
        ...(generalMp ? { generalMp: [generalMp[1], generalMp[0]] as [number, number] } : {}),
        result: {
          ...result,
          winner: result.winner === 0 ? 1 : 0,
          dead: [result.dead[1], result.dead[0]],
          survivors: [result.survivors[1], result.survivors[0]],
        },
      };
    },
  };
}

/**
 * Which tactical side belongs to the player, judged by the troops actually deployed: the side
 * holding the player's troops and the other holding none. Falls back to `claimed` when troops
 * cannot tell (an empty company, or both sides matching).
 */
export function playerSideOf(setup: BattleSetup, playerTroopIds: ReadonlySet<string>, claimed: 0 | 1): 0 | 1 {
  const mine = setup.sides.map(side => side.squads.some(q => q.troops.some(t => playerTroopIds.has(t.troopId))));
  if (mine[0] && !mine[1]) return 0;
  if (mine[1] && !mine[0]) return 1;
  return claimed;
}
