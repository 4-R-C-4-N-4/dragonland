// Shared debug state (toggle with backtick). Pure, DOM-free; UI and render subscribe.
import type { Constants } from '../data';

export interface DebugState {
  /** Debug overlay visible (damage numbers, target lines, squad labels, grid, FPS/tick time). */
  overlay: boolean;
  /** Constants overrides from the constants panel; applied to the NEXT battle via withConstants(). */
  constantOverrides: Partial<Constants>;
}

type Listener = (s: DebugState) => void;

const state: DebugState = { overlay: false, constantOverrides: {} };
const listeners = new Set<Listener>();

export function getDebugState(): Readonly<DebugState> {
  return state;
}

export function updateDebugState(patch: Partial<DebugState>): void {
  Object.assign(state, patch);
  for (const l of listeners) l(state);
}

export function subscribeDebug(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
