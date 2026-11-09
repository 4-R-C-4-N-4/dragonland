// One small "Menu" button in the corner replaces the loose mode links: switch mode, and in a
// war, go to its title screen or abandon it and start again.
import { menuEntries, type GameMode } from './gameMenuLogic';
import './gameMenu.css';

export interface GameMenuOptions {
  mode: GameMode;
  /** Re-read on every open: whether a war is in progress. */
  warActive?: () => boolean;
  onMode: (mode: GameMode) => void;
  onWarTitle?: () => void;
  onWarRestart?: () => void;
}

export function mountGameMenu(opts: GameMenuOptions): { destroy(): void } {
  const root = document.createElement('div');
  root.className = 'dl-game-menu';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dl-game-menu__toggle';
  toggle.textContent = 'Menu';
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'dl-game-menu__list';
  list.hidden = true;
  root.append(toggle, list);
  document.body.append(root);

  function close(): void {
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  function act(id: string): void {
    close();
    if (id.startsWith('mode-')) opts.onMode(id.slice(5) as GameMode);
    else if (id === 'war-title') opts.onWarTitle?.();
    else if (id === 'war-restart') opts.onWarRestart?.();
  }

  function open(): void {
    list.replaceChildren();
    for (const entry of menuEntries(opts.mode, opts.warActive?.() ?? false)) {
      if (entry.id === 'war-title') list.append(document.createElement('hr'));
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = entry.disabled ? `${entry.label} (here)` : entry.label;
      b.disabled = !!entry.disabled;
      if (entry.confirm) b.classList.add('dl-game-menu__danger');
      b.addEventListener('click', () => {
        if (!entry.confirm) return act(entry.id);
        // Second step in place of window.confirm, so it works the same in every browser.
        const ask = document.createElement('div');
        ask.className = 'dl-game-menu__confirm';
        ask.append(entry.confirm);
        const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Abandon'; yes.className = 'dl-game-menu__danger';
        const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Keep playing';
        yes.addEventListener('click', () => act(entry.id));
        no.addEventListener('click', close);
        ask.append(yes, no);
        b.replaceWith(ask);
        no.focus();
      });
      list.append(b);
    }
    list.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  toggle.addEventListener('click', () => (list.hidden ? open() : close()));
  // composedPath: a clicked entry may already be replaced by its confirm step.
  const onDocClick = (e: MouseEvent): void => { if (!e.composedPath().includes(root)) close(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !list.hidden) { close(); toggle.focus(); } };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  return {
    destroy(): void {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
