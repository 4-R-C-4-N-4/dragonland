// Dev-only entry: starts a battle directly without the builder (for testing src/battle/view.ts).
// URL params let a designer reproduce a specific matchup/colour pairing for a readability check,
// e.g. ?a=lean-beast&b=lean-beast&ca=%23e0b030&cb=%238a4fd8 (same composition, custom colours).
import { getGameData } from '../data';
import { buildSideSetupFromLoadout } from '../ai/commit';
import { createRng } from '../sim/rng';
import { startBattleView } from './view';
import type { BattleSetup } from '../sim';

// Default dev colours deliberately avoid the old hard-coded blue/red: proves the pipeline carries
// arbitrary player-chosen colours, not a fixed PLAYER=blue/ENEMY=red assumption.
const DEFAULT_A_COLOR = '#2f6fe0'; // blue
const DEFAULT_B_COLOR = '#e0b030'; // gold

async function main(): Promise<void> {
  const data = getGameData();
  const root = document.querySelector<HTMLElement>('#app')!;
  const params = new URLSearchParams(window.location.search);

  const aId = params.get('a') ?? 'human-legion';
  const bId = params.get('b') ?? 'beast-horde';
  const colorA = params.get('ca') ?? DEFAULT_A_COLOR;
  const colorB = params.get('cb') ?? DEFAULT_B_COLOR;

  const playerLoadout = data.aiLoadoutById.get(aId);
  const enemyLoadout = data.aiLoadoutById.get(bId);
  if (!playerLoadout || !enemyLoadout) throw new Error(`dev.ts: missing loadout '${aId}' / '${bId}'`);

  const seed = Number(params.get('seed') ?? 12345);
  const rng = createRng(seed);
  const playerSide = { ...buildSideSetupFromLoadout(data, playerLoadout, rng), color: colorA };
  const enemySide = { ...buildSideSetupFromLoadout(data, enemyLoadout, rng), color: colorB };

  const setup: BattleSetup = { seed, sides: [playerSide, enemySide] };

  await startBattleView(root, {
    data,
    setup,
    labels: { player: playerLoadout.name, enemy: enemyLoadout.name },
    onFinished: (world) => {
      console.log('Battle finished:', world.result);
    },
  });
}

main().catch((e) => {
  console.error(e);
  document.body.textContent = `dev.ts error: ${e instanceof Error ? e.message : String(e)}`;
});
