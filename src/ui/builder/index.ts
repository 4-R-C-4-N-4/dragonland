// Plain-DOM, composition-first army builder (Ivy feedback: pick-lists for 100 troops don't work;
// define counts per squad and let the roster auto-fill; pin specific troops only when you care).
// Avoids full re-renders: only the changed squad card / summary column / roster-drawer row update.
import '../common/theme.css';
import type { GameData } from '../../data';
import type { ClassId, Disposition, Loadout, Squad, Troop } from '../../data/schemas';
import type { Store } from '../../persist/store';
import {
  addUnitRow,
  availableByUnit,
  companyComposition,
  pinTroop,
  removeUnitRow,
  resolveLoadout,
  setDisposition,
  setSquadColor,
  setTeamColor,
  setUnitCount,
  unpinTroop,
  validateLoadout,
  type ResolveResult,
} from './logic';
import { DEFAULT_PLAYER_COLOR, TEAM_PALETTE, deriveSquadColor } from '../../data/colors';
import './builder.css';

export interface MountBuilderOptions {
  data: GameData;
  store: Store;
  onStartBattle?: (loadout: Loadout) => void;
  /** Loadout to open with (e.g. the one just used in battle); defaults to the first saved one. */
  initialLoadoutId?: string;
}

export interface MountedBuilder {
  destroy(): void;
}

