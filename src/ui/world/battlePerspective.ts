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
      const { result, generalHp } = snapshot;
      return {
        generalHp: [generalHp[1], generalHp[0]],
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
