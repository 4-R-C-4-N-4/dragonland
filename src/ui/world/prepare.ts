// Fight preparation: choose which pool troops the fighting general takes, how they split into
// squads, each squad's disposition and the formation. Same planner as the Skirmish prepare
// screen (src/ui/run/logic.ts), built with DOM and capped at the general's command.
import type { Disposition, GameData } from '../../data';
import type { War } from '../../world';
import { fightPool, type WarArmy } from '../../world/army';
import { maxMpOf, mpOf } from '../../world/mp';
import { classEdge, planToArmy, speciesGroups, type ArmyPlan } from '../run/logic';
import { initialPlan, planProblems, planWarnings, troopsByClass } from './prepareLogic';
import './prepare.css';

export interface PrepareOptions {
  data: GameData;
  war: War;
  generalId: string;
  title: string;
  /** What the player may know about the other side, one line each. */
  enemyLines: string[];
  /** Enemy troops visible to the player (for counter hints); empty when unknown. */
  enemyTroops: { unitId: string }[];
  /** Troops Auto-arrange deploys (default: the command limit), e.g. a fair share of the pool. */
  share?: number;
  /** One line under the plan explaining the default, e.g. why only a share is deployed. */
  shareNote?: string;
  onFight: (army: WarArmy) => void;
  onBack: () => void;
}