let idSeq = 0;
function freshId(prefix: string): string {
  idSeq++;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

function blankLoadout(): Loadout {
  return {
    id: freshId('loadout'),
    name: 'New Army',
    generalId: 'paladin',
    squads: [{ id: freshId('squad'), name: 'Squad 1', troopIds: [], disposition: 'mixed', composition: {} }],
  };
}

const DISPOSITIONS: { id: Disposition; label: string; icon: string; tip: string }[] = [
  { id: 'fierce', label: 'Fierce', icon: '⚔', tip: 'Chases and presses the attack; holds nothing back.' },
  { id: 'mixed', label: 'Mixed', icon: '⚖', tip: 'Balances holding formation with pursuing kills.' },
  { id: 'guard', label: 'Guard', icon: '🛡', tip: 'Stays near its post, does not chase far.' },
];

const LINE_SHAPE: Record<string, string> = { A: '▲', M: '●', Z: '■' };

const AUTO_SAVE_DEBOUNCE_MS = 500;

export function mountBuilder(root: HTMLElement, opts: MountBuilderOptions): MountedBuilder {
  const { data, store } = opts;
  const MAX_SQUADS = data.constants.MAX_SQUADS;
  const MAX_COMPANY = data.constants.MAX_COMPANY;
  const MIN_SQUAD = data.constants.MIN_SQUAD;

  // ---- state ----
  let roster: Troop[] = store.getRoster();
  let loadouts: Loadout[] = store.listLoadouts();
  let notice = '';
  let loadout: Loadout = blankLoadout();
  let lastResolve: ResolveResult | null = null;

  function loadInitial(): void {
    const initial = (opts.initialLoadoutId && store.getLoadout(opts.initialLoadoutId)) || loadouts[0];
    if (initial) {
      const resolved = resolveLoadout(initial, roster, data);
      loadout = resolved.loadout;
      lastResolve = resolved;
      const bits: string[] = [];
      if (resolved.replaced > 0) bits.push(`${resolved.replaced} fallen troop(s) replaced from the roster.`);
      if (resolved.shortfalls.length > 0) bits.push(`Some squads can't be fully filled — not enough matching troops.`);
      notice = bits.join(' ');
      if (resolved.replaced > 0) store.saveLoadout(loadout);
    }
  }
  loadInitial();

  let drawerOpen = false;
  let drawerSearch = '';
  let drawerClass: ClassId | 'all' = 'all';
  let drawerLine: 'A' | 'M' | 'Z' | 'all' = 'all';
  let drawerStage: 1 | 2 | 'all' = 'all';
  let colorPopoverFor: { kind: 'team' } | { kind: 'squad'; squadId: string } | null = null;

  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  root.innerHTML = '';
  root.classList.add('dl-builder');

  const topbarEl = document.createElement('div');
  const noticeEl = document.createElement('div');
  const mainEl = document.createElement('div');
  mainEl.className = 'dl-main2';
  const squadsGridEl = document.createElement('div');
  squadsGridEl.className = 'dl-squads-grid';
  const summaryEl = document.createElement('aside');
  summaryEl.className = 'dl-summary';
  mainEl.appendChild(squadsGridEl);
  mainEl.appendChild(summaryEl);
  const drawerEl = document.createElement('div');
  drawerEl.className = 'dl-drawer';

  root.appendChild(topbarEl);
  root.appendChild(noticeEl);
  root.appendChild(mainEl);
  root.appendChild(drawerEl);

  // ---- helpers ----
  function rosterById(): Map<string, Troop> {
    return new Map(roster.map((t) => [t.id, t] as const));
  }

  function resolved(): ResolveResult {
    return resolveLoadout(loadout, roster, data);
  }

  function totalAssigned(): number {
    return loadout.squads.reduce((n, s) => n + Object.values(s.composition ?? {}).reduce((a, b) => a + b, 0), 0);
  }

  function mutate(next: Loadout, opts2: { skipResolve?: boolean } = {}): void {
    loadout = opts2.skipResolve ? next : resolveLoadout(next, roster, data).loadout;
    scheduleAutoSave();
    renderAll();
  }

  function scheduleAutoSave(): void {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (loadouts.some((l) => l.id === loadout.id)) {
        store.saveLoadout(loadout);
      }
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  function classSwatch(classId: ClassId | undefined): string {
    const color = classId ? data.classById.get(classId)?.color ?? '#888' : '#888';
    return `<span class="dl-class-swatch" style="background:${color}"></span>`;
  }

  function colorSwatchBtn(color: string, extraClass = ''): string {
    return `<span class="dl-color-swatch ${extraClass}" style="background:${color}"></span>`;
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  // ---- top bar ----
  function renderTopbar(): void {
    topbarEl.className = 'dl-topbar';
    topbarEl.innerHTML = `
      <h1 class="dl-title">Army Builder</h1>
      <div class="dl-loadout-controls">
        <select id="dl-loadout-select">
          <option value="">— New Army —</option>
          ${loadouts.map((l) => `<option value="${l.id}" ${l.id === loadout.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
        <button id="dl-save">Save as…</button>
        <button id="dl-rename">Rename</button>
        <button id="dl-duplicate">Duplicate</button>
        <button id="dl-delete">Delete</button>
        <button id="dl-new">New</button>
        <button id="dl-suggest" class="dl-suggest-btn">✨ Suggested army</button>
        <button id="dl-open-drawer">Pick specific troops…</button>
      </div>
    `;
    topbarEl.querySelector<HTMLSelectElement>('#dl-loadout-select')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (!id) {
        loadout = blankLoadout();
      } else {
        const found = store.getLoadout(id);
        if (found) {
          const r = resolveLoadout(found, roster, data);
          loadout = r.loadout;
          lastResolve = r;
          notice = r.replaced > 0 ? `${r.replaced} fallen troop(s) replaced from the roster.` : '';
        }
      }
      renderAll();
    });
    topbarEl.querySelector('#dl-save')?.addEventListener('click', () => {
      const name = window.prompt('Save army as', loadout.name);
      if (!name) return;
      const copy: Loadout = { ...loadout, id: freshId('loadout'), name };
      store.saveLoadout(copy);
      loadouts = store.listLoadouts();
      loadout = copy;
      notice = 'Saved.';
      renderAll();
    });
    topbarEl.querySelector('#dl-rename')?.addEventListener('click', () => {
      const name = window.prompt('Rename army', loadout.name);
      if (name) {
        loadout = { ...loadout, name };
        if (loadouts.some((l) => l.id === loadout.id)) {
          store.renameLoadout(loadout.id, name);
          loadouts = store.listLoadouts();
        }
      }
      renderAll();
    });
    topbarEl.querySelector('#dl-duplicate')?.addEventListener('click', () => {
      store.saveLoadout(loadout);
      const copy = store.duplicateLoadout(loadout.id);
      loadouts = store.listLoadouts();
      if (copy) loadout = copy;
      renderAll();
    });
    topbarEl.querySelector('#dl-delete')?.addEventListener('click', () => {
      if (loadouts.some((l) => l.id === loadout.id)) {
        store.deleteLoadout(loadout.id);
        loadouts = store.listLoadouts();
      }
      loadout = loadouts[0] ?? blankLoadout();
      renderAll();
    });
    topbarEl.querySelector('#dl-new')?.addEventListener('click', () => {
      loadout = blankLoadout();
      notice = '';
      renderAll();
    });
    topbarEl.querySelector('#dl-suggest')?.addEventListener('click', () => {
      loadout = suggestedArmy();
      renderAll();
    });
    topbarEl.querySelector('#dl-open-drawer')?.addEventListener('click', () => {
      drawerOpen = true;
      renderDrawer();
    });
  }

  /** Builds a sensible 4-squad, ~100-troop composition from whatever units exist in the roster. */
  function suggestedArmy(): Loadout {
    const byUnit = new Map<string, number>();
    for (const t of roster) byUnit.set(t.unitId, (byUnit.get(t.unitId) ?? 0) + 1);
    const nonStage3 = data.units.filter((u) => u.stage !== 3 && (byUnit.get(u.id) ?? 0) > 0);
    const ranged = nonStage3.filter((u) => u.attackRange > data.constants.RANGED_THRESHOLD);
    const melee = nonStage3.filter((u) => u.attackRange <= data.constants.RANGED_THRESHOLD);
    const used = new Set<string>();
    const take = (list: typeof nonStage3, n: number) => {
      const picked = list.filter((u) => !used.has(u.id)).slice(0, n);
      for (const u of picked) used.add(u.id);
      return picked;
    };
    const squadFrom = (name: string, disposition: Disposition, units: { unitId: string; count: number }[]): Squad => ({
      id: freshId('squad'),
      name,
      disposition,
      troopIds: [],
      composition: Object.fromEntries(units.filter((u) => u.count > 0).map((u) => [u.unitId, u.count])),
    });
    const r = take(ranged, 2);
    const m1 = take(melee, 2);
    const m2 = take(melee, 2);
    const rest = take(nonStage3, 4);
    const squads = [
      squadFrom('Archers', 'mixed', r.map((u) => ({ unitId: u.id, count: 13 }))),
      squadFrom('Vanguard', 'fierce', m1.map((u) => ({ unitId: u.id, count: 13 }))),
      squadFrom('Shieldwall', 'guard', m2.map((u) => ({ unitId: u.id, count: 13 }))),
      squadFrom('Reserves', 'fierce', rest.map((u) => ({ unitId: u.id, count: 4 }))),
    ].filter((s) => Object.keys(s.composition ?? {}).length > 0);
    const next: Loadout = { ...loadout, squads: squads.length ? squads : loadout.squads };
    return resolveLoadout(next, roster, data).loadout;
  }

  // ---- notice ----
  function renderNotice(): void {
    noticeEl.innerHTML = notice
      ? `<div class="dl-notice">${escapeHtml(notice)} <button id="dl-dismiss-notice" aria-label="Dismiss">✕</button></div>`
      : '';
    noticeEl.querySelector('#dl-dismiss-notice')?.addEventListener('click', () => {
      notice = '';
      renderNotice();
    });
  }

  // ---- squad cards ----
  function renderSquads(): void {
    const r = resolved();
    lastResolve = r;
    squadsGridEl.innerHTML = loadout.squads.map((s) => squadCardHtml(s, r)).join('');
    for (const s of loadout.squads) bindSquadCard(s.id);
  }

  function squadCardHtml(squad: Squad, r: ResolveResult): string {
    const avail = availableByUnit(stripSquadFromAvailability(loadout, squad.id), roster);
    const comp = squad.composition ?? {};
    const total = Object.values(comp).reduce((a, b) => a + b, 0);
    const pinned = new Set(squad.pinned ?? []);
    const byId = rosterById();
    const troops = squad.troopIds.map((id) => byId.get(id)).filter((t): t is Troop => Boolean(t));
    const shortfalls = r.shortfalls.filter((s) => s.squadId === squad.id);
    const squadColor = resolveSquadColor(loadout, loadout.squads.indexOf(squad));

    const rows = Object.entries(comp)
      .filter(([, n]) => n > 0)
      .map(([unitId, n]) => {
        const unit = data.unitById.get(unitId);
        if (!unit) return '';
        const availForUnit = avail[unitId] ?? 0;
        return `
          <div class="dl-comp-row" data-unit-id="${unitId}">
            <span class="dl-unit-glyph" style="color:${data.classById.get(unit.classId)?.color ?? '#888'}">${LINE_SHAPE[unit.line] ?? '?'}</span>
            <span class="dl-unit-name">${escapeHtml(unit.name)} <span class="dl-dim">(stage ${unit.stage})</span></span>
            <button class="dl-step-minus" data-unit-id="${unitId}" aria-label="Decrease">−</button>
            <input type="number" class="dl-count-input" data-unit-id="${unitId}" value="${n}" min="0" max="${MAX_COMPANY}" />
            <button class="dl-step-plus" data-unit-id="${unitId}" aria-label="Increase">+</button>
            <span class="dl-dim dl-avail-hint" title="Unassigned ${escapeHtml(unit.name)}s left in your roster">${Math.max(0, availForUnit - n) ? `+${Math.max(0, availForUnit - n)} left` : 'none left'}</span>
            <button class="dl-remove-row" data-unit-id="${unitId}" aria-label="Remove row">✕</button>
          </div>
        `;
      })
      .join('');

    const addableUnits = data.units.filter((u) => u.stage !== 3 && !(u.id in comp));

    return `
      <div class="dl-panel dl-squad2" data-squad-id="${squad.id}">
        <div class="dl-squad-header2">
          <button class="dl-color-btn" data-squad-id="${squad.id}" title="Squad colour">${colorSwatchBtn(squadColor)}</button>
          <input type="text" class="dl-squad-name" data-squad-id="${squad.id}" value="${escapeHtml(squad.name)}" />
          <span class="dl-squad-count">${total} troops</span>
          <button class="dl-remove-squad" data-squad-id="${squad.id}" ${loadout.squads.length <= 1 ? 'disabled' : ''} title="Remove squad" aria-label="Remove squad">✕</button>
        </div>
        <div class="dl-disposition-switch" data-squad-id="${squad.id}">
          ${DISPOSITIONS.map(
            (d) => `<button class="dl-disp-opt ${squad.disposition === d.id ? 'dl-disp-active' : ''}" data-squad-id="${squad.id}" data-disp="${d.id}" title="${escapeHtml(d.tip)}">${d.icon} ${d.label}</button>`,
          ).join('')}
        </div>
        <div class="dl-comp-rows">${rows || '<p class="dl-dim">No units yet — add one below.</p>'}</div>
        <div class="dl-add-row">
          <select class="dl-add-unit-select" data-squad-id="${squad.id}">
            <option value="">+ Add unit…</option>
            ${addableUnits.map((u) => `<option value="${u.id}">${escapeHtml(u.name)} (${avail[u.id] ?? 0} avail)</option>`).join('')}
          </select>
        </div>
        ${shortfalls.length ? `<p class="dl-shortfall">⚠ Not enough troops: ${shortfalls.map((s) => `${data.unitById.get(s.unitId)?.name ?? s.unitId} ×${s.missing} short`).join(', ')}</p>` : ''}
        <details class="dl-troops-disclosure">
          <summary>Troops (${troops.length})</summary>
          <ul class="dl-squad-troops2">
            ${troops
              .map(
                (t) => `<li data-troop-id="${t.id}">${pinned.has(t.id) ? '📌 ' : ''}${escapeHtml(t.name)} <span class="dl-dim">(${data.unitById.get(t.unitId)?.name ?? '?'})</span>
                  ${pinned.has(t.id) ? `<button class="dl-unpin-troop" data-squad-id="${squad.id}" data-troop-id="${t.id}">Unpin</button>` : `<button class="dl-pin-troop" data-squad-id="${squad.id}" data-troop-id="${t.id}">Pin</button>`}
                </li>`,
              )
              .join('')}
          </ul>
        </details>
      </div>
    `;
  }

  function stripSquadFromAvailability(l: Loadout, squadId: string): Loadout {
    // availableByUnit treats everything in troopIds as assigned; to show "N available" meaning
    // "how many more of this unit could I add to THIS squad", exclude this squad's own troopIds.
    return { ...l, squads: l.squads.map((s) => (s.id === squadId ? { ...s, troopIds: [] } : s)) };
  }

  function resolveSquadColor(l: Loadout, index: number): string {
    const squad = l.squads[index];
    if (squad?.color) return squad.color;
    return deriveSquadColor(l.color ?? DEFAULT_PLAYER_COLOR, index);
  }

  function bindSquadCard(squadId: string): void {
    const card = squadsGridEl.querySelector<HTMLElement>(`.dl-squad2[data-squad-id="${squadId}"]`);
    if (!card) return;

    card.querySelector<HTMLInputElement>('.dl-squad-name')?.addEventListener('change', (e) => {
      const name = (e.target as HTMLInputElement).value;
      mutate({ ...loadout, squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, name } : s)) });
    });

    card.querySelectorAll<HTMLButtonElement>('.dl-disp-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        mutate(setDisposition(loadout, squadId, btn.dataset.disp as Disposition));
      });
    });

    card.querySelector<HTMLButtonElement>('.dl-remove-squad')?.addEventListener('click', () => {
      if (loadout.squads.length <= 1) return;
      mutate({ ...loadout, squads: loadout.squads.filter((s) => s.id !== squadId) });
    });

    card.querySelector<HTMLButtonElement>('.dl-color-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      colorPopoverFor = colorPopoverFor && 'squadId' in colorPopoverFor && colorPopoverFor.squadId === squadId ? null : { kind: 'squad', squadId };
      renderColorPopover(e.currentTarget as HTMLElement);
    });

    card.querySelectorAll<HTMLButtonElement>('.dl-step-minus').forEach((btn) => bindStep(btn, squadId, -1));
    card.querySelectorAll<HTMLButtonElement>('.dl-step-plus').forEach((btn) => bindStep(btn, squadId, 1));

    card.querySelectorAll<HTMLInputElement>('.dl-count-input').forEach((input) => {
      const commit = () => {
        const unitId = input.dataset.unitId!;
        const n = Number(input.value);
        mutate(setUnitCount(loadout, squadId, unitId, Number.isFinite(n) ? n : 0));
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? 1 : -1;
          input.value = String(Math.max(0, Number(input.value) + delta));
          commit();
        }
      });
    });

    card.querySelectorAll<HTMLButtonElement>('.dl-remove-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        mutate(removeUnitRow(loadout, squadId, btn.dataset.unitId!));
      });
    });

    card.querySelector<HTMLSelectElement>('.dl-add-unit-select')?.addEventListener('change', (e) => {
      const unitId = (e.target as HTMLSelectElement).value;
      if (!unitId) return;
      mutate(addUnitRow(loadout, squadId, unitId, 1));
    });

    card.querySelectorAll<HTMLButtonElement>('.dl-pin-troop').forEach((btn) => {
      btn.addEventListener('click', () => {
        mutate(pinTroop(loadout, squadId, btn.dataset.troopId!, roster));
      });
    });
    card.querySelectorAll<HTMLButtonElement>('.dl-unpin-troop').forEach((btn) => {
      btn.addEventListener('click', () => {
        mutate(unpinTroop(loadout, squadId, btn.dataset.troopId!));
      });
    });
  }

  function bindStep(btn: HTMLButtonElement, squadId: string, dir: 1 | -1): void {
    btn.addEventListener('click', (e) => {
      const unitId = btn.dataset.unitId!;
      const step = (e as MouseEvent).shiftKey ? 5 : 1;
      const squad = loadout.squads.find((s) => s.id === squadId);
      const current = squad?.composition?.[unitId] ?? 0;
      mutate(setUnitCount(loadout, squadId, unitId, current + dir * step));
    });
  }

  // ---- colour popover ----
  function renderColorPopover(anchor: HTMLElement): void {
    document.querySelectorAll('.dl-color-popover').forEach((el) => el.remove());
    if (!colorPopoverFor) return;
    const pop = document.createElement('div');
    pop.className = 'dl-color-popover dl-panel';
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.left = `${rect.left}px`;
    pop.style.zIndex = '50';

    const isTeam = colorPopoverFor.kind === 'team';
    const base = loadout.color ?? DEFAULT_PLAYER_COLOR;
    const shades = isTeam ? TEAM_PALETTE : Array.from({ length: 4 }, (_, i) => deriveSquadColor(base, i));

    pop.innerHTML = `
      <div class="dl-color-grid">
        ${shades.map((c) => `<button class="dl-color-option" data-color="${c}" style="background:${c}"></button>`).join('')}
      </div>
      <label class="dl-custom-color">Custom <input type="color" id="dl-custom-color-input" value="${base}" /></label>
      <button id="dl-color-auto">Auto</button>
    `;
    document.body.appendChild(pop);

    pop.querySelectorAll<HTMLButtonElement>('.dl-color-option').forEach((b) => {
      b.addEventListener('click', () => applyColorChoice(b.dataset.color!));
    });
    pop.querySelector<HTMLInputElement>('#dl-custom-color-input')?.addEventListener('input', (e) => {
      applyColorChoice((e.target as HTMLInputElement).value);
    });
    pop.querySelector('#dl-color-auto')?.addEventListener('click', () => applyColorChoice(undefined));

    const closeHandler = (ev: MouseEvent) => {
      if (!pop.contains(ev.target as Node) && ev.target !== anchor) {
        pop.remove();
        colorPopoverFor = null;
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
  }

  function applyColorChoice(color: string | undefined): void {
    if (!colorPopoverFor) return;
    if (colorPopoverFor.kind === 'team') {
      mutate(setTeamColor(loadout, color), { skipResolve: true });
    } else {
      mutate(setSquadColor(loadout, colorPopoverFor.squadId, color), { skipResolve: true });
    }
    document.querySelectorAll('.dl-color-popover').forEach((el) => el.remove());
    colorPopoverFor = null;
  }

  // ---- summary column ----
  function renderSummary(): void {
    const r = resolved();
    const validation = validateLoadout(loadout, roster, data);
    const comp = companyComposition(loadout, roster, data);
    const total = totalAssigned();
    const teamColor = loadout.color ?? DEFAULT_PLAYER_COLOR;

    summaryEl.innerHTML = `
      <div class="dl-panel">
        <label class="dl-general-picker">General:
          <select id="dl-general">
            ${data.generals.map((g) => `<option value="${g.id}" ${g.id === loadout.generalId ? 'selected' : ''}>${g.name} (hp ${g.hp}, ${g.special.name})</option>`).join('')}
          </select>
        </label>
        <button id="dl-team-color-btn" class="dl-team-color-btn">${colorSwatchBtn(teamColor)} Team colour</button>
      </div>
      <div class="dl-panel dl-totals2">
        <strong>Company: ${total} / ${MAX_COMPANY}</strong>
        <div class="dl-bar"><div class="dl-bar-fill" style="width:${Math.min(100, (total / MAX_COMPANY) * 100)}%"></div></div>
        <div class="dl-class-counts">
          ${Object.entries(comp)
            .map(([cid, n]) => `${classSwatch(cid as ClassId)}${cid}: ${n}`)
            .join('  ')}
        </div>
        <div class="dl-squad-chips">
          ${loadout.squads.map((s, i) => `${colorSwatchBtn(resolveSquadColor(loadout, i))} ${escapeHtml(s.name)}`).join('  ')}
        </div>
        <button id="dl-add-squad" ${loadout.squads.length >= MAX_SQUADS ? 'disabled' : ''}>+ Add squad</button>
      </div>
      ${
        validation.errors.length
          ? `<ul class="dl-panel dl-errors">${validation.errors.map((e) => `<li class="dl-error">${escapeHtml(e.message)}</li>`).join('')}</ul>`
          : ''
      }
      ${
        r.shortfalls.length
          ? `<div class="dl-panel dl-warnings">${r.shortfalls.length} unit row(s) can't be fully filled from the roster.</div>`
          : ''
      }
      <button id="dl-start-battle" class="dl-primary dl-start" ${validation.ok ? '' : 'disabled'}>Start battle</button>
      <p class="dl-dim">Min squad size ${MIN_SQUAD}; up to ${MAX_SQUADS} squads.</p>
    `;

    summaryEl.querySelector<HTMLSelectElement>('#dl-general')?.addEventListener('change', (e) => {
      mutate({ ...loadout, generalId: (e.target as HTMLSelectElement).value as Loadout['generalId'] }, { skipResolve: true });
    });
    summaryEl.querySelector('#dl-team-color-btn')?.addEventListener('click', (e) => {
      colorPopoverFor = colorPopoverFor && colorPopoverFor.kind === 'team' ? null : { kind: 'team' };
      renderColorPopover(e.currentTarget as HTMLElement);
    });
    summaryEl.querySelector('#dl-add-squad')?.addEventListener('click', () => {
      if (loadout.squads.length >= MAX_SQUADS) return;
      mutate(
        {
          ...loadout,
          squads: [...loadout.squads, { id: freshId('squad'), name: `Squad ${loadout.squads.length + 1}`, troopIds: [], disposition: 'mixed', composition: {} }],
        },
        { skipResolve: true },
      );
    });
    summaryEl.querySelector('#dl-start-battle')?.addEventListener('click', () => {
      store.saveLoadout(loadout);
      store.setLastComposition(companyComposition(loadout, roster, data));
      opts.onStartBattle?.(loadout);
    });
  }

  // ---- roster drawer ----
  function filteredDrawerRoster(): Troop[] {
    let list = roster.slice();
    if (drawerSearch.trim()) {
      const q = drawerSearch.trim().toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (drawerClass !== 'all') list = list.filter((t) => data.unitById.get(t.unitId)?.classId === drawerClass);
    if (drawerLine !== 'all') list = list.filter((t) => data.unitById.get(t.unitId)?.line === drawerLine);
    if (drawerStage !== 'all') list = list.filter((t) => data.unitById.get(t.unitId)?.stage === drawerStage);
    return list;
  }

  function troopSquadLabel(troopId: string): string {
    const idx = loadout.squads.findIndex((s) => s.troopIds.includes(troopId));
    return idx >= 0 ? loadout.squads[idx]!.name : '';
  }

  function renderDrawer(): void {
    if (!drawerOpen) {
      drawerEl.innerHTML = '';
      drawerEl.classList.remove('dl-drawer-open');
      return;
    }
    drawerEl.classList.add('dl-drawer-open');
    drawerEl.innerHTML = `
      <div class="dl-drawer-inner">
        <div class="dl-drawer-header">
          <strong>Pick specific troops</strong>
          <button id="dl-close-drawer" aria-label="Close">✕</button>
        </div>
        <div class="dl-drawer-filters">
          <input id="dl-drawer-search" type="text" placeholder="Search name…" value="${escapeHtml(drawerSearch)}" />
          <select id="dl-drawer-class">
            <option value="all">All classes</option>
            ${data.classes.map((c) => `<option value="${c.id}" ${drawerClass === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
          <select id="dl-drawer-line">
            <option value="all">All lines</option>
            <option value="A" ${drawerLine === 'A' ? 'selected' : ''}>Line A</option>
            <option value="M" ${drawerLine === 'M' ? 'selected' : ''}>Line M</option>
            <option value="Z" ${drawerLine === 'Z' ? 'selected' : ''}>Line Z</option>
          </select>
          <select id="dl-drawer-stage">
            <option value="all">All stages</option>
            <option value="1" ${drawerStage === 1 ? 'selected' : ''}>Stage 1</option>
            <option value="2" ${drawerStage === 2 ? 'selected' : ''}>Stage 2</option>
          </select>
        </div>
        <ul class="dl-drawer-list" id="dl-drawer-list">${drawerRowsHtml()}</ul>
      </div>
    `;
    drawerEl.querySelector('#dl-close-drawer')?.addEventListener('click', () => {
      drawerOpen = false;
      renderDrawer();
    });
    drawerEl.querySelector<HTMLInputElement>('#dl-drawer-search')?.addEventListener('input', (e) => {
      drawerSearch = (e.target as HTMLInputElement).value;
      renderDrawerListOnly();
    });
    drawerEl.querySelector<HTMLSelectElement>('#dl-drawer-class')?.addEventListener('change', (e) => {
      drawerClass = (e.target as HTMLSelectElement).value as ClassId | 'all';
      renderDrawerListOnly();
    });
    drawerEl.querySelector<HTMLSelectElement>('#dl-drawer-line')?.addEventListener('change', (e) => {
      drawerLine = (e.target as HTMLSelectElement).value as 'A' | 'M' | 'Z' | 'all';
      renderDrawerListOnly();
    });
    drawerEl.querySelector<HTMLSelectElement>('#dl-drawer-stage')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      drawerStage = v === 'all' ? 'all' : (Number(v) as 1 | 2);
      renderDrawerListOnly();
    });
    bindDrawerRows();
  }

  function drawerRowsHtml(): string {
    return filteredDrawerRoster()
      .map((t) => {
        const unit = data.unitById.get(t.unitId);
        const squadLabel = troopSquadLabel(t.id);
        return `
          <li class="dl-drawer-row" data-troop-id="${t.id}">
            <span class="dl-drawer-name">${escapeHtml(t.name)}</span>
            <span class="dl-dim">${unit?.name ?? '?'}</span>
            <span class="dl-dim dl-drawer-squad">${squadLabel ? escapeHtml(squadLabel) : ''}</span>
            <select class="dl-drawer-assign" data-troop-id="${t.id}">
              <option value="">Add to squad…</option>
              ${loadout.squads.map((s, i) => `<option value="${s.id}">${escapeHtml(s.name)} (#${i + 1})</option>`).join('')}
            </select>
          </li>
        `;
      })
      .join('');
  }

  function renderDrawerListOnly(): void {
    // Only the list rebuilds on filter change — preserves scroll on the header/filters row, and
    // avoids a full-app re-render so adds elsewhere don't reset drawer scroll either.
    const list = drawerEl.querySelector<HTMLElement>('#dl-drawer-list');
    if (!list) return;
    const scrollTop = list.scrollTop;
    list.innerHTML = drawerRowsHtml();
    list.scrollTop = scrollTop;
    bindDrawerRows();
  }

  function bindDrawerRows(): void {
    drawerEl.querySelectorAll<HTMLSelectElement>('.dl-drawer-assign').forEach((sel) => {
      sel.addEventListener('change', () => {
        const troopId = sel.dataset.troopId!;
        const squadId = sel.value;
        if (!squadId) return;
        loadout = pinTroop(loadout, squadId, troopId, roster);
        loadout = resolveLoadout(loadout, roster, data).loadout;
        scheduleAutoSave();
        // Patch only this row + the squad grid + summary; the drawer list keeps its scroll.
        const row = drawerEl.querySelector<HTMLElement>(`.dl-drawer-row[data-troop-id="${troopId}"]`);
        if (row) {
          const label = row.querySelector<HTMLElement>('.dl-drawer-squad');
          if (label) label.textContent = troopSquadLabel(troopId);
          const select = row.querySelector<HTMLSelectElement>('.dl-drawer-assign');
          if (select) select.value = '';
        }
        renderSquads();
        renderSummary();
      });
    });
  }

  // ---- full render (initial mount / loadout switch only) ----
  function renderAll(): void {
    renderTopbar();
    renderNotice();
    renderSquads();
    renderSummary();
    if (drawerOpen) renderDrawer();
  }

  renderAll();

  return {
    destroy() {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      document.querySelectorAll('.dl-color-popover').forEach((el) => el.remove());
      root.innerHTML = '';
    },
  };
}
