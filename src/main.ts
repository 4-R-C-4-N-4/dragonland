import { getGameData } from './data';
import { createStore } from './persist/store';
import { mountFlow } from './ui/flow';
import { mountRun } from './ui/run';
import { mountCampaign } from './ui/world/campaign';
import { startBattleView } from './battle/view';
import { mountDebugPanel } from './ui/debug';
import { updateDebugState, getDebugState } from './debug/state';
import { getBattleCounter } from './ui/flow/battleCounter';
import { loadConstantOverrides } from './ui/debug';

const MODE_KEY = 'dragonland.mode';
const data = getGameData();
const store = createStore(window.localStorage, data);
const app = document.querySelector<HTMLElement>('#app')!;

updateDebugState({ constantOverrides: loadConstantOverrides(window.localStorage) });

// War campaign (MVP3) is the default; MVP2's linear run stays as Skirmish, and the
// MVP1 sandbox with unlimited recruiting stays available.
type Mode = 'war' | 'run' | 'sandbox';
const mode = (new URLSearchParams(location.search).get('mode') ?? window.localStorage.getItem(MODE_KEY) ?? 'war') as Mode;
function switchMode(next: Mode): void {
  window.localStorage.setItem(MODE_KEY, next);
  location.search = '';
}
function modeLink(label: string, next: Mode, right = 10): void {
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = label;
  link.style.cssText = `position:fixed;top:6px;right:${right}px;z-index:50;font-size:12px;color:#9cf`;
  link.addEventListener('click', (e) => { e.preventDefault(); switchMode(next); });
  document.body.appendChild(link);
}
if (mode === 'sandbox') {
  mountFlow(app, { data, store, storage: window.localStorage });
  modeLink('War campaign', 'war');
  modeLink('Skirmish', 'run', 120);
} else if (mode === 'run') {
  mountRun(app, { data, storage: window.localStorage, onSandbox: () => switchMode('sandbox') });
  modeLink('War campaign', 'war');
} else {
  mountCampaign(app, {
    data,
    storage: window.localStorage,
    startBattleView,
    seed: 1,
    onExit: () => switchMode('run'),
  });
  modeLink('Skirmish', 'run');
  modeLink('Sandbox', 'sandbox', 90);
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
