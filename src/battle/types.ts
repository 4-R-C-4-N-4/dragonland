// Contract between the app flow (src/ui/flow) and the battle view (src/battle + src/render).
import type { GameData } from '../data';
import type { BattleSetup, World } from '../sim';

export interface BattleViewOptions {
  data: GameData;
  setup: BattleSetup;
  /** Display labels for the HUD (e.g. general names / loadout names). */
  labels: { player: string; enemy: string };
  /** Called once when world.result is set and the result has been shown on the field briefly. */
  onFinished: (world: World) => void;
  /** Omit to keep bare battle/dev fixtures without a quit control. Called after confirmation. */
  onQuit?: (world: World) => void;
  quitMessage?: string;
  quitConfirmLabel?: string;
}

export interface BattleView {
  destroy(): void;
}

/** Implemented in src/battle/view.ts: mounts the Pixi battle into `root` (fills it), runs the fixed-step loop, AI for side 1, input, HUD. */
export type StartBattleView = (root: HTMLElement, opts: BattleViewOptions) => Promise<BattleView>;
