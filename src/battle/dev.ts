// Dev-only entry: starts a battle directly without the builder (for testing src/battle/view.ts).
import { getGameData } from '../data';
import { buildSideSetupFromLoadout } from '../ai/commit';
import { createRng } from '../sim/rng';
import { startBattleView } from './view';
import type { BattleSetup } from '../sim';

async function main(): Promise<void> {
  const data = getGameData();
  const root = document.querySelector<HTMLElement>('#app')!;

  const playerLoadout = data.aiLoadoutById.get('human-legion');
  const enemyLoadout = data.aiLoadoutById.get('beast-horde');
  if (!playerLoadout || !enemyLoadout) throw new Error('dev.ts: missing human-legion / beast-horde loadouts');

  const seed = 12345;
  const rng = createRng(seed);
  const playerSide = buildSideSetupFromLoadout(data, playerLoadout, rng);
  const enemySide = buildSideSetupFromLoadout(data, enemyLoadout, rng);

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
