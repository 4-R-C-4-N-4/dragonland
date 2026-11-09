// What the game menu offers, kept DOM-free so it can be tested under node.
export type GameMode = 'war' | 'run' | 'sandbox';

export interface MenuEntry {
  id: string;
  label: string;
  disabled?: boolean;
  /** Ask before acting: the action throws away progress. */
  confirm?: string;
}

const MODES: [GameMode, string][] = [['war', 'War campaign'], ['run', 'Skirmish'], ['sandbox', 'Sandbox']];

export function menuEntries(mode: GameMode, warActive: boolean): MenuEntry[] {
  const entries: MenuEntry[] = MODES.map(([m, label]) => ({ id: `mode-${m}`, label, ...(m === mode ? { disabled: true } : {}) }));
  if (mode === 'war' && warActive) {
    entries.push(
      { id: 'war-title', label: 'War title screen' },
      { id: 'war-restart', label: 'Abandon and start a new war', confirm: 'Abandon this war? Its save is deleted.' },
    );
  }
  return entries;
}
