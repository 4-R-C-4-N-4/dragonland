// Run-mode screens (MVP2): new run -> choose encounter -> prepare -> battle -> rewards -> ... -> won/lost.
// All rules live in src/run (pure); this file only renders and persists one snapshot per transition.
import '../common/theme.css';
import '../flow/flow.css';
import './run.css';
import type { ClassId, Disposition, GameData, GeneralId } from '../../data';
import type { World } from '../../sim';
import type { StartBattleView } from '../../battle/types';
import { playerDeadIds } from '../../battle/helpers';
import {
  applyBattleResult, forfeitBattle, chooseEncounter, chooseHeroUpgrade, chooseRecruitOffer, clearRun, getRunConfig, loadRun, newRun,
  saveRun, startBattle, type Encounter, type RunState, type StorageLike,
} from '../../run';
import { autoPlan, classEdge, classRelation, planIssues, planToArmy, speciesGroups, type ArmyPlan } from './logic';
import { runHeadlessBattle } from '../flow/headlessBattle';
import { discoverSheets } from '../../render/spriteSheets';
import { campaignHelpHtml, depletedCompanyHtml, esc, heroChoicesHtml, resultHtml, selectedHeroHtml } from './presentation';

export interface MountRunOptions {
  data: GameData;
  storage: StorageLike;
  /** Switch to the unlimited sandbox (MVP1 flow). */
  onSandbox: () => void;
}

const DISPOSITIONS: Disposition[] = ['fierce', 'mixed', 'guard'];