const DISPOSITIONS: Disposition[] = ['mixed', 'fierce', 'guard'];
const DISPOSITION_HELP: Record<Disposition, string> = { mixed: 'fights the nearest troops', fierce: 'drives for the enemy general', guard: 'protects your general' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountPrepare(root: HTMLElement, opts: PrepareOptions): { destroy(): void } {
  const { data, war } = opts;
  const general = war.generals.find(g => g.id === opts.generalId)!;
  const profile = data.generalById.get(general.generalId)!;
  const pool = fightPool(war, general.id);
  const limit = Math.min(general.capacity, data.constants.MAX_COMPANY);
  const groups = speciesGroups(data, pool);
  const enemyClasses = troopsByClass(data, opts.enemyTroops);
  const share = Math.min(limit, opts.share ?? limit);
  let plan: ArmyPlan = initialPlan(data, pool, share);
  let destroyed = false;

  const box = el('section', 'dl-campaign__panel dl-panel dl-prepare');
  const h = el('h1', undefined, opts.title); h.tabIndex = -1;
  const top = el('div', 'dl-prepare__top');
  const enemy = el('div', 'dl-prepare__enemy');
  enemy.append(el('h2', undefined, 'You face'));
  for (const line of opts.enemyLines) enemy.append(el('p', undefined, line));
  const mine = el('div', 'dl-prepare__mine');
  mine.append(el('h2', undefined, `${general.name} (${profile.name})`),
    el('p', undefined, `${Math.round(general.hp)}/${general.maxHp} HP · MP ${Math.floor(mpOf(general))}/${maxMpOf(general)} · commands up to ${limit} troops · ${pool.length} in the division`),
    el('p', 'dl-prepare__special', `${profile.special.name}: ${profile.special.description}`));
  if (general.isHero) mine.append(el('p', 'dl-prepare__warn', `${general.name} is your hero: if they fall, the war is lost.`));
  const formation = el('select'); formation.setAttribute('aria-label', 'Formation');
  for (const f of data.formations) { const o = el('option', undefined, f.name); o.value = f.id; formation.append(o); }
  const formationLabel = el('label', 'dl-prepare__formation', 'Formation '); formationLabel.append(formation);
  const auto = el('button', undefined, 'Auto-arrange'); auto.type = 'button';
  mine.append(formationLabel, auto);
  top.append(enemy, mine);

  const squadsRow = el('div', 'dl-prepare__squads');
  const table = el('table', 'dl-prepare__table');
  const thead = el('thead'); const hr = el('tr');
  for (const t of ['Troops', 'vs enemy', 'Deploy', 'Squad']) hr.append(el('th', undefined, t));
  thead.append(hr); const tbody = el('tbody'); table.append(thead, tbody);
  const scroll = el('div', 'dl-prepare__scroll'); scroll.append(table);
  const footer = el('div', 'dl-prepare__footer');
  const totals = el('strong'); const issues = el('div', 'dl-prepare__issues'); issues.setAttribute('role', 'status');
  const notes = el('div', 'dl-prepare__notes');
  const back = el('button', undefined, 'Back'); back.type = 'button';
  const fight = el('button', 'dl-primary', 'Fight!'); fight.type = 'button';
  const summary = el('div'); summary.append(totals, notes, issues);
  const actions = el('div', 'dl-prepare__actions'); actions.append(back, fight);
  footer.append(summary, actions);
  box.append(h, top, el('h2', undefined, 'Squads'), squadsRow, scroll, footer);
  root.replaceChildren(box);

  function renderSquads(): void {
    squadsRow.replaceChildren();
    plan.squads.forEach((q, i) => {
      const card = el('label', 'dl-prepare__squad');
      card.append(el('b', undefined, `${i + 1}. ${q.name}`));
      const sel = el('select'); sel.setAttribute('aria-label', `Squad ${i + 1} behaviour`);
      for (const d of DISPOSITIONS) { const o = el('option', undefined, d[0]!.toUpperCase() + d.slice(1)); o.value = d; o.selected = d === q.disposition; sel.append(o); }
      const help = el('small', undefined, DISPOSITION_HELP[q.disposition]);
      sel.addEventListener('change', () => { q.disposition = sel.value as Disposition; help.textContent = DISPOSITION_HELP[q.disposition]; refresh(); });
      card.append(sel, help);
      squadsRow.append(card);
    });
  }

  function renderRows(): void {
    tbody.replaceChildren();
    for (const g of groups) {
      const a = plan.assignment[g.unit.id] ?? { count: 0, squad: 0 };
      const tr = el('tr');
      const name = el('td');
      const chip = el('span', 'dl-prepare__chip', data.classById.get(g.unit.classId)!.name);
      chip.style.setProperty('--class-color', data.classById.get(g.unit.classId)!.color);
      name.append(el('strong', undefined, g.unit.name), ' ', chip, el('small', undefined, ` ${g.unit.line} · stage ${g.unit.stage}`));
      const edge = enemyClasses.size ? classEdge(data, g.unit.classId, enemyClasses) : 'neutral';
      const edgeCell = el('td', `dl-prepare__edge dl-prepare__edge--${edge}`, enemyClasses.size ? (edge === 'strong' ? 'strong' : edge === 'weak' ? 'weak' : 'even') : '—');
      const count = el('input'); count.type = 'number'; count.min = '0'; count.step = '1'; count.max = String(g.troops.length); count.value = String(a.count);
      count.setAttribute('aria-label', `Deploy ${g.unit.name}`);
      count.addEventListener('input', () => { plan.assignment[g.unit.id] = { squad: plan.assignment[g.unit.id]?.squad ?? 0, count: count.valueAsNumber }; refresh(); });
      const countCell = el('td'); countCell.append(count, ` / ${g.troops.length}`);
      const squad = el('select'); squad.setAttribute('aria-label', `Squad for ${g.unit.name}`);
      plan.squads.forEach((q, i) => { const o = el('option', undefined, `${i + 1}. ${q.name}`); o.value = String(i); o.selected = i === a.squad; squad.append(o); });
      squad.addEventListener('change', () => { plan.assignment[g.unit.id] = { count: plan.assignment[g.unit.id]?.count ?? 0, squad: Number(squad.value) }; refresh(); });
      const squadCell = el('td'); squadCell.append(squad);
      tr.append(name, edgeCell, countCell, squadCell);
      tbody.append(tr);
    }
  }

  function refresh(): void {
    if (destroyed) return;
    const total = Object.values(plan.assignment).reduce((n, a) => n + (Number.isInteger(a.count) && a.count > 0 ? a.count : 0), 0);
    totals.textContent = `${total} / ${limit} deployed · ${Math.max(0, pool.length - total)} stay in reserve`;
    const problems = planProblems(data, pool, plan, limit);
    issues.textContent = problems.join(' ');
    notes.textContent = [...planWarnings(data, pool, plan), ...(opts.shareNote ? [opts.shareNote] : [])].join(' ');
    fight.disabled = problems.length > 0;
  }

  function renderAll(): void { formation.value = plan.formationId; renderSquads(); renderRows(); refresh(); }

  formation.addEventListener('change', () => { plan.formationId = formation.value; });
  auto.addEventListener('click', () => { plan = initialPlan(data, pool, share, plan.formationId); renderAll(); auto.focus(); });
  back.addEventListener('click', () => { if (!destroyed) opts.onBack(); });
  fight.addEventListener('click', () => {
    if (destroyed || planProblems(data, pool, plan, limit).length) return refresh();
    fight.disabled = true;
    opts.onFight(planToArmy(data, pool, plan));
  });

  renderAll();
  h.focus();
  return { destroy() { if (destroyed) return; destroyed = true; box.remove(); } };
}
