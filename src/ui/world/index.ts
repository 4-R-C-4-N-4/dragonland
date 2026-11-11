import { Application } from 'pixi.js';
import type { Division, WorldOrder, War } from '../../world/types';
import { queuedOrders } from '../../world/engine';
import { musterOf } from '../../world/muster';
import { maxMpOf, mpOf } from '../../world/mp';
import { drawWorldMap, loadWorldMapArt } from '../../render/worldMap';
import {
  actionBlocker, adjacentNodeIds, adoptionTarget, castleLossEndsWar, defaultDivision, divisionName, enemyForce, garrisonStatus, nodeSummary, orderIntent, orderLabel,
  turnReport, undefendedCastles,
} from './presentation';
import { visibleNodes } from '../../ai/strategy';
import { getGameData } from '../../data';
import './world.css';

export interface GarrisonIntent { type: 'leave' | 'join'; division: string; general: string }
export interface WorldMapSelection { node: string | null; division: string | null }
export interface WorldMapOptions {
  war: War;
  factionId: string;
  onOrder: (order: WorldOrder) => void;
  onEndTurn: () => void;
  onGarrison?: (intent: GarrisonIntent) => void;
  /** Withdraw a division's queued order; the controller owns the mutation. */
  onCancelOrder?: (divisionId: string) => void;
  /** Adopt a captive into a division; the controller owns the mutation. */
  onAdopt?: (captiveId: string, divisionId: string) => void;
  /** Restores the previous selection after a remount (e.g. across turns). */
  selection?: WorldMapSelection;
  onSelectionChange?: (selection: WorldMapSelection) => void;
}
export interface WorldMapHandle { update(war: War): void; destroy(): void }

const ACTION_HELP: Record<'search' | 'rest' | 'hold', string> = {
  search: 'Spend the turn hunting wild troops to recruit.',
  rest: 'Heal a quarter of HP and refill MP. Towns replace lost troops (30 a week); castles also recruit new ones up to your command (60 a week).',
  hold: 'Stay put and defend this node.',
};

