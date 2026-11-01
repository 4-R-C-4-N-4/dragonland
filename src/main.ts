import { getGameData } from './data';

const data = getGameData();
document.querySelector('#app')!.textContent = `Dragonland — ${data.units.length} units loaded`;
