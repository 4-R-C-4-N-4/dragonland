// Debug panel (implementation.md §9.1): constants editor, roster reset, battle counter display.
// Toggled externally via backtick -> updateDebugState({overlay}); this module renders when overlay=true.
import type { GameData } from '../../data';
import { ConstantsSchema, withConstants } from '../../data';
import type { Store } from '../../persist/store';
import { getDebugState, subscribeDebug, updateDebugState } from '../../debug/state';
import './debug.css';

const OVERRIDES_KEY = 'dragonland.v1.constOverrides';

export function loadConstantOverrides(storage: Pick<Storage, 'getItem'>): Partial<GameData['constants']> {
  const raw = storage.getItem(OVERRIDES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // Validate partially: only keep keys that parse against the full schema merged with defaults
    // is done by the caller (withConstants); here we just sanity-check it's a plain object.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveConstantOverrides(storage: Pick<Storage, 'setItem'>, overrides: Partial<GameData['constants']>): void {
  storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export interface MountDebugPanelOptions {
  data: GameData;
  store: Store;
  storage: Storage;
  getBattleCounter: () => number;
  onRosterReset?: () => void;
}

export interface MountedDebugPanel {
  destroy(): void;
}

export function mountDebugPanel(root: HTMLElement, opts: MountDebugPanelOptions): MountedDebugPanel {
  const { data, store, storage } = opts;
  const panel = document.createElement('div');
  panel.className = 'dl-debug-panel';
  root.appendChild(panel);

  let errorMsg = '';

  function render(): void {
    const state = getDebugState();
    panel.style.display = state.overlay ? 'block' : 'none';
    if (!state.overlay) return;

    const base = data.constants;
    const overrides = state.constantOverrides;

    panel.innerHTML = `
      <div class="dl-debug-header">
        <strong>Debug</strong>
        <span class="dl-dim">battle counter: ${opts.getBattleCounter()}</span>
        <button id="dl-dbg-close">✕</button>
      </div>
      ${errorMsg ? `<div class="dl-error">${escapeHtml(errorMsg)}</div>` : ''}
      <div class="dl-debug-actions">
        <button id="dl-dbg-reset-consts">Reset constants</button>
        <button id="dl-dbg-reset-roster">Reset roster</button>
      </div>
      <table class="dl-debug-consts">
        <tbody>
          ${Object.keys(base)
            .map((key) => {
              const k = key as keyof GameData['constants'];
              const val = overrides[k] ?? base[k];
              return `<tr><td>${key}</td><td><input type="number" step="any" data-const="${key}" value="${val}" /></td></tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
    bind();
  }

  function bind(): void {
    panel.querySelector('#dl-dbg-close')?.addEventListener('click', () => updateDebugState({ overlay: false }));

    panel.querySelector('#dl-dbg-reset-consts')?.addEventListener('click', () => {
      errorMsg = '';
      updateDebugState({ constantOverrides: {} });
      saveConstantOverrides(storage, {});
      render();
    });

    panel.querySelector('#dl-dbg-reset-roster')?.addEventListener('click', () => {
      if (!window.confirm('Reset the roster? All troops and saved armies referencing removed troops will be cleaned up.')) return;
      store.resetRoster(Date.now());
      opts.onRosterReset?.();
      render();
    });

    panel.querySelectorAll<HTMLInputElement>('input[data-const]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.const as keyof GameData['constants'];
        const num = Number(input.value);
        const state = getDebugState();
        const nextOverrides = { ...state.constantOverrides, [key]: num };
        try {
          // Validate the full merged set so cross-field constraints (positivity etc.) are enforced.
          ConstantsSchema.parse({ ...data.constants, ...nextOverrides });
          errorMsg = '';
          updateDebugState({ constantOverrides: nextOverrides });
          saveConstantOverrides(storage, nextOverrides);
        } catch (e) {
          errorMsg = e instanceof Error ? e.message : 'Invalid constant value.';
        }
        render();
      });
    });
  }

  const unsub = subscribeDebug(() => render());
  render();

  return {
    destroy() {
      unsub();
      panel.remove();
    },
  };
}

/** Convenience re-export used by the flow controller to get fresh data-for-battle. */
export function dataForBattle(data: GameData): GameData {
  return withConstants(data, getDebugState().constantOverrides);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
