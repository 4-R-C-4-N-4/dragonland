import { getGameData } from './data';
import { createStore } from './persist/store';
import { mountFlow } from './ui/flow';
import { mountRun } from './ui/run';
import { mountDebugPanel } from './ui/debug';
import { updateDebugState, getDebugState } from './debug/state';
import { getBattleCounter } from './ui/flow/battleCounter';
import { loadConstantOverrides } from './ui/debug';

const MODE_KEY = 'dragonland.mode';
const data = getGameData();
const store = createStore(window.localStorage, data);
const app = document.querySelector<HTMLElement>('#app')!;

updateDebugState({ constantOverrides: loadConstantOverrides(window.localStorage) });

// Campaign (MVP2 run) is the default; the MVP1 sandbox with unlimited recruiting stays available.
const mode = new URLSearchParams(location.search).get('mode') ?? window.localStorage.getItem(MODE_KEY) ?? 'run';
function switchMode(next: 'run' | 'sandbox'): void {
  window.localStorage.setItem(MODE_KEY, next);
  location.search = '';
}
if (mode === 'sandbox') {
  mountFlow(app, { data, store, storage: window.localStorage });
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Campaign mode';
  link.style.cssText = 'position:fixed;top:6px;right:10px;z-index:50;font-size:12px;color:#9cf';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('run');
  });
  document.body.appendChild(link);
} else {
  mountRun(app, { data, storage: window.localStorage, onSandbox: () => switchMode('sandbox') });
}

const debugRoot = document.createElement('div');
document.body.appendChild(debugRoot);
mountDebugPanel(debugRoot, {
  data,
  store,
  storage: window.localStorage,
  getBattleCounter: () => getBattleCounter(window.localStorage),
});

window.addEventListener('keydown', (e) => {
  if (e.key !== '`') return;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
  updateDebugState({ overlay: !getDebugState().overlay });
});
