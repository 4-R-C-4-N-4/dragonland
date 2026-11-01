// Keyboard input bindings (implementation.md §6 input). All actions also reachable via HUD.
import { issueCommand, fireSpecial, setPaused } from '../sim';
import type { World } from '../sim';
import type { Selection } from './selection';
import { updateDebugState, getDebugState } from '../debug/state';

export interface InputCallbacks {
  onSpeedToggle(): void;
}

/** Bindings: Space=pause, 1-4=select squad, A=select all, Q/W/E=Advance/Hold/FallBack,
 *  S=special, `=debug overlay, F=speed toggle. */
export function attachInput(target: Document | HTMLElement, world: World, selection: Selection, cb: InputCallbacks): () => void {
  const squadIdFor = (slot: number): string | undefined => world.squads.find((s) => s.side === 0 && s.slot === slot)?.id;

  const issueToSelection = (cmd: 'advance' | 'hold' | 'fallBack'): void => {
    const sel = selection.selectedSlots();
    if (sel === 'all') {
      issueCommand(world, 0, 'all', cmd);
    } else {
      for (const slot of sel) {
        const id = squadIdFor(slot);
        if (id) issueCommand(world, 0, id, cmd);
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case ' ':
        e.preventDefault();
        setPaused(world, !world.paused);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        selection.selectOnly(Number(e.key) - 1);
        break;
      case 'a':
      case 'A':
        selection.selectAll();
        break;
      case 'q':
      case 'Q':
        issueToSelection('advance');
        break;
      case 'w':
      case 'W':
        issueToSelection('hold');
        break;
      case 'e':
      case 'E':
        issueToSelection('fallBack');
        break;
      case 's':
      case 'S':
        fireSpecial(world, 0);
        break;
      case '`':
        updateDebugState({ overlay: !getDebugState().overlay });
        break;
      case 'f':
      case 'F':
      case 'Tab':
        e.preventDefault();
        cb.onSpeedToggle();
        break;
      default:
        break;
    }
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  return () => target.removeEventListener('keydown', onKeyDown as EventListener);
}
