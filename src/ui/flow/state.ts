// Pure flow state machine (implementation.md §3): Builder -> EnemyCommit -> PlayerResponse ->
// Battle -> Result -> Builder. No DOM; the controller in index.ts drives this and renders.
import type { AiLoadout, Loadout } from '../../data';
import type { SideSetup, World } from '../../sim';
import type { CommitResult } from '../../ai/commit';

export type Screen = 'builder' | 'enemyCommit' | 'playerResponse' | 'battle' | 'result';

export interface FlowState {
  screen: Screen;
  /** Loadout the player started the flow with (set when leaving the builder). */
  playerLoadout: Loadout | null;
  /** Formation chosen in PlayerResponse; defaults to 'line'. */
  formationId: string;
  /** Seed used for the current/most recent battle. */
  seed: number;
  /** Battle counter, incremented once per battle started; persisted by the caller. */
  battleCount: number;
  enemyCommit: CommitResult | null;
  battleSetup: { seed: number; sides: [SideSetup, SideSetup] } | null;
  result: World | null;
}

export function initialFlowState(battleCount: number, seed: number): FlowState {
  return {
    screen: 'builder',
    playerLoadout: null,
    formationId: 'line',
    seed,
    battleCount,
    enemyCommit: null,
    battleSetup: null,
    result: null,
  };
}

export type FlowEvent =
  | { type: 'startFromBuilder'; loadout: Loadout }
  | { type: 'enemyCommitted'; commit: CommitResult; seed: number }
  | { type: 'chooseFormation'; formationId: string }
  | { type: 'fight'; setup: { seed: number; sides: [SideSetup, SideSetup] } }
  | { type: 'battleFinished'; world: World }
  | { type: 'quitBattle' }
  | { type: 'backToBuilder' }
  | { type: 'backToBuilderFromResponse' };

/** Pure reducer. Returns a new FlowState; throws on an event invalid for the current screen. */
export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'startFromBuilder':
      if (state.screen !== 'builder') throw new Error(`startFromBuilder invalid in screen ${state.screen}`);
      return { ...state, screen: 'enemyCommit', playerLoadout: event.loadout, enemyCommit: null, battleSetup: null, result: null };

    case 'enemyCommitted':
      if (state.screen !== 'enemyCommit') throw new Error(`enemyCommitted invalid in screen ${state.screen}`);
      return { ...state, screen: 'playerResponse', enemyCommit: event.commit, seed: event.seed };

    case 'chooseFormation':
      if (state.screen !== 'playerResponse') throw new Error(`chooseFormation invalid in screen ${state.screen}`);
      return { ...state, formationId: event.formationId };

    case 'fight':
      if (state.screen !== 'playerResponse') throw new Error(`fight invalid in screen ${state.screen}`);
      return { ...state, screen: 'battle', battleSetup: event.setup, battleCount: state.battleCount + 1 };

    case 'quitBattle':
      if (state.screen !== 'battle') throw new Error(`quitBattle invalid in screen ${state.screen}`);
      return { ...state, screen: 'builder', battleSetup: null, enemyCommit: null, result: null };

    case 'battleFinished':
      if (state.screen !== 'battle') throw new Error(`battleFinished invalid in screen ${state.screen}`);
      return { ...state, screen: 'result', result: event.world };

    case 'backToBuilder':
      if (state.screen !== 'result') throw new Error(`backToBuilder invalid in screen ${state.screen}`);
      return { ...state, screen: 'builder' };

    case 'backToBuilderFromResponse':
      if (state.screen !== 'playerResponse' && state.screen !== 'enemyCommit') {
        throw new Error(`backToBuilderFromResponse invalid in screen ${state.screen}`);
      }
      return { ...state, screen: 'builder' };
  }
}

/** Derives the next seed/battle counter for a new battle. Simple monotonic counter-based seed
 * so re-runs with the same persisted counter never collide and tests are deterministic. */
export function nextBattleSeed(battleCount: number): number {
  return battleCount + 1;
}

export type { AiLoadout };
