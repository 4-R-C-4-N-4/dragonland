import { getGameData } from './data';
import { createStore } from './persist/store';
import { mountFlow } from './ui/flow';
import { mountDebugPanel } from './ui/debug';
import { updateDebugState, getDebugState } from './debug/state';
import { getBattleCounter } from './ui/flow/battleCounter';
import { loadConstantOverrides } from './ui/debug';

const data = getGameData();
const store = createStore(window.localStorage, data);
const app = document.querySelector<HTMLElement>('#app')!;

updateDebugState({ constantOverrides: loadConstantOverrides(window.localStorage) });

mountFlow(app, { data, store, storage: window.localStorage });

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
