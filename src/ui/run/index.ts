// Run-mode screens (MVP2): new run -> choose encounter -> prepare -> battle -> rewards -> ... -> won/lost.
// All rules live in src/run (pure); this file only renders and persists one snapshot per transition.
import '../common/theme.css';
import '../flow/flow.css';
import './run.css';
import type { ClassId, Disposition, GameData, GeneralId } from '../../data';
import type { World } from '../../sim';
import type { StartBattleView } from '../../battle/types';
import {
  applyBattleResult, chooseEncounter, chooseHeroUpgrade, chooseRecruitOffer, clearRun, getRunConfig, loadRun, newRun,
  saveRun, startBattle, type Encounter, type RunState, type StorageLike,
} from '../../run';
import { autoPlan, classEdge, classRelation, planIssues, planToArmy, speciesGroups, type ArmyPlan } from './logic';
import { runHeadlessBattle } from '../flow/headlessBattle';

export interface MountRunOptions {
  data: GameData;
  storage: StorageLike;
  /** Switch to the unlimited sandbox (MVP1 flow). */
  onSandbox: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const DISPOSITIONS: Disposition[] = ['fierce', 'mixed', 'guard'];

export function mountRun(root: HTMLElement, opts: MountRunOptions): { destroy(): void } {
  const { data, storage } = opts;
  const cfg = getRunConfig();
  let state: RunState | null = null;
  let corrupt: string | null = null;
  let plan: ArmyPlan | null = null;
  let battleRoot: HTMLElement | null = null;
  let battleView: { destroy(): void } | null = null;
  let destroyed = false;

  const loaded = loadRun(storage, data);
  if (loaded.kind === 'ok') state = loaded.state;
  else if (loaded.kind === 'corrupt') corrupt = loaded.error;

  root.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'dl-screen dl-run';
  root.appendChild(screen);

  /** Persist then render: every transition is one atomic storage write. */
  function commit(next: RunState): void {
    state = next;
    saveRun(storage, next);
    render();
  }

  function guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      const el = screen.querySelector('.dl-issues');
      const msg = e instanceof Error ? e.message : String(e);
      if (el) el.textContent = msg;
      else alert(msg);
    }
  }

  const unitName = (id: string) => data.unitById.get(id)?.name ?? id;
  const className = (id: string) => data.classById.get(id as ClassId)?.name ?? id;

  function render(): void {
    if (destroyed) return;
    battleView?.destroy();
    battleView = null;
    battleRoot?.remove();
    battleRoot = null;
    screen.style.display = 'block';
    if (!state || corrupt) return renderTitle();
    switch (state.phase) {
      case 'select': return renderSelect(state);
      case 'prepare': return renderPrepare(state);
      case 'battle': return renderBattle(state);
      case 'rewards': return renderRewards(state);
      case 'won':
      case 'lost': return renderEnd(state);
    }
  }

  function header(s: RunState): string {
    const g = data.generalById.get(s.hero.generalId)!;
    const unlocked = s.unlockedClasses.map((c) => esc(className(c))).join(', ');
    return `<a href="#" class="dl-mode-link" id="dl-sandbox">Sandbox mode</a>
      <h1 class="dl-title">Battle ${Math.min(s.depth + 1, cfg.battles)} of ${cfg.battles}</h1>
      <div class="dl-run-meta">${esc(g.name)} · Lv ${s.hero.level} (${s.hero.xp} XP) · ${s.roster.length} troops in your company roster</div>
      <div class="dl-run-meta dl-dim">Unlocked classes: ${unlocked}</div>`;
  }

  function wireHeader(): void {
    screen.querySelector('#dl-sandbox')?.addEventListener('click', (e) => {
      e.preventDefault();
      opts.onSandbox();
    });
  }

  // ------------------------------------------------------------ title / new run
  function renderTitle(): void {
    const cfgPartners = cfg.startingPartners;
    const byClass = new Map<string, typeof data.generals>();
    for (const g of data.generals) {
      const c = data.unitById.get(g.unitId)!.classId;
      (byClass.get(c) ?? byClass.set(c, []).get(c)!).push(g);
    }
    const heroCard = (g: (typeof data.generals)[number], i: number) => {
      const c = data.unitById.get(g.unitId)!.classId;
      const u = data.unitById.get(g.unitId)!;
      const partner = cfgPartners[c];
      return `<label class="dl-hero-card">
        <input type="radio" name="dl-gen" value="${g.id}" ${i === 0 ? 'checked' : ''}>
        <strong>${esc(g.name)}</strong> <span class="dl-stage">${esc(className(c))} ${u.line}</span>
        <div class="dl-dim">${esc(g.special.name)}: ${esc(g.special.description)}</div>
        <div class="dl-dim">Starts with ${esc(className(c))} + ${esc(className(partner!))}</div>
      </label>`;
    };
    const groups = [...byClass.entries()].map(([c, generals]) =>
      `<div class="dl-hero-group"><h3>${esc(className(c))}</h3>${generals.map((g) => heroCard(g, data.generals.indexOf(g))).join('')}</div>`).join('');
    screen.innerHTML = `
      <a href="#" class="dl-mode-link" id="dl-sandbox">Sandbox mode</a>
      <h1 class="dl-title">Dragonland — Campaign</h1>
      <p class="dl-flavor">Win ${cfg.battles} battles. Your troops level up and evolve; the fallen are gone. If your general falls, the run ends.</p>
      ${corrupt ? `<div class="dl-panel"><p class="dl-error">Your saved run could not be loaded: ${esc(corrupt)}</p><p>Starting a new run will discard it.</p></div>` : ''}
      <div class="dl-panel">
        <h2>Choose your hero</h2>
        ${groups}
        <p><label>Team colour: <input type="color" id="dl-color" value="${cfg.defaultTeamColor}"></label></p>
        <button class="dl-primary" id="dl-new">Begin</button>
      </div>`;
    wireHeader();
    screen.querySelector('#dl-new')!.addEventListener('click', () => {
      const generalId = (screen.querySelector<HTMLInputElement>('input[name=dl-gen]:checked')!.value) as GeneralId;
      const color = screen.querySelector<HTMLInputElement>('#dl-color')!.value;
      const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
      corrupt = null;
      plan = null;
      commit(newRun(data, { seed, generalId, color }));
    });
  }

  // ------------------------------------------------------------ encounter choice
  function enemySummary(e: Encounter, s: RunState): string {
    const troops = e.side.squads.flatMap((q) => q.troops);
    const byClass = new Map<string, number>();
    const byStage = [0, 0, 0];
    for (const t of troops) {
      const u = data.unitById.get(t.unitId)!;
      byClass.set(u.classId, (byClass.get(u.classId) ?? 0) + 1);
      byStage[u.stage - 1]!++;
    }
    const mine = new Set(s.roster.map((t) => data.unitById.get(t.unitId)?.classId ?? ''));
    const edges = [...mine].filter(Boolean).map((c) => {
      const v = classEdge(data, c, byClass);
      return `<span class="dl-${v}">${esc(className(c))}: ${v}</span>`;
    }).join(' · ');
    const g = e.side.general!;
    const generalClass = data.unitById.get(data.generalById.get(e.side.generalId)!.unitId)!.classId;
    const locked = !s.unlockedClasses.includes(generalClass);
    const heroClass = data.unitById.get(data.generalById.get(s.hero.generalId)!.unitId)!.classId;
    const relation = classRelation(data, heroClass, generalClass);
    const badge = locked ? ` <span class="dl-strong">Defeat to unlock ${esc(className(generalClass))}</span>` : '';
    const relBadge = relation !== 'neutral' ? ` <span class="dl-${relation === 'quarry' ? 'strong' : 'weak'}">${relation}</span>` : '';
    const doctrine = e.doctrine ? ` <span class="dl-stage">(${e.doctrine} doctrine)</span>` : '';
    return `<strong>${e.boss ? '👑 ' : ''}${esc(e.name)}</strong>${doctrine}${badge}${relBadge}
      ${esc(g.name)} Lv ${g.level} · HP ${Math.round(g.hp)} · ${troops.length} troops (${byStage.map((n, i) => (n ? `${n} stage ${i + 1}` : '')).filter(Boolean).join(', ')})<br>
      ${[...byClass].map(([c, n]) => `${esc(className(c))} ×${n}`).join(', ')}<br>
      <span class="dl-dim">Your classes vs them: ${edges}</span>`;
  }

  function renderSelect(s: RunState): void {
    screen.innerHTML = `${header(s)}
      <div class="dl-panel"><h2>Choose your next battle</h2>
        <p class="dl-dim">Enemies commit first. Once you march, the enemy will not change.</p>
        ${s.offers.map((e) => `<button class="dl-choice" data-enc="${e.id}">${enemySummary(e, s)}</button>`).join('')}
        <div class="dl-issues"></div>
      </div>`;
    wireHeader();
    screen.querySelectorAll<HTMLButtonElement>('[data-enc]').forEach((b) =>
      b.addEventListener('click', () => guard(() => {
        plan = null;
        commit(chooseEncounter(s, b.dataset.enc!));
      })));
  }

  // ------------------------------------------------------------ prepare
  function renderPrepare(s: RunState): void {
    const e = s.encounter!;
    plan ??= autoPlan(data, s.roster);
    const p = plan;
    const groups = speciesGroups(data, s.roster);
    const squadOptions = (sel: number) => p.squads.map((q, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i + 1}. ${esc(q.name)}</option>`).join('');
    const enemyClasses = new Map<string, number>();
    for (const t of e.side.squads.flatMap((q) => q.troops)) {
      const c = data.unitById.get(t.unitId)!.classId;
      enemyClasses.set(c, (enemyClasses.get(c) ?? 0) + 1);
    }
    const rows = groups.map((g) => {
      const a = p.assignment[g.unit.id] ?? { count: 0, squad: 0 };
      const lv = g.troops.map((t) => t.level);
      const edge = classEdge(data, g.unit.classId, enemyClasses);
      const vets = g.troops.map((t) => `<div>${esc(t.name)} — Lv ${t.level} (${t.xp} XP)</div>`).join('');
      return `<tr>
        <td><strong>${esc(g.unit.name)}</strong> <span class="dl-stage">${esc(className(g.unit.classId))} ${g.unit.line} · stage ${g.unit.stage}</span>
          <details><summary>${g.troops.length} named</summary><div class="dl-vets">${vets}</div></details></td>
        <td class="dl-${edge}">${edge}</td>
        <td>Lv ${Math.min(...lv)}${Math.max(...lv) > Math.min(...lv) ? `–${Math.max(...lv)}` : ''}</td>
        <td><input type="number" min="0" max="${g.troops.length}" value="${a.count}" data-count="${g.unit.id}"> / ${g.troops.length}</td>
        <td><select data-squad="${g.unit.id}">${squadOptions(a.squad)}</select></td>
      </tr>`;
    }).join('');
    const squadHeads = p.squads.map((q, i) => `<label>${i + 1}. <input value="${esc(q.name)}" data-sqname="${i}" size="9">
      <select data-sqdisp="${i}">${DISPOSITIONS.map((d) => `<option ${d === q.disposition ? 'selected' : ''}>${d}</option>`).join('')}</select></label>`).join('');
    screen.innerHTML = `${header(s)}
      <div class="dl-row">
        <div class="dl-panel"><h2>Enemy</h2>${enemySummary(e, s)}
          <ul class="dl-enemy-squads">${e.side.squads.map((q) => `<li>${esc(q.name)} (${q.disposition}, ${q.troops.length})</li>`).join('')}</ul>
          <p class="dl-dim">Formation: ${esc(data.formationById.get(e.side.formationId)?.name ?? e.side.formationId)}</p>
        </div>
        <div class="dl-panel"><h2>Your general</h2>
          <p>${esc(data.generalById.get(s.hero.generalId)!.name)} · Lv ${s.hero.level}</p>
          <p class="dl-dim">Upgrades: vitality ${s.hero.upgrades.vitality}, might ${s.hero.upgrades.might}, mastery ${s.hero.upgrades.mastery}</p>
          <label>Formation: <select id="dl-formation">${data.formations.map((f) => `<option value="${f.id}" ${f.id === p.formationId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
          <p><button id="dl-auto">Auto-arrange</button></p>
        </div>
      </div>
      <div class="dl-panel"><h2>Deploy (<span id="dl-total"></span> / ${data.constants.MAX_COMPANY})</h2>
        <div class="dl-squad-head">${squadHeads}</div>
        <table><thead><tr><th>Species</th><th>vs enemy</th><th>Levels</th><th>Deploy</th><th>Squad</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="dl-issues"></div>
        <button class="dl-primary dl-start" id="dl-fight">Fight!</button>
      </div>`;
    wireHeader();

    const refresh = () => {
      const total = Object.values(p.assignment).reduce((n, a) => n + Math.max(0, a.count), 0);
      screen.querySelector('#dl-total')!.textContent = String(total);
      const issues = planIssues(data, s.roster, p);
      screen.querySelector('.dl-issues')!.textContent = issues.join(' ');
      screen.querySelector<HTMLButtonElement>('#dl-fight')!.disabled = issues.length > 0;
    };
    screen.querySelectorAll<HTMLInputElement>('[data-count]').forEach((inp) => inp.addEventListener('input', () => {
      const id = inp.dataset.count!;
      p.assignment[id] = { squad: p.assignment[id]?.squad ?? 0, count: Math.max(0, Math.floor(Number(inp.value) || 0)) };
      refresh();
    }));
    screen.querySelectorAll<HTMLSelectElement>('[data-squad]').forEach((sel) => sel.addEventListener('change', () => {
      const id = sel.dataset.squad!;
      p.assignment[id] = { count: p.assignment[id]?.count ?? 0, squad: Number(sel.value) };
      refresh();
    }));
    screen.querySelectorAll<HTMLInputElement>('[data-sqname]').forEach((inp) => inp.addEventListener('input', () => { p.squads[Number(inp.dataset.sqname)]!.name = inp.value || `Squad ${Number(inp.dataset.sqname) + 1}`; }));
    screen.querySelectorAll<HTMLSelectElement>('[data-sqdisp]').forEach((sel) => sel.addEventListener('change', () => { p.squads[Number(sel.dataset.sqdisp)]!.disposition = sel.value as Disposition; }));
    screen.querySelector<HTMLSelectElement>('#dl-formation')!.addEventListener('change', (ev) => { p.formationId = (ev.target as HTMLSelectElement).value; });
    screen.querySelector('#dl-auto')!.addEventListener('click', () => { plan = autoPlan(data, s.roster, p.formationId); render(); });
    screen.querySelector('#dl-fight')!.addEventListener('click', () => guard(() => commit(startBattle(data, s, planToArmy(data, s.roster, p)))));
    refresh();
  }

  // ------------------------------------------------------------ battle
  function renderBattle(s: RunState): void {
    const battle = s.battle!;
    screen.style.display = 'none';
    battleRoot = document.createElement('div');
    battleRoot.className = 'dl-battle-root';
    root.appendChild(battleRoot);
    const finish = (world: World) => {
      if (destroyed || !world.result || state?.battle?.id !== battle.id) return;
      plan = null;
      commit(applyBattleResult(data, state, battle.id, world.result));
    };
    const labels = { player: data.generalById.get(s.hero.generalId)!.name, enemy: s.encounter!.name };
    void (async () => {
      try {
        const mod: { startBattleView: StartBattleView } = await import('../../battle/view');
        const view = await mod.startBattleView(battleRoot!, { data, setup: battle.setup, labels, onFinished: finish });
        if (destroyed || !battleRoot) view.destroy();
        else battleView = view;
      } catch (err) {
        console.error('Battle view failed to start; resolving headlessly.', err);
        finish(runHeadlessBattle(data, battle.setup));
      }
    })();
  }

  // ------------------------------------------------------------ rewards / end
  function summaryHtml(s: RunState): string {
    const r = s.lastSummary;
    if (!r) return '';
    const evo = r.evolutions.map((e) => `<li class="dl-evo">${esc(e.name)}: ${esc(unitName(e.from))} → ${esc(unitName(e.to))}</li>`).join('');
    return `<div class="dl-panel"><h2>${r.won ? 'Victory' : 'Defeat'}${r.boss ? ' over the warlord' : ''}</h2>
      <p>${r.dead.length} fallen${r.recovered.length ? ` · ${r.recovered.length} wounded rejoined` : ''}${r.won ? ` · survivors earned ${r.xpAwarded} XP · ${r.levelUps} level-ups` : ''} · General Lv ${r.heroLevelFrom}${r.heroLevelTo !== r.heroLevelFrom ? ` → ${r.heroLevelTo}` : ''}</p>
      ${r.unlockedClass ? `<p class="dl-strong">New class unlocked: ${esc(className(r.unlockedClass))}!</p>` : ''}
      ${evo ? `<h3>Evolved</h3><ul class="dl-troop-list">${evo}</ul>` : ''}
      ${r.dead.length ? `<details><summary>Fallen (${r.dead.length})</summary><ul class="dl-troop-list dl-fallen">${r.dead.map((d) => `<li>${esc(d.name)} (${esc(unitName(d.unitId))})</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  function renderRewards(s: RunState): void {
    const milestone = s.pendingMilestones[0];
    const upgrade = (k: string, label: string) => `<button class="dl-choice" data-up="${k}"><strong>${label}</strong></button>`;
    const offers = s.recruitOffers.map((o) => {
      const counts = new Map<string, number>();
      for (const t of o.troops) counts.set(t.unitId, (counts.get(t.unitId) ?? 0) + 1);
      const over = s.roster.length + o.troops.length > cfg.rosterCap;
      return `<button class="dl-choice" data-offer="${o.id}" ${over ? 'disabled' : ''}><strong>${o.troops.length} recruits</strong>
        ${[...counts].map(([u, n]) => `${esc(unitName(u))} ×${n} <span class="dl-stage">(${esc(className(data.unitById.get(u)!.classId))} ${data.unitById.get(u)!.line})</span>`).join(', ')}
        ${over ? '<br><span class="dl-weak">Roster cap reached</span>' : ''}</button>`;
    }).join('');
    screen.innerHTML = `${header(s)}${summaryHtml(s)}
      ${milestone !== undefined
        ? `<div class="dl-panel"><h2>General reached level ${milestone}: choose a boon</h2>
            ${upgrade('vitality', '+10% max HP (vitality)')}${upgrade('might', '+10% attack (might)')}${upgrade('mastery', '+10% special strength (mastery)')}</div>`
        : `<div class="dl-panel"><h2>Recruit</h2><p class="dl-dim">Choose one group, or skip. Recruits start at level 1. Roster ${s.roster.length}/${cfg.rosterCap}.</p>
            ${offers}<button class="dl-choice" data-offer=""><strong>Skip recruiting</strong></button></div>`}
      <div class="dl-issues"></div>`;
    wireHeader();
    screen.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => guard(() => commit(chooseHeroUpgrade(s, b.dataset.up as 'vitality' | 'might' | 'mastery')))));
    screen.querySelectorAll<HTMLButtonElement>('[data-offer]').forEach((b) => b.addEventListener('click', () => guard(() => commit(chooseRecruitOffer(data, s, b.dataset.offer || null)))));
  }

  function renderEnd(s: RunState): void {
    const won = s.phase === 'won';
    const milestone = s.pendingMilestones[0];
    screen.innerHTML = `${header(s)}
      <h2>${won ? 'The campaign is won.' : 'Your general has fallen. The run is over.'}</h2>
      ${summaryHtml(s)}
      ${won && milestone !== undefined ? `<p class="dl-dim">Unspent general milestone at level ${milestone}.</p>` : ''}
      <div class="dl-panel"><p>${s.roster.length} troops survived the campaign.</p>
        <button class="dl-primary" id="dl-again">New run</button></div>`;
    wireHeader();
    screen.querySelector('#dl-again')!.addEventListener('click', () => {
      clearRun(storage);
      state = null;
      plan = null;
      render();
    });
  }

  render();
  return {
    destroy() {
      destroyed = true;
      battleView?.destroy();
      battleRoot?.remove();
      screen.remove();
    },
  };
}
