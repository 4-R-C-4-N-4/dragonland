// Fight preparation: choose which pool troops the fighting general takes, how they split into
// squads, each squad's disposition and the formation. Same planner as the Skirmish prepare
// screen (src/ui/run/logic.ts), built with DOM and capped at the general's command.
import type { Disposition, GameData } from '../../data';
import type { War } from '../../world';
import { fightPool, type WarArmy } from '../../world/army';
import { classEdge, planToArmy, speciesGroups, type ArmyPlan } from '../run/logic';
import { initialPlan, planProblems, planWarnings, troopsByClass } from './prepareLogic';
import { bar, chip, el, generalCard, heading, portrait } from '../common/kit';
import './prepare.css';

export interface PrepareOptions {
  data: GameData;
  war: War;
  generalId: string;
  /** Small line above the title saying where this fight is. */
  kicker: string;
  title: string;
  /** What the player may know about the other side: general cards and/or a troop strip. */
  enemyCards: HTMLElement[];
  /** One line under "You face", e.g. that the enemy answers after you commit. */
  enemyNote?: string;
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

  const box = el('section', 'dl-campaign__panel dl-campaign__panel--wide dl-panel dl-prepare dl-enter');
  const head = heading(opts.kicker, opts.title);
  const h = head.h1;
  const top = el('div', 'dl-versus dl-prepare__top');
  const mine = el('div', 'dl-versus__side dl-versus__side--own');
  const mineHead = el('h2', undefined, 'Your general'); mineHead.append(el('small', undefined, `leads up to ${limit} of the division's ${pool.length} troops`));
  mine.append(mineHead, generalCard(general, { tone: 'own', troops: false, note: `${profile.special.name}: ${profile.special.description}` }));
  if (general.isHero) mine.append(el('p', 'dl-prepare__warn', `${general.name} is your hero: if they fall, the war is lost.`));
  const enemy = el('div', 'dl-versus__side dl-versus__side--foe');
  enemy.append(el('h2', undefined, 'You face'));
  if (opts.enemyNote) enemy.append(el('p', 'dl-versus__prompt', opts.enemyNote));
  enemy.append(...opts.enemyCards);
  top.append(mine, el('div', 'dl-versus__mid', 'VS'), enemy);

  const formation = el('select'); formation.setAttribute('aria-label', 'Formation');
  for (const f of data.formations) { const o = el('option', undefined, f.name); o.value = f.id; formation.append(o); }
  const formationLabel = el('label', 'dl-prepare__formation', 'Formation '); formationLabel.append(formation);
  const auto = el('button', undefined, 'Auto-arrange'); auto.type = 'button';
  const squadsHead = el('div', 'dl-prepare__bar');
  squadsHead.append(el('h2', undefined, 'Squads'), el('p', 'dl-versus__prompt', 'Up to four squads. Each keeps its behaviour for the whole fight.'), formationLabel, auto);

  const squadsRow = el('div', 'dl-prepare__squads');
  const table = el('table', 'dl-prepare__table');
  const thead = el('thead'); const hr = el('tr');
  for (const t of ['Troops', 'Against them', 'Send', 'Squad']) hr.append(el('th', undefined, t));
  thead.append(hr); const tbody = el('tbody'); table.append(thead, tbody);
  const scroll = el('div', 'dl-prepare__scroll'); scroll.append(table);
  const footer = el('div', 'dl-prepare__footer');
  const meter = bar('troops', 0, limit, '');
  const issues = el('div', 'dl-prepare__issues'); issues.setAttribute('role', 'status');
  const notes = el('div', 'dl-prepare__notes');
  const back = el('button', undefined, 'Back'); back.type = 'button';
  const fight = el('button', 'dl-primary', 'Fight!'); fight.type = 'button';
  const summary = el('div', 'dl-prepare__summary'); summary.append(meter, notes, issues);
  const actions = el('div', 'dl-prepare__actions'); actions.append(back, fight);
  footer.append(summary, actions);
  const tip = el('p', 'dl-prepare__tip', 'In battle: Space pauses so you can give orders, 1-4 pick a squad, Q W E set its order, and S casts your general\'s special once MP is full.');
  box.append(head.kicker, h, top, squadsHead, squadsRow, scroll, footer, tip);
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
      const kind = chip(data.classById.get(g.unit.classId)!.name, { color: data.classById.get(g.unit.classId)!.color });
      const label = el('span', 'dl-prepare__unit');
      label.append(el('strong', undefined, g.unit.name), kind, el('small', undefined, `stage ${g.unit.stage}`));
      name.append(portrait(g.unit.id, 30), label);
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
    meter.style.setProperty('--v', String(Math.max(0, Math.min(1, limit ? total / limit : 0))));
    meter.classList.toggle('dl-meter--foe', total > limit);
    meter.querySelector('span')!.textContent = `${total} of ${limit} sent · ${Math.max(0, pool.length - total)} held back`;
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
