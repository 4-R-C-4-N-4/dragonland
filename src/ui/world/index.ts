import { Application } from 'pixi.js';
import type { WorldOrder, War } from '../../world/types';
import { drawWorldMap } from '../../render/worldMap';
import { adjacentNodeIds, orderIntent } from './presentation';
import { visibleNodes } from '../../ai/strategy';
import './world.css';

export interface WorldMapOptions { war: War; factionId: string; onOrder: (order: WorldOrder) => void; onEndTurn: () => void }
export interface WorldMapHandle { update(war: War): void; destroy(): void }

/** Mounts the provisional map art and intent controls. This widget never changes the supplied War. */
export async function mountWorldMap(root: HTMLElement, options: WorldMapOptions): Promise<WorldMapHandle> {
  let war = options.war, destroyed = false, selectedNode: string | null = null, selectedDivision: string | null = null;
  const cleanups: (() => void)[] = [];
  let failure: unknown;
  const shell = document.createElement('section'); shell.className = 'dl-world-map';
  const mapArea = document.createElement('div'); mapArea.className = 'dl-world-map__stage';
  const side = document.createElement('aside'); side.className = 'dl-world-map__side dl-panel';
  const canvasWrap = document.createElement('div'); canvasWrap.className = 'dl-world-map__canvas';
  const info = document.createElement('div'); info.className = 'dl-world-map__info';
  const nodesList = document.createElement('div'); nodesList.className = 'dl-world-map__nodes';
  const status = document.createElement('div'); status.className = 'dl-world-map__status';
  const orders = document.createElement('div'); orders.className = 'dl-world-map__orders';
  shell.append(mapArea, side); mapArea.append(canvasWrap, info); side.append(status, nodesList, orders); root.appendChild(shell);
  cleanups.push(() => { if (shell.parentElement) shell.remove(); });
  const app = new Application();
  cleanups.push(() => { const canvas = app.renderer ? app.canvas : undefined; try { if (app.renderer) app.destroy(true, { children: true }); else app.stage.destroy({ children: true }); } finally { canvas?.remove(); } });
  function destroy(): void {
    if (destroyed) return; destroyed = true;
    let first: unknown;
    for (const cleanup of cleanups.slice().reverse()) try { cleanup(); } catch (error) { first ??= error; }
    cleanups.length = 0;
    if (first) throw first;
  }
  try {
    await app.init({ resizeTo: canvasWrap, antialias: true, background: '#14100e' });
    if (destroyed) { app.destroy(true, { children: true }); return { update() {}, destroy }; }
    canvasWrap.appendChild(app.canvas);
    function selectNode(id: string): void {
      selectedNode = id;
      if (!war.divisions.some(d => d.id === selectedDivision && d.atNode === id && d.factionId === options.factionId)) selectedDivision = null;
      render();
    }
    const redraw = () => drawWorldMap(app.stage, war, options.factionId, selectNode, app.renderer.width, app.renderer.height);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : undefined;
    resize?.observe(canvasWrap); if (resize) cleanups.push(() => resize.disconnect());
    function button(label: string, disabled: boolean, action: () => void, primary = false): HTMLButtonElement {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.disabled = disabled; if (primary) el.classList.add('dl-primary'); el.addEventListener('click', action); return el;
    }
    function render(): void {
      if (destroyed) return;
      if (selectedNode && !war.nodes.some(n => n.id === selectedNode)) selectedNode = null;
      if (selectedDivision && !war.divisions.some(d => d.id === selectedDivision && d.factionId === options.factionId && d.generals.length)) selectedDivision = null;
      redraw();
      status.textContent = `Turn ${war.turn} · Week ${war.week} · ${war.phase}`;
      const disclaimer = document.createElement('small'); disclaimer.textContent = 'Provisional map art · campaign flow is not connected';
      if (!side.querySelector('.dl-world-map__disclaimer')) { disclaimer.className = 'dl-world-map__disclaimer'; side.insertBefore(disclaimer, status); }
      nodesList.replaceChildren();
      for (const node of war.nodes) {
        const b = button(`${node.name} · ${node.kind} · ${node.biome} · ${war.factions.find(f => f.id === node.owner)?.name ?? 'Unclaimed'}`, false, () => selectNode(node.id));
        b.setAttribute('aria-pressed', String(selectedNode === node.id)); nodesList.appendChild(b);
      }
      info.replaceChildren();
      const node = war.nodes.find(n => n.id === selectedNode);
      if (node) {
        const heading = document.createElement('h2'); heading.textContent = `${node.name} · ${node.kind}`; info.append(heading);
        const detail = document.createElement('p'); detail.textContent = `${node.biome} · ${war.factions.find(f => f.id === node.owner)?.name ?? 'Unclaimed'}`; info.append(detail);
        const seen = visibleNodes(war, options.factionId);
        const divisions = war.divisions.filter(d => d.atNode === node.id && (d.factionId === options.factionId || (seen.has(node.id) && d.generals.length > 0)));
        for (const division of divisions) {
          const own = division.factionId === options.factionId;
          const b = button(own ? `Select division ${division.id}` : 'Enemy division present', !own, () => { selectedDivision = division.id; render(); }); info.appendChild(b);
        }
      }
      const division = war.divisions.find(d => d.id === selectedDivision);
      if (division) for (const id of division.generals) {
        const g = war.generals.find(x => x.id === id); if (!g) continue;
        const row = document.createElement('p'); row.textContent = `${g.name}: HP ${g.hp}/${g.maxHp}, troops ${g.troops.length}/${g.capacity}`; info.appendChild(row);
      }
      orders.replaceChildren();
      const legal = war.phase === 'orders' && !!division && division.factionId === options.factionId;
      const destinations = division ? adjacentNodeIds(war, division.atNode) : [];
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Adjacent march target');
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose adjacent node'; select.append(placeholder);
      for (const id of destinations) { const n = war.nodes.find(x => x.id === id); const option = document.createElement('option'); option.value = id; option.textContent = n?.name ?? id; select.append(option); }
      select.disabled = !legal || !destinations.length; orders.appendChild(select);
      orders.appendChild(button('March', !legal || !select.value, () => { const intent = division && orderIntent(war, options.factionId, division.id, 'march', select.value); if (intent) options.onOrder(intent); }));
      select.addEventListener('change', () => { const march = orders.querySelector('button'); if (march) march.disabled = !legal || !select.value; });
      for (const type of ['search', 'rest', 'hold'] as const) orders.appendChild(button(type[0]!.toUpperCase() + type.slice(1), !legal, () => { const intent = division && selectedDivision === division.id ? orderIntent(war, options.factionId, division.id, type) : null; if (intent) options.onOrder(intent); }));
      orders.appendChild(button('End turn', war.phase !== 'orders', () => { if (war.phase === 'orders') options.onEndTurn(); }, true));
    }
    redraw(); render();
    return { update(next) { if (destroyed) return; war = next; render(); }, destroy };
  } catch (error) {
    failure = error;
    try { destroy(); } catch { /* preserve initialization error */ }
    throw failure;
  }
}
