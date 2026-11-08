import type { ClassId, GameData, GeneralId } from '../../data';
import { getRunConfig } from '../../run/config';
import { createWar, type BuiltWorldData, type War } from '../../world';
import { huntOrder, huntRelations, startingArmySummary, validateWarStart, vertex } from './startLogic';
import './start.css';

export interface WarStartOptions { data: GameData; worldData: BuiltWorldData; seed: number; onBegin: (war: War) => void; onBack?: () => void }
export interface WarStartFixture { root: HTMLElement; options: WarStartOptions; handle: { destroy(): void } }

/** Browser parent-QA fixture: mount the actual control surface and exercise it with real keyboard/pointer input. */
export function createWarStartBrowserFixture(root: HTMLElement, options: WarStartOptions): WarStartFixture {
  return { root, options, handle: mountWarStart(root, options) };
}

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 640, C = SIZE / 2, R_CLASS = 160, R_HERO = 268, NODE = 44, TOKEN_GAP = 96;
const LINE_LABEL: Record<string, string> = { Z: 'sturdy', A: 'striker', M: 'balanced' };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}
function html<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Hero picker as the hunt star: the five classes on a pentagon, ordered so each class's quarry
 * is two points away (the star lines) and its starting ally sits next to it (the pentagon).
 * Choosing a hero lights its quarry, nemesis and ally.
 */
