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
import { mountGameMenu } from './ui/common/gameMenu';
import type { GameMode } from './ui/common/gameMenuLogic';

const MODE_KEY = 'dragonland.mode';
const data = getGameData();
const store = createStore(window.localStorage, data);
const app = document.querySelector<HTMLElement>('#app')!;

updateDebugState({ constantOverrides: loadConstantOverrides(window.localStorage) });

// War campaign (MVP3) is the default; MVP2's linear run stays as Skirmish, and the
// MVP1 sandbox with unlimited recruiting stays available.
type Mode = GameMode;
const mode = (new URLSearchParams(location.search).get('mode') ?? window.localStorage.getItem(MODE_KEY) ?? 'war') as Mode;
function switchMode(next: Mode): void {
  window.localStorage.setItem(MODE_KEY, next);
  location.search = '';
}
if (mode === 'sandbox') {
  mountFlow(app, { data, store, storage: window.localStorage });
  mountGameMenu({ mode, onMode: switchMode });
} else if (mode === 'run') {
  mountRun(app, { data, storage: window.localStorage });
  mountGameMenu({ mode, onMode: switchMode });
} else {
  const campaign = mountCampaign(app, {
    data,
    storage: window.localStorage,
    startBattleView,
    seed: 1,
  });
  mountGameMenu({
    mode: 'war',
    onMode: switchMode,
    warActive: () => campaign.hasWar(),
    onWarTitle: () => campaign.toTitle(),
    onWarRestart: () => campaign.abandonWar(),
  });
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
