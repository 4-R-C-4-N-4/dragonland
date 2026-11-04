// Pure enemy-colour resolution for the PlayerResponse/Fight transition (§12 colour pickers).
// Keeps the AI side visually distinct from whatever the player chose.
import { DEFAULT_ENEMY_COLOR, pickEnemyTeamColor, resolveSideColors, type SideColors } from '../../data/colors';
import type { Loadout } from '../../data/schemas';

/** Resolve the enemy side's team + squad colours once the player's loadout colours are known. */
export function resolveEnemySideColors(playerLoadout: Loadout, enemySquadCount: number, enemyPreferredColor?: string): SideColors {
  const playerColors = [playerLoadout.color, ...playerLoadout.squads.map((s) => s.color)].filter((c): c is string => Boolean(c));
  const team = pickEnemyTeamColor(playerColors, enemyPreferredColor ?? DEFAULT_ENEMY_COLOR);
  return resolveSideColors(team, new Array(enemySquadCount).fill(undefined), team);
}
