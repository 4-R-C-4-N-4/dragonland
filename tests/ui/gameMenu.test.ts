import { describe, expect, it } from 'vitest';
import { menuEntries } from '../../src/ui/common/gameMenuLogic';

describe('game menu entries', () => {
  it('offers the other modes, marking the current one, and war actions only in an active war', () => {
    expect(menuEntries('war', true).map(e => [e.id, e.label, !!e.disabled, !!e.confirm])).toEqual([
      ['mode-war', 'War campaign', true, false],
      ['mode-run', 'Skirmish', false, false],
      ['mode-sandbox', 'Sandbox', false, false],
      ['war-title', 'War title screen', false, false],
      ['war-restart', 'Abandon and start a new war', false, true],
    ]);
    expect(menuEntries('war', false).map(e => e.id)).toEqual(['mode-war', 'mode-run', 'mode-sandbox']);
    expect(menuEntries('run', false).find(e => e.id === 'mode-run')!.disabled).toBe(true);
  });
});
