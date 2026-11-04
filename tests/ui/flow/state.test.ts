import { describe, expect, it } from 'vitest';
import { flowReducer, initialFlowState, nextBattleSeed, type FlowState } from '../../../src/ui/flow/state';
import type { Loadout } from '../../../src/data/schemas';
import type { SideSetup } from '../../../src/sim';
import type { CommitResult } from '../../../src/ai/commit';

function loadout(): Loadout {
  return { id: 'l1', name: 'Army', generalId: 'paladin', squads: [{ id: 's1', name: 'Squad 1', troopIds: ['t1', 't2'], disposition: 'mixed' }] };
}

function sideSetup(): SideSetup {
  return { generalId: 'dragon', formationId: 'line', squads: [{ id: 'sq', name: 'Sq', disposition: 'fierce', troops: [{ troopId: 'ai-1', name: 'Foe', unitId: 'u1' }] }] };
}

describe('initialFlowState', () => {
  it('starts on the builder screen', () => {
    const s = initialFlowState(0, 1);
    expect(s.screen).toBe('builder');
    expect(s.battleCount).toBe(0);
  });
});

describe('flowReducer', () => {
  it('walks the full Builder -> EnemyCommit -> PlayerResponse -> Battle -> Result -> Builder cycle', () => {
    let s: FlowState = initialFlowState(0, 1);
    s = flowReducer(s, { type: 'startFromBuilder', loadout: loadout() });
    expect(s.screen).toBe('enemyCommit');

    const commit: CommitResult = { loadout: { id: 'ai1', name: 'AI', generalId: 'dragon', formation: 'line', squads: [] }, side: sideSetup() };
    s = flowReducer(s, { type: 'enemyCommitted', commit, seed: 7 });
    expect(s.screen).toBe('playerResponse');
    expect(s.seed).toBe(7);

    s = flowReducer(s, { type: 'chooseFormation', formationId: 'wedge' });
    expect(s.formationId).toBe('wedge');

    s = flowReducer(s, { type: 'fight', setup: { seed: 7, sides: [sideSetup(), sideSetup()] } });
    expect(s.screen).toBe('battle');
    expect(s.battleCount).toBe(1);

    const world = {} as never;
    s = flowReducer(s, { type: 'battleFinished', world });
    expect(s.screen).toBe('result');

    s = flowReducer(s, { type: 'backToBuilder' });
    expect(s.screen).toBe('builder');
  });

  it('allows bailing back to the builder from enemyCommit or playerResponse', () => {
    let s: FlowState = initialFlowState(0, 1);
    s = flowReducer(s, { type: 'startFromBuilder', loadout: loadout() });
    s = flowReducer(s, { type: 'backToBuilderFromResponse' });
    expect(s.screen).toBe('builder');
  });

  it('rejects events invalid for the current screen', () => {
    const s = initialFlowState(0, 1);
    expect(() => flowReducer(s, { type: 'chooseFormation', formationId: 'line' })).toThrow();
    expect(() => flowReducer(s, { type: 'backToBuilder' })).toThrow();
  });
});

describe('nextBattleSeed', () => {
  it('is a simple monotonic function of the battle counter', () => {
    expect(nextBattleSeed(0)).toBe(1);
    expect(nextBattleSeed(5)).toBe(6);
  });
});

it('quits only an active battle explicitly, clearing battle state without a fabricated result', () => {
  const active: FlowState = { ...initialFlowState(4, 5), screen: 'battle', playerLoadout: loadout(), battleSetup: { seed: 5, sides: [sideSetup(), sideSetup()] } };
  const next = flowReducer(active, { type: 'quitBattle' });
  expect(next).toMatchObject({ screen: 'builder', battleSetup: null, result: null, enemyCommit: null, playerLoadout: active.playerLoadout, battleCount: 4 });
  expect(() => flowReducer(next, { type: 'quitBattle' })).toThrow();
});
