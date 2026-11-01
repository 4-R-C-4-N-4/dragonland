// Plain-DOM army builder screen. No framework; re-renders are cheap string-based DOM rebuilds.
import '../common/theme.css';
import type { GameData } from '../../data';
import type { ClassId, Loadout, Squad, Troop } from '../../data/schemas';
import type { Store } from '../../persist/store';
import {
  autoFillSquad,
  companyComposition,
  cycleDisposition,
  sanitizeLoadout,
  selectAllOfUnit,
  validateLoadout,
} from './logic';
import './builder.css';

export interface MountBuilderOptions {
  data: GameData;
  store: Store;
  onStartBattle?: (loadout: Loadout) => void;
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
    squads: [{ id: freshId('squad'), name: 'Squad 1', troopIds: [], disposition: 'mixed' }],
  };
}

type SortKey = 'name' | 'unit' | 'class' | 'line' | 'stage';

export function mountBuilder(root: HTMLElement, opts: MountBuilderOptions): MountedBuilder {
  const { data, store } = opts;

  // ---- state ----
  let roster: Troop[] = store.getRoster();
  let loadouts: Loadout[] = store.listLoadouts();
  let loadout: Loadout = loadouts[0] ?? blankLoadout();
  let notice = '';
  let selected = new Set<string>();
  let filterText = '';
  let filterClass: ClassId | 'all' = 'all';
  let filterLine: 'A' | 'M' | 'Z' | 'all' = 'all';
  let filterStage: 1 | 2 | 'all' = 'all';
  let sortKey: SortKey = 'unit';
  let sortDir: 1 | -1 = 1;
  let dragTroopId: string | null = null;

  root.innerHTML = '';
  root.classList.add('dl-builder');

  function troopSquadId(troopId: string): string | undefined {
    return loadout.squads.find((s) => s.troopIds.includes(troopId))?.id;
  }

  function squadSlotNumber(squadId: string): number {
    return loadout.squads.findIndex((s) => s.id === squadId) + 1;
  }

  function filteredSortedRoster(): Troop[] {
    let list = roster.slice();
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (filterClass !== 'all') {
      list = list.filter((t) => data.unitById.get(t.unitId)?.classId === filterClass);
    }
    if (filterLine !== 'all') {
      list = list.filter((t) => data.unitById.get(t.unitId)?.line === filterLine);
    }
    if (filterStage !== 'all') {
      list = list.filter((t) => data.unitById.get(t.unitId)?.stage === filterStage);
    }
    list.sort((a, b) => {
      const ua = data.unitById.get(a.unitId);
      const ub = data.unitById.get(b.unitId);
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'unit':
          cmp = (ua?.name ?? '').localeCompare(ub?.name ?? '');
          break;
        case 'class':
          cmp = (ua?.classId ?? '').localeCompare(ub?.classId ?? '');
          break;
        case 'line':
          cmp = (ua?.line ?? '').localeCompare(ub?.line ?? '');
          break;
        case 'stage':
          cmp = (ua?.stage ?? 0) - (ub?.stage ?? 0);
          break;
      }
      return cmp * sortDir;
    });
    return list;
  }

  function presentClasses(): ClassId[] {
    const seen = new Set<ClassId>();
    for (const t of roster) {
      const cid = data.unitById.get(t.unitId)?.classId;
      if (cid) seen.add(cid);
    }
    return data.classes.map((c: GameData['classes'][number]) => c.id).filter((c: ClassId) => seen.has(c));
  }

  function totalAssigned(): number {
    return loadout.squads.reduce((n, s) => n + s.troopIds.length, 0);
  }

  function classSwatch(classId: ClassId | undefined): string {
    const color = classId ? data.classById.get(classId)?.color ?? '#888' : '#888';
    return `<span class="dl-class-swatch" style="background:${color}"></span>`;
  }

  // ---- rendering ----
  function render(): void {
    const validation = validateLoadout(loadout, roster, data);
    const comp = companyComposition(loadout, roster, data);
    const total = totalAssigned();

    root.innerHTML = `
      <div class="dl-topbar">
        <h1 class="dl-title">Army Builder</h1>
        <div class="dl-loadout-controls">
          <select id="dl-loadout-select">
            <option value="">— New Army —</option>
            ${loadouts.map((l) => `<option value="${l.id}" ${l.id === loadout.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
          </select>
          <button id="dl-save">Save</button>
          <button id="dl-duplicate">Duplicate</button>
          <button id="dl-rename">Rename</button>
          <button id="dl-delete">Delete</button>
          <button id="dl-new">New</button>
          <label class="dl-general-picker">General:
            <select id="dl-general">
              ${data.generals.map((g: GameData['generals'][number]) => `<option value="${g.id}" ${g.id === loadout.generalId ? 'selected' : ''}>${g.name} (hp ${g.hp}, ${g.special.name})</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      ${notice ? `<div class="dl-notice">${escapeHtml(notice)}</div>` : ''}
      <div class="dl-main">
        <section class="dl-panel dl-roster-panel">
          <div class="dl-roster-toolbar">
            <input id="dl-search" type="text" placeholder="Search name…" value="${escapeHtml(filterText)}" />
            <select id="dl-filter-class">
              <option value="all">All classes</option>
              ${presentClasses()
                .map((cid) => `<option value="${cid}" ${filterClass === cid ? 'selected' : ''}>${data.classById.get(cid)?.name ?? cid}</option>`)
                .join('')}
            </select>
            <select id="dl-filter-line">
              <option value="all">All lines</option>
              <option value="A" ${filterLine === 'A' ? 'selected' : ''}>Line A</option>
              <option value="M" ${filterLine === 'M' ? 'selected' : ''}>Line M</option>
              <option value="Z" ${filterLine === 'Z' ? 'selected' : ''}>Line Z</option>
            </select>
            <select id="dl-filter-stage">
              <option value="all">All stages</option>
              <option value="1" ${filterStage === 1 ? 'selected' : ''}>Stage 1</option>
              <option value="2" ${filterStage === 2 ? 'selected' : ''}>Stage 2</option>
            </select>
            <span class="dl-selected-count">${selected.size} selected</span>
          </div>
          <div class="dl-bulk-toolbar">
            <select id="dl-bulk-target-squad">
              ${loadout.squads.map((s, i) => `<option value="${s.id}">${escapeHtml(s.name)} (#${i + 1})</option>`).join('')}
            </select>
            <button id="dl-add-selected">Add selected →</button>
            <span class="dl-sep"></span>
            <select id="dl-autofill-unit">
              ${data.units
                .filter((u: GameData['units'][number]) => u.stage !== 3)
                .map((u: GameData['units'][number]) => `<option value="${u.id}">${u.name}</option>`)
                .join('')}
            </select>
            <input id="dl-autofill-count" type="number" value="25" min="1" max="${data.constants.MAX_COMPANY}" style="width:4em" />
            <button id="dl-autofill">Auto-fill by unit</button>
            <select id="dl-autofill-class">
              ${presentClasses().map((id) => `<option value="${id}">${data.classById.get(id)?.name ?? id}</option>`).join('')}
            </select>
            <button id="dl-autofill-class-btn">Auto-fill by class</button>
          </div>
          <table class="dl-roster-table">
            <thead>
              <tr>
                <th></th>
                <th data-sort="name">Name</th>
                <th data-sort="unit">Unit</th>
                <th data-sort="class">Class</th>
                <th data-sort="line">Line</th>
                <th data-sort="stage">Stage</th>
                <th>Squad</th>
              </tr>
            </thead>
            <tbody id="dl-roster-body">
              ${renderRosterRows()}
            </tbody>
          </table>
        </section>

        <section class="dl-squads">
          <div class="dl-totals dl-panel">
            <strong>Company:</strong> ${total} / ${data.constants.MAX_COMPANY}
            <span class="dl-class-counts">
              ${Object.entries(comp)
                .map(([cid, n]) => `${classSwatch(cid as ClassId)}${cid}: ${n}`)
                .join('  ')}
            </span>
            <button id="dl-add-squad" ${loadout.squads.length >= data.constants.MAX_SQUADS ? 'disabled' : ''}>+ Squad</button>
          </div>
          ${validation.errors.length ? `<ul class="dl-panel dl-errors">${validation.errors.map((e) => `<li class="dl-error">${escapeHtml(e.message)}</li>`).join('')}</ul>` : ''}
          <div class="dl-squad-list">
            ${loadout.squads.map((s, i) => renderSquad(s, i)).join('')}
          </div>
          <button id="dl-start-battle" class="dl-primary dl-start" ${validation.ok ? '' : 'disabled'}>Start battle</button>
        </section>
      </div>
    `;
    bindEvents();
  }

  function renderRosterRows(): string {
    return filteredSortedRoster()
      .map((t) => {
        const unit = data.unitById.get(t.unitId);
        const squadId = troopSquadId(t.id);
        const slot = squadId ? squadSlotNumber(squadId) : null;
        const rowClass = ['dl-row', selected.has(t.id) ? 'dl-selected' : '', slot ? 'dl-in-squad' : ''].filter(Boolean).join(' ');
        return `
          <tr class="${rowClass}" data-troop-id="${t.id}" draggable="true">
            <td><input type="checkbox" class="dl-row-check" data-troop-id="${t.id}" ${selected.has(t.id) ? 'checked' : ''} /></td>
            <td>${escapeHtml(t.name)}</td>
            <td>${unit?.name ?? '?'}</td>
            <td>${classSwatch(unit?.classId)}${unit?.classId ?? '?'}</td>
            <td>${unit?.line ?? '?'}</td>
            <td>${unit?.stage ?? '?'}</td>
            <td>${slot ? `Squad ${slot}` : ''}</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderSquad(squad: Squad, index: number): string {
    const dispIcon = { fierce: '⚔', mixed: '⚖', guard: '🛡' }[squad.disposition];
    const troops = squad.troopIds.map((id) => roster.find((t) => t.id === id)).filter((t): t is Troop => Boolean(t));
    const classCounts = new Map<string, number>();
    for (const t of troops) {
      const cid = data.unitById.get(t.unitId)?.classId ?? '?';
      classCounts.set(cid, (classCounts.get(cid) ?? 0) + 1);
    }
    return `
      <div class="dl-panel dl-squad" data-squad-id="${squad.id}">
        <div class="dl-squad-header">
          <input type="text" class="dl-squad-name" data-squad-id="${squad.id}" value="${escapeHtml(squad.name)}" />
          <button class="dl-disposition" data-squad-id="${squad.id}" title="Cycle disposition">${dispIcon} ${squad.disposition}</button>
          <span class="dl-squad-count">${squad.troopIds.length} troops</span>
          <button class="dl-remove-squad" data-squad-id="${squad.id}" ${loadout.squads.length <= 1 ? 'disabled' : ''} title="Remove squad" aria-label="Remove squad">✕</button>
        </div>
        <div class="dl-squad-class-counts">
          ${Array.from(classCounts.entries())
            .map(([cid, n]) => `${classSwatch(cid as ClassId)}${cid}: ${n}`)
            .join('  ')}
        </div>
        <ul class="dl-squad-troops" data-squad-id="${squad.id}">
          ${troops
            .map((t) => `<li data-troop-id="${t.id}">${escapeHtml(t.name)} <span class="dl-dim">(${data.unitById.get(t.unitId)?.name ?? '?'})</span><button class="dl-remove-troop" data-squad-id="${squad.id}" data-troop-id="${t.id}">✕</button></li>`)
            .join('')}
        </ul>
      </div>
    `;
  }

  // ---- event wiring ----
  function bindEvents(): void {
    root.querySelector<HTMLSelectElement>('#dl-loadout-select')?.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (!id) {
        loadout = blankLoadout();
        selected = new Set();
      } else {
        const found = store.getLoadout(id);
        if (found) {
          const { loadout: sanitized, removed } = sanitizeLoadout(found, roster);
          loadout = sanitized;
          notice = removed.length ? `${removed.length} troop(s) no longer in the roster were removed from this army.` : '';
          if (removed.length) store.saveLoadout(sanitized);
        }
      }
      render();
    });

    root.querySelector('#dl-save')?.addEventListener('click', () => {
      store.saveLoadout(loadout);
      loadouts = store.listLoadouts();
      store.setLastComposition(companyComposition(loadout, roster, data));
      notice = 'Saved.';
      render();
    });

    root.querySelector('#dl-duplicate')?.addEventListener('click', () => {
      store.saveLoadout(loadout);
      const copy = store.duplicateLoadout(loadout.id);
      loadouts = store.listLoadouts();
      if (copy) loadout = copy;
      render();
    });

    root.querySelector('#dl-rename')?.addEventListener('click', () => {
      const name = window.prompt('Rename army', loadout.name);
      if (name) {
        loadout = { ...loadout, name };
        if (loadouts.some((l) => l.id === loadout.id)) {
          store.renameLoadout(loadout.id, name);
          loadouts = store.listLoadouts();
        }
      }
      render();
    });

    root.querySelector('#dl-delete')?.addEventListener('click', () => {
      if (loadouts.some((l) => l.id === loadout.id)) {
        store.deleteLoadout(loadout.id);
        loadouts = store.listLoadouts();
      }
      loadout = loadouts[0] ?? blankLoadout();
      render();
    });

    root.querySelector('#dl-new')?.addEventListener('click', () => {
      loadout = blankLoadout();
      selected = new Set();
      notice = '';
      render();
    });

    root.querySelector<HTMLSelectElement>('#dl-general')?.addEventListener('change', (e) => {
      loadout = { ...loadout, generalId: (e.target as HTMLSelectElement).value as Loadout['generalId'] };
      render();
    });

    root.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort as SortKey;
        if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
        else {
          sortKey = key;
          sortDir = 1;
        }
        render();
      });
    });

    root.querySelector<HTMLInputElement>('#dl-search')?.addEventListener('input', (e) => {
      filterText = (e.target as HTMLInputElement).value;
      render();
    });
    root.querySelector<HTMLSelectElement>('#dl-filter-class')?.addEventListener('change', (e) => {
      filterClass = (e.target as HTMLSelectElement).value as ClassId | 'all';
      render();
    });
    root.querySelector<HTMLSelectElement>('#dl-filter-line')?.addEventListener('change', (e) => {
      filterLine = (e.target as HTMLSelectElement).value as 'A' | 'M' | 'Z' | 'all';
      render();
    });
    root.querySelector<HTMLSelectElement>('#dl-filter-stage')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      filterStage = v === 'all' ? 'all' : (Number(v) as 1 | 2);
      render();
    });

    let lastClickedRow: string | null = null;
    root.querySelectorAll<HTMLElement>('tr.dl-row').forEach((row) => {
      const troopId = row.dataset.troopId!;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (e.shiftKey && lastClickedRow) {
          const ids = filteredSortedRoster().map((t) => t.id);
          const a = ids.indexOf(lastClickedRow);
          const b = ids.indexOf(troopId);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) selected.add(ids[i]!);
          }
        } else {
          if (selected.has(troopId)) selected.delete(troopId);
          else selected.add(troopId);
        }
        lastClickedRow = troopId;
        render();
      });
      row.addEventListener('dragstart', () => {
        dragTroopId = troopId;
      });
    });
    root.querySelectorAll<HTMLInputElement>('.dl-row-check').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        const id = (e.target as HTMLInputElement).dataset.troopId!;
        if ((e.target as HTMLInputElement).checked) selected.add(id);
        else selected.delete(id);
        render();
      });
    });

    root.querySelectorAll<HTMLElement>('.dl-squad-troops').forEach((ul) => {
      ul.addEventListener('dragover', (e) => e.preventDefault());
      ul.addEventListener('drop', (e) => {
        e.preventDefault();
        const squadId = ul.dataset.squadId!;
        if (dragTroopId) addTroopsToSquad([dragTroopId], squadId);
        dragTroopId = null;
      });
    });

    root.querySelector('#dl-add-selected')?.addEventListener('click', () => {
      const squadId = root.querySelector<HTMLSelectElement>('#dl-bulk-target-squad')?.value;
      if (squadId && selected.size) {
        addTroopsToSquad(Array.from(selected), squadId);
        selected = new Set();
      }
    });

    root.querySelector('#dl-autofill')?.addEventListener('click', () => {
      const squadId = root.querySelector<HTMLSelectElement>('#dl-bulk-target-squad')?.value;
      const unitId = root.querySelector<HTMLSelectElement>('#dl-autofill-unit')?.value;
      const count = Number(root.querySelector<HTMLInputElement>('#dl-autofill-count')?.value ?? '0');
      if (squadId && unitId && count > 0) {
        loadout = autoFillSquad(loadout, squadId, roster, data, { by: 'unit', value: unitId, count });
        render();
      }
    });

    root.querySelector('#dl-autofill-class-btn')?.addEventListener('click', () => {
      const squadId = root.querySelector<HTMLSelectElement>('#dl-bulk-target-squad')?.value;
      const classId = root.querySelector<HTMLSelectElement>('#dl-autofill-class')?.value;
      const count = Number(root.querySelector<HTMLInputElement>('#dl-autofill-count')?.value ?? '0');
      if (squadId && classId && count > 0) {
        loadout = autoFillSquad(loadout, squadId, roster, data, { by: 'class', value: classId, count });
        render();
      }
    });

    root.querySelector('#dl-add-squad')?.addEventListener('click', () => {
      if (loadout.squads.length >= data.constants.MAX_SQUADS) return;
      loadout = {
        ...loadout,
        squads: [...loadout.squads, { id: freshId('squad'), name: `Squad ${loadout.squads.length + 1}`, troopIds: [], disposition: 'mixed' }],
      };
      render();
    });

    root.querySelectorAll<HTMLInputElement>('.dl-squad-name').forEach((input) => {
      input.addEventListener('change', (e) => {
        const squadId = (e.target as HTMLInputElement).dataset.squadId!;
        const name = (e.target as HTMLInputElement).value;
        loadout = { ...loadout, squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, name } : s)) };
      });
    });

    root.querySelectorAll<HTMLButtonElement>('.dl-disposition').forEach((btn) => {
      btn.addEventListener('click', () => {
        const squadId = btn.dataset.squadId!;
        loadout = {
          ...loadout,
          squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, disposition: cycleDisposition(s.disposition) } : s)),
        };
        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>('.dl-remove-squad').forEach((btn) => {
      btn.addEventListener('click', () => {
        const squadId = btn.dataset.squadId!;
        loadout = { ...loadout, squads: loadout.squads.filter((s) => s.id !== squadId) };
        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>('.dl-remove-troop').forEach((btn) => {
      btn.addEventListener('click', () => {
        const squadId = btn.dataset.squadId!;
        const troopId = btn.dataset.troopId!;
        loadout = {
          ...loadout,
          squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, troopIds: s.troopIds.filter((id) => id !== troopId) } : s)),
        };
        render();
      });
    });

    root.querySelector('#dl-start-battle')?.addEventListener('click', () => {
      store.saveLoadout(loadout);
      store.setLastComposition(companyComposition(loadout, roster, data));
      opts.onStartBattle?.(loadout);
    });
  }

  function addTroopsToSquad(troopIds: string[], squadId: string): void {
    const assignedElsewhere = new Set(loadout.squads.flatMap((s) => (s.id === squadId ? [] : s.troopIds)));
    const alreadyIn = new Set(loadout.squads.find((s) => s.id === squadId)?.troopIds ?? []);
    const toAdd = troopIds.filter((id) => !assignedElsewhere.has(id) && !alreadyIn.has(id));
    loadout = {
      ...loadout,
      squads: loadout.squads.map((s) => (s.id === squadId ? { ...s, troopIds: [...s.troopIds, ...toAdd] } : s)),
    };
    render();
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  render();

  return {
    destroy() {
      root.innerHTML = '';
    },
  };
}

// re-export for consumers that only need bulk helper names without importing logic directly
export { selectAllOfUnit };