export function mountWarStart(root: HTMLElement, options: WarStartOptions): { destroy(): void } {
  const { data, worldData } = options;
  const run = getRunConfig();
  const order = huntOrder(data);
  const classPos = new Map(order.map((c, i) => [c, vertex(i, order.length, C, C, R_CLASS)] as const));
  const classOf = (heroId: GeneralId) => data.unitById.get(data.generalById.get(heroId)!.unitId)!.classId;
  const className = (c: ClassId) => data.classById.get(c)!.name;
  const color = (c: ClassId) => data.classById.get(c)!.color;
  const pct = Math.round(data.constants.CLASS_MOD * 100);

  const shell = html('section', 'dl-war-start');
  shell.setAttribute('aria-labelledby', 'dl-war-start-title');
  const heading = html('h1', undefined, 'Choose your hero'); heading.id = 'dl-war-start-title';
  const lede = html('p', 'dl-war-start__lede', 'Every class hunts one class and is hunted by another: the star lines. Your hero marches with the ally beside it on the ring.');
  const layout = html('div', 'dl-war-start__layout');
  shell.append(heading, lede, layout);

  // ---- the star -------------------------------------------------------------
  const stage = html('div', 'dl-war-start__star');
  const plate = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true', class: 'dl-war-start__svg' });
  const defs = svg('defs', {}, plate);
  for (const [id, fill] of [['dl-arrow-quarry', '#7fd16b'], ['dl-arrow-nemesis', '#e0604f']] as const) {
    const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    svg('path', { d: 'M0,0 L10,5 L0,10 z', fill }, m);
  }
  svg('circle', { cx: C, cy: C, r: R_CLASS + NODE + 18, class: 'dl-war-start__ring' }, plate);
  const base = svg('g', {}, plate);
  const lit = svg('g', {}, plate);
  const nodes = svg('g', {}, plate);
  const at = (c: ClassId) => classPos.get(c)!;
  /** Segment between two class nodes, trimmed to their rims. */
  const seg = (a: ClassId, b: ClassId, pad = NODE + 6) => {
    const [x1, y1] = at(a), [x2, y2] = at(b);
    const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d;
    return { x1: x1 + ux * pad, y1: y1 + uy * pad, x2: x2 - ux * pad, y2: y2 - uy * pad };
  };
  order.forEach((c, i) => {
    svg('line', { ...seg(c, order[(i + 1) % order.length]!), class: 'dl-war-start__ally-edge' }, base);
    svg('line', { ...seg(c, order[(i + 2) % order.length]!), class: 'dl-war-start__hunt-edge' }, base);
  });
  const classNodes = new Map<ClassId, SVGGElement>();
  for (const c of order) {
    const [x, y] = at(c);
    const g = svg('g', { class: 'dl-war-start__class' }, nodes);
    svg('circle', { cx: x, cy: y, r: NODE, fill: color(c) }, g);
    const label = svg('text', { x, y: y + 5, 'text-anchor': 'middle' }, g); label.textContent = className(c);
    classNodes.set(c, g);
  }
  const centre = svg('text', { x: C, y: C + 6, 'text-anchor': 'middle', class: 'dl-war-start__centre' }, plate); centre.textContent = 'THE HUNT';
  stage.append(plate);

  // Hero tokens: real radio buttons over the plate, three per class fanned around its point.
  const tokens = html('div', 'dl-war-start__tokens');
  tokens.setAttribute('role', 'radiogroup'); tokens.setAttribute('aria-label', 'Heroes');
  const heroes: { id: GeneralId; button: HTMLButtonElement }[] = [];
  order.forEach((c, i) => {
    const members = data.generals.filter(g => classOf(g.id) === c).sort((a, b) => 'ZMA'.indexOf(data.unitById.get(a.unitId)!.line) - 'ZMA'.indexOf(data.unitById.get(b.unitId)!.line));
    members.forEach((g, k) => {
      // A row along the ring's tangent at this class's point, so the three never overlap.
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / order.length;
      const offset = (k - (members.length - 1) / 2) * TOKEN_GAP;
      const x = C + R_HERO * Math.cos(a) - Math.sin(a) * offset;
      const y = C + R_HERO * Math.sin(a) + Math.cos(a) * offset;
      const line = data.unitById.get(g.unitId)!.line;
      const b = html('button', 'dl-war-start__token');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.style.left = `${(x / SIZE) * 100}%`; b.style.top = `${(y / SIZE) * 100}%`;
      b.style.setProperty('--class-color', color(c));
      b.append(html('strong', undefined, g.name), html('span', undefined, `${line} · ${LINE_LABEL[line] ?? line}`));
      b.setAttribute('aria-label', `${g.name}, ${className(c)}, ${line} line`);
      b.addEventListener('click', () => select(g.id));
      tokens.append(b);
      heroes.push({ id: g.id, button: b });
    });
  });
  stage.append(tokens);

  // ---- the panel -----------------------------------------------------------
  const panel = html('section', 'dl-war-start__panel dl-panel');
  panel.setAttribute('aria-live', 'polite');
  const title = html('h2'); const meta = html('p', 'dl-war-start__meta'); const special = html('p', 'dl-war-start__special');
  const relations = html('ul', 'dl-war-start__relations');
  const army = html('p', 'dl-war-start__army');
  const form = html('form'); form.noValidate = true;
  const heroName = html('input'); heroName.type = 'text'; heroName.maxLength = 40; heroName.placeholder = 'Name your hero'; heroName.setAttribute('aria-label', 'Hero name');
  const nameLabel = html('label', 'dl-war-start__name', 'Hero name'); nameLabel.append(heroName);
  const errors = html('div', 'dl-error dl-war-start__errors'); errors.setAttribute('role', 'alert');
  const actions = html('div', 'dl-war-start__actions');
  const back = html('button', undefined, 'Back'); back.type = 'button';
  const begin = html('button', 'dl-primary', 'Begin war'); begin.type = 'submit';
  actions.append(back, begin);
  form.append(nameLabel, errors, actions);
  panel.append(title, meta, special, relations, army, form);
  layout.append(stage, panel);
  root.replaceChildren(shell);

  let selectedId: GeneralId = data.generals[0]!.id;
  let destroyed = false, submitting = false, completed = false;

  function relation(kind: 'quarry' | 'nemesis' | 'ally', c: ClassId, text: string): HTMLLIElement {
    const li = html('li', `dl-war-start__rel dl-war-start__rel--${kind}`);
    const chip = html('span', 'dl-war-start__chip', className(c)); chip.style.setProperty('--class-color', color(c));
    li.append(html('b', undefined, kind === 'quarry' ? 'Hunts' : kind === 'nemesis' ? 'Hunted by' : 'Ally'), chip, html('span', undefined, text));
    return li;
  }

  function render(): void {
    const g = data.generalById.get(selectedId)!;
    const unit = data.unitById.get(g.unitId)!;
    const mine = unit.classId;
    const rel = huntRelations(data, run, mine);
    for (const h of heroes) { const on = h.id === selectedId; h.button.setAttribute('aria-checked', String(on)); h.button.tabIndex = on ? 0 : -1; }
    for (const [c, node] of classNodes) node.setAttribute('data-role', c === mine ? 'self' : c === rel.quarry ? 'quarry' : c === rel.nemesis ? 'nemesis' : c === rel.ally ? 'ally' : 'other');
    lit.replaceChildren();
    svg('line', { ...seg(mine, rel.ally), class: 'dl-war-start__lit dl-war-start__lit--ally' }, lit);
    svg('line', { ...seg(mine, rel.quarry, NODE + 8), class: 'dl-war-start__lit dl-war-start__lit--quarry', 'marker-end': 'url(#dl-arrow-quarry)' }, lit);
    svg('line', { ...seg(rel.nemesis, mine, NODE + 8), class: 'dl-war-start__lit dl-war-start__lit--nemesis', 'marker-end': 'url(#dl-arrow-nemesis)' }, lit);
    title.textContent = g.name;
    meta.textContent = `${className(mine)} · ${unit.line} line (${LINE_LABEL[unit.line] ?? unit.line}) · ${g.hp} HP`;
    special.replaceChildren(html('b', undefined, g.special.name), document.createTextNode(` — ${g.special.description}`));
    relations.replaceChildren(
      relation('quarry', rel.quarry, `Your troops deal ${pct}% more to them, and take ${pct}% less.`),
      relation('nemesis', rel.nemesis, `They deal ${pct}% more to you, and take ${pct}% less.`),
      relation('ally', rel.ally, 'Neutral to you; half your starting army.'),
    );
    const start = startingArmySummary(selectedId);
    army.textContent = `You start alone with ${start.troops} troops: ${start.classes.map(className).join(' and ')}, ${start.perKind} of each kind. Beaten rival generals can be adopted into your army.`;
    refresh();
  }

  function refresh(): void {
    if (destroyed) return;
    const check = validateWarStart(data, selectedId, heroName.value);
    errors.textContent = heroName.value.length || heroName === document.activeElement ? check.errors.join(' ') : '';
    begin.disabled = submitting || completed || !check.valid;
  }

  function select(id: GeneralId, focus = false): void {
    if (destroyed) return;
    selectedId = id;
    render();
    if (focus) heroes.find(h => h.id === id)?.button.focus();
  }

  // Arrow keys walk the heroes around the star; Enter on a token moves on to naming.
  tokens.addEventListener('keydown', event => {
    const i = heroes.findIndex(h => h.id === selectedId);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step) { event.preventDefault(); select(heroes[(i + step + heroes.length) % heroes.length]!.id, true); }
    else if (event.key === 'Enter') { event.preventDefault(); heroName.focus(); }
  });
  heroName.addEventListener('input', refresh);
  back.addEventListener('click', () => { if (!destroyed) options.onBack?.(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (destroyed || submitting || completed) return;
    refresh();
    if (begin.disabled) { errors.textContent = validateWarStart(data, selectedId, heroName.value).errors.join(' '); heroName.focus(); return; }
    submitting = true; begin.disabled = true;
    try {
      const war = createWar(worldData, { seed: options.seed, heroId: selectedId, heroName: heroName.value.trim() });
      if (!destroyed) options.onBegin(war);
    } catch (error) {
      if (!destroyed) { submitting = false; refresh(); errors.textContent = error instanceof Error ? error.message : String(error); }
      return;
    }
    if (!destroyed) { completed = true; begin.disabled = true; }
  });

  function destroy(): void { if (destroyed) return; destroyed = true; root.replaceChildren(); }
  render();
  return { destroy };
}
