import { getGameData } from './data';
import { createStore } from './persist/store';
import { mountBuilder } from './ui/builder';

const data = getGameData();
const store = createStore(window.localStorage, data);
const app = document.querySelector<HTMLElement>('#app')!;

mountBuilder(app, {
  data,
  store,
  onStartBattle: (loadout) => {
    // Full Builder → Battle flow is wired by a later stream.
    console.log('Start battle with loadout:', loadout);
  },
});
