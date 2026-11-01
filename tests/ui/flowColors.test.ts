import { describe, expect, it } from 'vitest';
import type { Loadout } from '../../src/data/schemas';
import { resolveEnemySideColors } from '../../src/ui/flow/colors';
import { DEFAULT_ENEMY_COLOR, DEFAULT_PLAYER_COLOR, deltaE, MIN_SIDE_DELTA_E } from '../../src/data/colors';

function loadout(color?: string, squadColors: (string | undefined)[] = []): Loadout {
  return {
    id: 'l1',
    name: 'Test',
    generalId: 'paladin',
    color,
    squads: squadColors.map((c, i) => ({ id: `sq${i}`, name: `Squad ${i}`, troopIds: [], disposition: 'mixed', color: c })),
  };
}

describe('resolveEnemySideColors', () => {
  it('keeps the enemy preferred colour when it clashes with nothing', () => {
    const player = loadout(DEFAULT_PLAYER_COLOR, [undefined, undefined]);
    const enemy = resolveEnemySideColors(player, 2, '#e0b030');
    expect(enemy.team).toBe('#e0b030');
    expect(enemy.squads.length).toBe(2);
  });

  it('picks a distinguishable colour when the preferred one clashes with the player', () => {
    const player = loadout('#3a7bd5', ['#3a7bd5', '#3a7bd5']);
    const enemy = resolveEnemySideColors(player, 1, '#3a7bd5');
    expect(enemy.team).not.toBe('#3a7bd5');
    expect(deltaE(enemy.team, '#3a7bd5')).toBeGreaterThanOrEqual(MIN_SIDE_DELTA_E);
  });

  it('falls back to the default enemy colour when no preference is given and it is distinguishable', () => {
    const player = loadout('#8a4fd8', []);
    const enemy = resolveEnemySideColors(player, 0);
    expect(enemy.team).toBe(DEFAULT_ENEMY_COLOR);
  });
});