function forceText(f: { generals: number; troops: number }): string {
  return `${f.generals} general${f.generals === 1 ? '' : 's'} with ${f.troops} troops`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mounts the overworld: a Pixi map plus a command sidebar. This widget never changes the
 * supplied War; every change is an intent the controller applies before calling update().
 */
export async function mountWorldMap(root: HTMLElement, options: WorldMapOptions): Promise<WorldMapHandle> {
  const { factionId } = options;
  let war = options.war, destroyed = false, confirmingEnd = false;
  let selectedNode: string | null = options.selection?.node ?? null;
  let selectedDivision: string | null = options.selection?.division ?? null;
  const cleanups: (() => void)[] = [];
  let failure: unknown;
  const shell = el('section', 'dl-world-map');
  const stage = el('div', 'dl-world-map__stage');
  const canvasWrap = el('div', 'dl-world-map__canvas');
  const legend = buildLegend();
  const side = el('aside', 'dl-world-map__side dl-panel');
  side.setAttribute('aria-label', 'Orders');
  shell.append(stage, side); stage.append(canvasWrap, legend); root.appendChild(shell);
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
    // Map art is decoration: a failed load must not stop the campaign.
    try { await loadWorldMapArt(); } catch { /* fall back to the plain plate */ }
    if (destroyed) { app.destroy(true, { children: true }); return { update() {}, destroy }; }
    canvasWrap.appendChild(app.canvas);

    const ownDivisions = () => war.divisions.filter(d => d.factionId === factionId && d.generals.length > 0).sort((a, b) => a.id.localeCompare(b.id));
    const ownOrders = () => { const ids = new Set(ownDivisions().map(d => d.id)); return queuedOrders(war).filter(o => ids.has(o.division)); };
    const currentDivision = () => ownDivisions().find(d => d.id === selectedDivision);
    const canOrder = () => war.phase === 'orders';
    const nodeName = (id: string) => war.nodes.find(n => n.id === id)?.name ?? id;
    const targets = (): Set<string> => { const d = currentDivision(); return new Set(d && canOrder() ? adjacentNodeIds(war, d.atNode) : []); };

    function settleSelection(): void {
      if (selectedNode && !war.nodes.some(n => n.id === selectedNode)) selectedNode = null;
      if (selectedDivision && !currentDivision()) selectedDivision = null;
      const tracked = currentDivision(); if (tracked) selectedNode = tracked.atNode;
      // Nothing chosen yet: start on the hero's division so the first click can be a march.
      if (!selectedDivision && !selectedNode) {
        const d = defaultDivision(war, factionId);
        if (d) { selectedDivision = d.id; selectedNode = d.atNode; }
      }
    }
    function changed(): void {
      options.onSelectionChange?.({ node: selectedNode, division: selectedDivision });
      render();
    }
    function selectDivision(id: string): void {
      const d = ownDivisions().find(x => x.id === id); if (!d) return;
      selectedDivision = d.id; selectedNode = d.atNode; changed();
    }
    function issue(intent: WorldOrder | null): void {
      if (!intent) return;
      confirmingEnd = false;
      options.onOrder(intent);
      render();
    }
    function clickNode(id: string): void {
      const d = currentDivision();
      if (d && targets().has(id)) { issue(orderIntent(war, factionId, d.id, 'march', id)); return; }
      const here = ownDivisions().filter(x => x.atNode === id);
      if (here.length) {
        // Repeated clicks cycle through several of your divisions on one node.
        const next = here[(here.findIndex(x => x.id === selectedDivision) + 1) % here.length]!;
        selectDivision(next.id); return;
      }
      selectedNode = id; selectedDivision = null; changed();
    }

    const view = () => ({ factionId, selectedNode, selectedDivision, targets: targets(), orders: ownOrders(), onNode: clickNode, onDivision: selectDivision });
    const redraw = () => drawWorldMap(app.stage, war, view(), app.renderer.width, app.renderer.height);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : undefined;
    resize?.observe(canvasWrap); if (resize) cleanups.push(() => resize.disconnect());

    function button(label: string, action: () => void, opts: { key: string; disabled?: boolean; primary?: boolean; pressed?: boolean; detail?: string } ): HTMLButtonElement {
      const b = el('button');
      b.type = 'button'; b.dataset.key = opts.key; b.disabled = !!opts.disabled;
      if (opts.primary) b.classList.add('dl-primary');
      if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
      b.append(el('span', 'dl-world-map__btn-label', label));
      if (opts.detail) b.append(el('small', 'dl-world-map__btn-detail', opts.detail));
      b.addEventListener('click', action);
      return b;
    }
    function section(title: string, className: string): HTMLElement {
      const s = el('section', `dl-world-map__section ${className}`);
      s.append(el('h3', undefined, title));
      return s;
    }

    /** One-click fix: detach the last non-hero general of a division still standing on the castle. */
    function quickLeaveButtons(undefended: { id: string; name: string }[]): HTMLButtonElement[] {
      const out: HTMLButtonElement[] = [];
      for (const castle of undefended) {
        const d = ownDivisions().find(x => x.atNode === castle.id && x.generals.length > 1);
        const gid = d && [...d.generals].reverse().find(id => !war.generals.find(g => g.id === id)?.isHero);
        const g = gid && war.generals.find(x => x.id === gid);
        if (d && g && options.onGarrison) out.push(button(`Leave ${g.name} to hold ${castle.name}`, () => {
          confirmingEnd = false;
          try { options.onGarrison?.({ type: 'leave', division: d.id, general: g.id }); } catch { /* reported by the controller */ }
        }, { key: `quick-leave-${castle.id}`, detail: `${g.troops.length} troops stay with ${g.name}; ${d.generals.filter(id => id !== g.id).reduce((n, id) => n + (war.generals.find(x => x.id === id)?.troops.length ?? 0), 0)} troops remain in the division. Rejoin them here to combine forces again.` }));
      }
      return out;
    }

    function renderTurnBar(orders: WorldOrder[]): HTMLElement {
      const bar = el('div', 'dl-world-map__turn');
      const undefended = undefendedCastles(war, factionId, orders);
      if (!canOrder()) {
        bar.append(el('p', 'dl-world-map__hint', 'Orders are closed while the turn resolves.'));
        return bar;
      }
      if (confirmingEnd && undefended.length) {
        const box = el('div', 'dl-world-map__confirm');
        box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-label', 'Confirm end turn');
        box.append(el('p', undefined, `${undefended.map(n => n.name).join(', ')} will have no defenders. Any enemy that walks in takes it${castleLossEndsWar(war) ? ', and holding no castle loses the war' : ': castles are where you recruit new troops'}.`));
        const actions = el('div', 'dl-world-map__row');
        for (const b of quickLeaveButtons(undefended)) actions.append(b);
        actions.append(
          button('End turn anyway', () => { confirmingEnd = false; options.onEndTurn(); }, { key: 'end-confirm', primary: true }),
          button('Keep giving orders', () => { confirmingEnd = false; render(); }, { key: 'end-cancel' }),
        );
        box.append(actions); bar.append(box);
        return bar;
      }
      bar.append(button(`End turn ${war.turn}`, () => {
        if (!canOrder()) return;
        // Castles are where troops are recruited, so leaving one empty always asks first.
        if (undefended.length) { confirmingEnd = true; render(); return; }
        options.onEndTurn();
      }, { key: 'end-turn', primary: true }));
      if (undefended.length) {
        const warn = el('div', 'dl-world-map__warning');
        warn.setAttribute('role', 'status');
        warn.append(el('p', undefined, `${undefended.map(n => n.name).join(', ')} will be left empty: an enemy that walks in takes it${castleLossEndsWar(war) ? ', and holding no castle loses the war' : ' and with it your recruiting'}. Leave a general to hold it, or keep a division there.`));
        for (const b of quickLeaveButtons(undefended)) warn.append(b);
        bar.append(warn);
      }
      return bar;
    }

    function renderDivisionList(orders: WorldOrder[]): HTMLElement {
      const s = section('Your divisions', 'dl-world-map__divisions');
      const members = war.generals.filter(g => g.factionId === factionId && g.hp > 0 && !war.factions.some(f => f.captives.includes(g.id)));
      const total = members.reduce((n, g) => n + g.troops.length, 0);
      const field = members.filter(g => ownDivisions().some(d => d.generals.includes(g.id))).reduce((n, g) => n + g.troops.length, 0);
      s.append(el('p', 'dl-world-map__force-totals', `${total} troops total · ${field} in divisions · ${total - field} stationed`));
      for (const d of ownDivisions()) {
        const troops = d.generals.reduce((n, id) => n + (war.generals.find(g => g.id === id)?.troops.length ?? 0), 0);
        s.append(button(divisionName(war, d), () => selectDivision(d.id), {
          key: `division-${d.id}`, pressed: d.id === selectedDivision,
          detail: `${nodeName(d.atNode)} · ${d.generals.length} general${d.generals.length === 1 ? '' : 's'} · ${troops} troops — ${orderLabel(war, orders.find(o => o.division === d.id))}`,
        }));
      }
      if (!ownDivisions().length) s.append(el('p', 'dl-world-map__hint', 'You have no divisions in the field.'));
      const nameOf = (id: string) => war.generals.find(g => g.id === id)?.name ?? id;
      for (const n of war.nodes.filter(x => x.owner === factionId)) {
        const { defenders, idle } = garrisonStatus(war, n.id, factionId);
        if (!defenders.length && !idle.length) continue;
        const parts = [defenders.length ? `defending: ${defenders.map(nameOf).join(', ')}` : '', idle.length ? `not defending: ${idle.map(nameOf).join(', ')}` : ''].filter(Boolean);
        s.append(button(`${n.name} ${n.kind === 'castle' ? 'garrison' : 'stationed'}`, () => { selectedNode = n.id; selectedDivision = null; changed(); }, {
          key: `garrison-${n.id}`, pressed: selectedNode === n.id && !selectedDivision, detail: parts.join(' · '),
        }));
      }
      return s;
    }

    /** A general's stats with an optional compact action on the same line. */
    /** `pooled`: the general draws from its division's pool, so show its command, not its holdings. */
    function generalRow(id: string, tag?: string, action?: HTMLButtonElement, pooled = false): HTMLElement | null {
      const g = war.generals.find(x => x.id === id); if (!g) return null;
      const row = el('div', 'dl-world-map__general');
      const text = el('span');
      if (tag) text.append(el('span', 'dl-world-map__tag', tag));
      const kind = getGameData().generalById.get(g.generalId)?.name;
      text.append(el('strong', undefined, g.name + (g.isHero ? ' (hero)' : '')));
      if (kind) text.append(document.createTextNode(` · ${kind}`));
      // Stats on their own line so they never wrap mid-number beside the action button.
      text.append(el('small', 'dl-world-map__stats', `HP ${Math.round(g.hp)}/${g.maxHp} · MP ${Math.floor(mpOf(g))}/${maxMpOf(g)} · ${pooled ? `leads up to ${g.capacity}` : `${g.troops.length} troops`}${g.injuredTurns ? ` · injured ${g.injuredTurns}` : ''}`));
      row.append(text);
      if (action) { action.classList.add('dl-world-map__small'); row.append(action); }
      return row;
    }

    function renderDivisionDetail(d: Division, orders: WorldOrder[]): HTMLElement {
      const node = war.nodes.find(n => n.id === d.atNode);
      const s = section(divisionName(war, d), 'dl-world-map__detail');
      if (node) s.append(el('p', 'dl-world-map__hint', `At ${node.name} — ${nodeSummary(war, node, factionId)}`));

      const order = orders.find(o => o.division === d.id);
      const current = el('div', 'dl-world-map__current');
      current.append(el('span', undefined, `This turn: ${orderLabel(war, order)}`));
      if (order && canOrder() && options.onCancelOrder) current.append(button('Cancel', () => { confirmingEnd = false; options.onCancelOrder!(d.id); render(); }, { key: 'cancel-order' }));
      s.append(current);

      if (canOrder()) {
        s.append(el('p', 'dl-world-map__hint', 'Click a gold-ringed node on the map to march there, or choose below.'));
        const ours = d.generals.reduce((n, gid) => n + (war.generals.find(g => g.id === gid)?.troops.length ?? 0), 0);
        for (const id of adjacentNodeIds(war, d.atNode)) {
          const target = war.nodes.find(n => n.id === id); if (!target) continue;
          const foe = enemyForce(war, id, factionId);
          const odds = foe ? ` · ${forceText(foe)} there vs your ${ours}${foe.troops > ours ? ' — outnumbered' : ''}` : '';
          s.append(button(`March to ${target.name}`, () => issue(orderIntent(war, factionId, d.id, 'march', id)), {
            key: `march-${id}`, pressed: order?.type === 'march' && order.toNode === id, detail: nodeSummary(war, target, factionId) + odds,
          }));
        }
        for (const type of ['search', 'rest', 'hold'] as const) {
          const blocker = type === 'hold' ? null : actionBlocker(war, d, type);
          s.append(button(type[0]!.toUpperCase() + type.slice(1), () => issue(orderIntent(war, factionId, d.id, type)), {
            key: `action-${type}`, disabled: !!blocker, pressed: order?.type === type, detail: blocker ?? ACTION_HELP[type],
          }));
        }
      }

      // Troops belong to the division; any general can lead them (chosen before each fight).
      const pool = d.generals.flatMap(id => war.generals.find(g => g.id === id)?.troops ?? []);
      const kinds = new Map<string, number>();
      for (const t of pool) kinds.set(t.unitId, (kinds.get(t.unitId) ?? 0) + 1);
      const muster = musterOf(war, d);
      s.append(el('h4', undefined, `Troops (${pool.length}${muster > pool.length ? ` of ${muster}: rest in a castle or town to refill` : ''})`));
      s.append(el('p', 'dl-world-map__pool', [...kinds].map(([u, n]) => `${n} ${getGameData().unitById.get(u)?.name ?? u}`).join(' · ') || 'No troops.'));
      s.append(el('h4', undefined, 'Generals'));
      const holdable = canOrder() && node && node.owner === factionId && (node.kind === 'castle' || node.kind === 'town');
      for (const id of d.generals) {
        const g = war.generals.find(x => x.id === id); if (!g) continue;
        const leave = holdable && d.generals.length > 1 ? button(node!.kind === 'castle' ? 'Leave to defend' : 'Leave here', () => {
          try { options.onGarrison?.({ type: 'leave', division: d.id, general: g.id }); } catch { /* reported by the controller */ }
        }, { key: `leave-${g.id}` }) : undefined;
        leave?.setAttribute('aria-label', node?.kind === 'castle' ? `Leave ${g.name} to defend ${node.name}` : `Leave ${g.name} stationed in ${node?.name ?? 'this node'}`);
        const row = generalRow(id, undefined, leave, true); if (row) s.append(row);
      }
      const stationed = node ? garrisonStatus(war, node.id, factionId) : { defenders: [], idle: [] };
      for (const id of [...stationed.defenders, ...stationed.idle]) {
        const g = war.generals.find(x => x.id === id)!;
        const join = canOrder() ? button('Take along', () => {
          try { options.onGarrison?.({ type: 'join', division: d.id, general: g.id }); } catch { /* reported by the controller */ }
        }, { key: `join-${g.id}` }) : undefined;
        join?.setAttribute('aria-label', `Take ${g.name} along`);
        const row = generalRow(id, stationed.defenders.includes(id) ? 'garrison' : 'not defending', join); if (row) s.append(row);
      }
      // Only castle garrisons fight: a town is taken by any enemy that walks in (movement.ts).
      if (holdable && d.generals.length > 1) s.append(el('p', 'dl-world-map__hint', node!.kind === 'castle'
        ? `A healthy general left here defends ${node!.name} while the division marches on.`
        : `Generals left in a town stay there, but only castle garrisons fight: an enemy that walks into ${node!.name} still takes it.`));
      return s;
    }

    function renderNodeDetail(id: string): HTMLElement | null {
      const node = war.nodes.find(n => n.id === id); if (!node) return null;
      const s = section(node.name, 'dl-world-map__detail');
      s.append(el('p', 'dl-world-map__hint', nodeSummary(war, node, factionId)));
      const seen = visibleNodes(war, factionId).has(node.id);
      const foe = enemyForce(war, node.id, factionId);
      if (foe) s.append(el('p', 'dl-world-map__enemy', `Enemy here: ${forceText(foe)}.`));
      for (const d of war.divisions.filter(x => x.atNode === node.id && x.generals.length > 0)) {
        if (d.factionId === factionId) s.append(button(`Select ${divisionName(war, d)}`, () => selectDivision(d.id), { key: `division-at-${d.id}` }));
        else if (seen) s.append(el('p', 'dl-world-map__enemy', `${war.factions.find(f => f.id === d.factionId)?.name ?? 'Enemy'}: ${divisionName(war, d)}, ${d.generals.length} general${d.generals.length === 1 ? '' : 's'}`));
      }
      if (node.owner === factionId) {
        const { defenders, idle } = garrisonStatus(war, node.id, factionId);
        for (const gid of defenders) { const row = generalRow(gid, 'garrison'); if (row) s.append(row); }
        for (const gid of idle) { const row = generalRow(gid, 'not defending'); if (row) s.append(row); }
      }
      if (!seen) s.append(el('p', 'dl-world-map__hint', 'Out of sight: you cannot see who is here.'));
      return s;
    }

    /** Captured rivals, each with an Adopt button into the selected (or first open) division. */
    function renderPrisoners(): HTMLElement | null {
      const me = war.factions.find(f => f.id === factionId);
      if (!me?.captives.length) return null;
      const s = section('Prisoners', 'dl-world-map__prisoners');
      const target = adoptionTarget(war, factionId, selectedDivision);
      const canAdopt = (war.phase === 'orders' || war.phase === 'admin') && !!options.onAdopt;
      for (const id of me.captives) {
        const g = war.generals.find(x => x.id === id); if (!g) continue;
        const profile = getGameData().generalById.get(g.generalId);
        const row = generalRow(id, profile?.name ?? g.generalId);
        if (row) s.append(row);
        const into = target.division ? war.divisions.find(d => d.id === target.division) : undefined;
        s.append(button(`Adopt ${g.name}`, () => {
          if (!target.division) return;
          try { options.onAdopt?.(id, target.division); } catch { /* reported by the controller */ }
          render();
        }, { key: `adopt-${id}`, disabled: !canAdopt || !target.division, detail: target.division === null ? target.reason : `Joins ${divisionName(war, into!)} with ${g.troops.length} troops of their own` }));
      }
      return s;
    }

    /** Shown after a resolved turn; a reloaded save carries no events, so it shows nothing rather than a false "quiet turn". */
    function renderReport(): HTMLElement | null {
      if (war.turn <= 1 || !war.events.length) return null;
      const s = section(`Turn ${war.turn - 1} report`, 'dl-world-map__report');
      const lines = turnReport(war, factionId);
      if (!lines.length) { s.append(el('p', 'dl-world-map__hint', 'Nothing you could see happened.')); return s; }
      const list = el('ul');
      for (const line of lines) list.append(el('li', undefined, line));
      s.append(list);
      return s;
    }

    function render(): void {
      if (destroyed) return;
      settleSelection();
      // Keep keyboard focus on the same control across re-renders.
      const focusKey = (document.activeElement instanceof HTMLElement && side.contains(document.activeElement)) ? document.activeElement.dataset.key : undefined;
      redraw();
      const orders = ownOrders();
      const d = currentDivision();
      const detail = d ? renderDivisionDetail(d, orders) : selectedNode ? renderNodeDetail(selectedNode) : null;
      side.replaceChildren(...[renderTurnBar(orders), renderReport(), renderPrisoners(), renderDivisionList(orders), detail].filter((x): x is HTMLElement => !!x));
      if (focusKey) {
        const target = [...side.querySelectorAll<HTMLElement>('[data-key]')].find(x => x.dataset.key === focusKey);
        // Never fall back onto End turn: one stray Enter there is irreversible.
        const fallback = side.querySelector<HTMLElement>('[data-key="cancel-order"]')
          ?? [...side.querySelectorAll<HTMLButtonElement>('button[data-key]')].find(b => !b.disabled && !b.dataset.key!.startsWith('end-'));
        (target && !(target as HTMLButtonElement).disabled ? target : fallback)?.focus();
      }
    }
    render();
    return { update(next) { if (destroyed) return; war = next; confirmingEnd = false; render(); }, destroy };
  } catch (error) {
    failure = error;
    try { destroy(); } catch { /* preserve initialization error */ }
    throw failure;
  }
}

function buildLegend(): HTMLElement {
  const legend = el('div', 'dl-world-map__legend');
  legend.setAttribute('aria-label', 'Map legend');
  const item = (cls: string, label: string) => { const s = el('span', 'dl-world-map__legend-item'); s.append(el('i', cls), document.createTextNode(label)); return s; };
  legend.append(
    item('lg-shape lg-castle', 'Castle'), item('lg-shape lg-town', 'Town'), item('lg-shape lg-village', 'Village'), item('lg-shape lg-lair', 'Lair'),
    item('lg-swatch lg-own', 'Yours'), item('lg-swatch lg-enemy', 'Enemy'), item('lg-swatch lg-neutral', 'Unclaimed'),
    item('lg-banner lg-own', 'Your division'), item('lg-banner lg-enemy', 'Enemy division'),
    item('lg-arrow', 'Queued march'), item('lg-ring', 'Can march here'),
  );
  legend.append(el('small', 'dl-world-map__disclaimer', 'Provisional map art'));
  return legend;
}