export function mountRun(root: HTMLElement, opts: MountRunOptions): { destroy(): void } {
  const { data, storage } = opts;
  const cfg = getRunConfig();
  const sheets = discoverSheets();
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
    saveRun(storage, next);
    state = next;
    render();
    const heading = screen.querySelector<HTMLElement>('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
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
      <div class="dl-run-meta dl-dim">Unlocked classes: ${unlocked}</div>
      ${depletedCompanyHtml(data, s)}`;
  }

  function wireHeader(): void {
    screen.querySelector('#dl-abandon')?.addEventListener('click', () => {
      clearRun(storage);
      state = null;
      plan = null;
      render();
      screen.querySelector<HTMLButtonElement>('#dl-new')?.focus();
    });
    screen.querySelector('#dl-sandbox')?.addEventListener('click', (e) => {
      e.preventDefault();
      opts.onSandbox();
    });
  }

  /** Idle frame 0 of each hero's sprite sheet, pixel-scaled into its card canvas. */
  function drawPortraits(): void {
    screen.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]').forEach((cv) => {
      const sheet = sheets.get(cv.dataset.portrait!);
      const f = sheet?.animations.idle.frames[0];
      if (!sheet || !f) return void (cv.style.display = 'none');
      const img = new Image();
      img.onload = () => {
        if (destroyed || !screen.contains(cv)) return;
        const g = cv.getContext('2d');
        if (!g) return;
        g.imageSmoothingEnabled = false;
        const s = Math.min(cv.width / f.w, cv.height / f.h);
        g.drawImage(img, f.x, f.y, f.w, f.h, (cv.width - f.w * s) / 2, cv.height - f.h * s, f.w * s, f.h * s);
      };
      img.src = sheet.imageUrl;
    });
  }

  // ------------------------------------------------------------ title / new run
  function renderTitle(): void {
    const selected = data.generals[0]!.id;
    screen.innerHTML = `
      <a href="#" class="dl-mode-link" id="dl-sandbox">Sandbox mode</a>
      <h1 class="dl-title">Dragonland — Campaign</h1>
      <p class="dl-flavor">Win ${cfg.battles} battles. Your troops level up and evolve. After victory, some fallen troops recover as wounded and rejoin; permanent losses leave your roster. If your general falls, the run ends.</p>
      ${corrupt ? `<div class="dl-panel"><p class="dl-error">Your saved run could not be loaded: ${esc(corrupt)}</p><p>Starting a new run will discard it.</p></div>` : ''}
      <div class="dl-panel">
        <h2>Choose your hero</h2>
        <div class="dl-hero-start">
          <div id="dl-selected-hero" aria-live="polite">${selectedHeroHtml(data, selected)}</div>
          <div><p><label>Team colour: <input type="color" id="dl-color" value="${cfg.defaultTeamColor}"></label></p>
          <button class="dl-primary" id="dl-new" data-testid="begin-run">Begin</button></div>
        </div>
        ${heroChoicesHtml(data, selected)}
        ${campaignHelpHtml(data)}
      </div>`;
    wireHeader();
    drawPortraits();
    screen.querySelectorAll<HTMLInputElement>('input[name=dl-gen]').forEach((input) => input.addEventListener('change', () => {
      screen.querySelector('#dl-selected-hero')!.innerHTML = selectedHeroHtml(data, input.value as GeneralId);
    }));
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
    const relBadge = relation !== 'neutral' ? ` <span class="dl-${relation === 'quarry' ? 'strong' : 'weak'}">${relation === 'quarry' ? 'quarry — your hero has class advantage' : 'nemesis — enemy hero has class advantage'}</span>` : '';
    const doctrine = e.doctrine ? ` <span class="dl-stage">(${e.doctrine} doctrine: enemy disposition mix)</span>` : '';
    return `<strong>${e.boss ? '👑 Boss · ' : ''}${esc(e.name)}</strong>${doctrine}${badge}${relBadge}
      ${esc(g.name)} Lv ${g.level} · HP ${Math.round(g.hp)} · ${troops.length} troops (${byStage.map((n, i) => (n ? `${n} stage ${i + 1}` : '')).filter(Boolean).join(', ')})<br>
      ${[...byClass].map(([c, n]) => `${esc(className(c))} ×${n}`).join(', ')}<br>
      <span class="dl-dim">Your classes vs them: ${edges}</span>`;
  }

  function renderSelect(s: RunState): void {
    screen.innerHTML = `${header(s)}
      <div class="dl-panel"><h2>Choose your next battle</h2>
        <p class="dl-dim">Enemies commit first. Once you march, the enemy will not change.</p>
        ${s.offers.map((e) => `<button class="dl-choice" data-enc="${e.id}">${enemySummary(e, s)}</button>`).join('')}
        ${campaignHelpHtml(data)}
        <div class="dl-issues" role="status"></div>
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
      const vets = g.troops.map((t, i) => `<div>${esc(t.name)} — Lv ${t.level} (${t.xp} XP) · <span data-veteran-unit="${g.unit.id}" data-veteran-index="${i}"></span></div>`).join('');
      return `<tr>
        <td><canvas class="dl-unit-portrait" data-portrait="${g.unit.id}" aria-hidden="true" width="64" height="64"></canvas><strong>${esc(g.unit.name)}</strong> <span class="dl-stage">${esc(className(g.unit.classId))} ${g.unit.line} · stage ${g.unit.stage}</span>
          <details><summary>${g.troops.length} named ${esc(g.unit.name)} veterans</summary><div class="dl-vets">${vets}</div></details></td>
        <td class="dl-${edge}">${edge}</td>
        <td>Lv ${Math.min(...lv)}${Math.max(...lv) > Math.min(...lv) ? `–${Math.max(...lv)}` : ''}</td>
        <td><input type="number" min="0" step="1" max="${g.troops.length}" value="${a.count}" data-count="${g.unit.id}" data-testid="composition-input" aria-describedby="dl-plan-issues" aria-label="Deploy ${esc(g.unit.name)}"> / ${g.troops.length}</td>
        <td><select data-squad="${g.unit.id}" aria-label="Squad for ${esc(g.unit.name)}">${squadOptions(a.squad)}</select></td>
      </tr>`;
    }).join('');
    const squadHeads = p.squads.map((q, i) => `<label>${i + 1}. <input value="${esc(q.name)}" data-sqname="${i}" size="9" aria-label="Squad ${i + 1} name">
      <select data-sqdisp="${i}" aria-label="Squad ${i + 1} disposition">${DISPOSITIONS.map((d) => `<option ${d === q.disposition ? 'selected' : ''}>${d}</option>`).join('')}</select></label>`).join('');
    screen.innerHTML = `${header(s)}
      <div class="dl-row">
        <div class="dl-panel"><h2>Enemy</h2>${enemySummary(e, s)}
          <ul class="dl-enemy-squads">${e.side.squads.map((q) => `<li>${esc(q.name)} (${q.disposition}, ${q.troops.length})</li>`).join('')}</ul>
          <p class="dl-dim">Formation: ${esc(data.formationById.get(e.side.formationId)?.name ?? e.side.formationId)}</p>
        </div>
        <div class="dl-panel"><h2>Your general</h2>
          <canvas class="dl-hero-portrait" data-portrait="${data.generalById.get(s.hero.generalId)!.unitId}" aria-hidden="true" width="96" height="96"></canvas>
          <p>${esc(data.generalById.get(s.hero.generalId)!.name)} · Lv ${s.hero.level}</p>
          <p><strong>Special:</strong> ${esc(data.generalById.get(s.hero.generalId)!.special.name)} — ${esc(data.generalById.get(s.hero.generalId)!.special.description)}</p>
          <p class="dl-dim">Upgrades: vitality ${s.hero.upgrades.vitality}, might ${s.hero.upgrades.might}, mastery ${s.hero.upgrades.mastery}</p>
          <label>Formation: <select id="dl-formation">${data.formations.map((f) => `<option value="${f.id}" ${f.id === p.formationId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
          <p><button id="dl-auto" data-testid="auto-arrange">Auto-arrange</button></p>
        </div>
      </div>
      <div class="dl-panel"><h2>Deploy your company</h2>
        <p class="dl-dim">Choose species counts and squads. Highest-level veterans deploy first; expand named veterans to inspect who is deployed.</p>
        <div class="dl-squad-head">${squadHeads}</div>
        <div class="dl-table-scroll" role="region" aria-label="Company composition" tabindex="0"><table><thead><tr><th>Species</th><th>vs enemy</th><th>Levels</th><th>Deploy</th><th>Squad</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${campaignHelpHtml(data)}
      </div>
      <div class="dl-action-summary">
        <div><strong><span id="dl-total"></span> / ${data.constants.MAX_COMPANY} deployed · <span id="dl-benched"></span> benched</strong>
        <div class="dl-issues" id="dl-plan-issues" role="status"></div></div>
        <button class="dl-primary dl-start" id="dl-fight" data-testid="fight" aria-describedby="dl-plan-issues">Fight!</button>
      </div>`;
    wireHeader();

    const refresh = () => {
      const total = Object.values(p.assignment).reduce((n, a) => n + (Number.isInteger(a.count) && a.count > 0 ? a.count : 0), 0);
      screen.querySelector('#dl-total')!.textContent = String(total);
      screen.querySelector('#dl-benched')!.textContent = String(Math.max(0, s.roster.length - total));
      screen.querySelectorAll<HTMLElement>('[data-veteran-unit]').forEach((el) => {
        el.textContent = Number(el.dataset.veteranIndex) < (p.assignment[el.dataset.veteranUnit!]?.count ?? 0) ? 'Deployed' : 'Benched';
      });
      const issues = planIssues(data, s.roster, p);
      screen.querySelectorAll<HTMLInputElement>('[data-count]').forEach((input) => {
        const count = p.assignment[input.dataset.count!]?.count ?? 0;
        const available = groups.find((g) => g.unit.id === input.dataset.count)?.troops.length ?? 0;
        input.setAttribute('aria-invalid', String(!Number.isInteger(count) || count < 0 || count > available));
      });
      screen.querySelector('.dl-issues')!.textContent = issues.join(' ');
      screen.querySelector<HTMLButtonElement>('#dl-fight')!.disabled = issues.length > 0;
    };
    screen.querySelectorAll<HTMLInputElement>('[data-count]').forEach((inp) => inp.addEventListener('input', () => {
      const id = inp.dataset.count!;
      p.assignment[id] = { squad: p.assignment[id]?.squad ?? 0, count: inp.valueAsNumber };
      refresh();
    }));
    screen.querySelectorAll<HTMLSelectElement>('[data-squad]').forEach((sel) => sel.addEventListener('change', () => {
      const id = sel.dataset.squad!;
      p.assignment[id] = { count: p.assignment[id]?.count ?? 0, squad: Number(sel.value) };
      refresh();
    }));
    screen.querySelectorAll<HTMLInputElement>('[data-sqname]').forEach((inp) => inp.addEventListener('input', () => { p.squads[Number(inp.dataset.sqname)]!.name = inp.value || `Squad ${Number(inp.dataset.sqname) + 1}`; refresh(); }));
    screen.querySelectorAll<HTMLSelectElement>('[data-sqdisp]').forEach((sel) => sel.addEventListener('change', () => { p.squads[Number(sel.dataset.sqdisp)]!.disposition = sel.value as Disposition; }));
    screen.querySelector<HTMLSelectElement>('#dl-formation')!.addEventListener('change', (ev) => { p.formationId = (ev.target as HTMLSelectElement).value; });
    screen.querySelector('#dl-auto')!.addEventListener('click', () => { plan = autoPlan(data, s.roster, p.formationId); render(); screen.querySelector<HTMLButtonElement>('#dl-auto')!.focus(); });
    screen.querySelector('#dl-fight')!.addEventListener('click', () => guard(() => {
      if (planIssues(data, s.roster, p).length) return refresh();
      commit(startBattle(data, s, planToArmy(data, s.roster, p)));
    }));
    drawPortraits();
    refresh();
  }

  // ------------------------------------------------------------ battle
  function renderBattle(s: RunState): void {
    const battle = s.battle!;
    screen.style.display = 'none';
    const container = document.createElement('div');
    battleRoot = container;
    container.className = 'dl-battle-root';
    root.appendChild(container);
    const isActive = () => !destroyed && battleRoot === container && state?.phase === 'battle' && state.battle?.id === battle.id;
    const finish = (world: World) => {
      if (!isActive() || !world.result) return;
      plan = null;
      commit(applyBattleResult(data, state!, battle.id, world.result));
    };
    const quit = (world: World) => {
      if (!isActive() || world.result) return;
      const next = forfeitBattle(state!, battle.id, playerDeadIds(world));
      commit(next);
      plan = null;
    };
    const labels = { player: data.generalById.get(s.hero.generalId)!.name, enemy: s.encounter!.name };
    void (async () => {
      try {
        const mod: { startBattleView: StartBattleView } = await import('../../battle/view');
        if (!isActive()) return;
        const view = await mod.startBattleView(container, {
          data, setup: battle.setup, labels, onFinished: finish, onQuit: quit,
          quitMessage: 'Quitting forfeits this campaign run. Troops already fallen stay lost. No rewards will be earned.',
          quitConfirmLabel: 'Forfeit run',
        });
        if (!isActive()) view.destroy();
        else battleView = view;
      } catch (err) {
        if (!isActive()) return;
        console.error('Battle view failed to start; resolving headlessly.', err);
        finish(runHeadlessBattle(data, battle.setup));
      }
    })();
  }

  // ------------------------------------------------------------ rewards / end
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
    screen.innerHTML = `${header(s)}${resultHtml(data, s)}
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
    screen.innerHTML = `${header(s)}
      <h2>${won ? 'The campaign is won.' : s.lastSummary?.forfeited ? 'You forfeited the run.' : 'Your general has fallen. The run is over.'}</h2>
      ${resultHtml(data, s)}
      <div class="dl-panel"><p>Company roster retained: ${s.roster.length} troops.</p>
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
      battleView = null;
      battleRoot?.remove();
      battleRoot = null;
      screen.remove();
    },
  };
}
