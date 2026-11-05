import type { GameData, GeneralId } from '../../data';
import { createWar, type BuiltWorldData, type War } from '../../world';
import { defaultStartingSplit, validateWarStart } from './startLogic';
import './start.css';

export interface WarStartOptions { data: GameData; worldData: BuiltWorldData; seed: number; onBegin: (war: War) => void; onBack?: () => void }
export interface WarStartFixture { root: HTMLElement; options: WarStartOptions; handle: { destroy(): void } }

/** Browser parent-QA fixture: mount the actual control surface and exercise it with real keyboard/pointer input. */
export function createWarStartBrowserFixture(root: HTMLElement, options: WarStartOptions): WarStartFixture {
  return { root, options, handle: mountWarStart(root, options) };
}

export function mountWarStart(root: HTMLElement, options: WarStartOptions): { destroy(): void } {
  const { data, worldData } = options;
  const shell = document.createElement('section'); shell.className = 'dl-war-start';
  shell.setAttribute('aria-labelledby', 'dl-war-start-title');
  const heading = document.createElement('h1'); heading.id = 'dl-war-start-title'; heading.textContent = 'Start a new war'; shell.append(heading);
  const layout = document.createElement('div'); layout.className = 'dl-war-start__layout'; shell.append(layout);
  const choices = document.createElement('div'); choices.className = 'dl-war-start__heroes'; choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Choose your hero');
  const profile = document.createElement('section'); profile.className = 'dl-war-start__profile dl-panel'; profile.setAttribute('aria-live', 'polite');
  const setup = document.createElement('section'); setup.className = 'dl-war-start__allocation dl-panel';
  const form = document.createElement('form'); form.noValidate = true;
  const heroName = document.createElement('input'); heroName.type = 'text'; heroName.maxLength = 40; heroName.setAttribute('aria-label', 'Hero name');
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Hero name'; nameLabel.append(heroName); form.append(nameLabel);
  const selected = data.generals[0]?.id;
  let selectedId: GeneralId | undefined = selected;
  for (const [i, g] of data.generals.entries()) {
    const unit = data.unitById.get(g.unitId)!; const klass = data.classById.get(unit.classId)!;
    const label = document.createElement('label'); label.className = 'dl-war-start__hero';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'dl-war-hero'; radio.value = g.id; radio.checked = i === 0; radio.setAttribute('aria-label', g.name);
    const title = document.createElement('strong'); title.textContent = g.name;
    const meta = document.createElement('span'); meta.textContent = `${klass.name} · ${unit.line}`;
    label.append(radio, title, meta); choices.append(label);
    radio.addEventListener('change', () => { if (radio.checked) { selectedId = g.id; renderProfile(); refresh(); } });
  }
  const profileTitle = document.createElement('h2'); const detail = document.createElement('p'); const special = document.createElement('p'); profile.append(profileTitle, detail, special);
  function renderProfile(): void {
    const g = selectedId ? data.generalById.get(selectedId) : undefined;
    if (!g) { profileTitle.textContent = 'Choose a hero'; detail.textContent = ''; special.textContent = ''; return; }
    const unit = data.unitById.get(g.unitId)!; const klass = data.classById.get(unit.classId)!;
    profileTitle.textContent = g.name; detail.textContent = `${klass.name} · ${unit.name} · ${unit.line} role · ${g.hp} HP`;
    special.textContent = `${g.special.name}: ${g.special.description}`;
  }
  const split = defaultStartingSplit(worldData);
  const allocationHeading = document.createElement('h2'); allocationHeading.textContent = 'Starting troops'; form.append(allocationHeading);
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < split.length; i++) {
    const label = document.createElement('label'); label.textContent = i === 0 ? 'Hero' : `General ${i}`;
    const input = document.createElement('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = String(worldData.constants.STARTING_CAPACITY); input.step = '1'; input.value = String(split[i]); input.setAttribute('aria-label', `${label.textContent} troop count`); input.required = true;
    input.addEventListener('input', () => refresh()); label.append(input); form.append(label); inputs.push(input);
  }
  const remaining = document.createElement('p'); remaining.className = 'dl-war-start__remaining'; remaining.setAttribute('aria-live', 'polite'); form.append(remaining);
  const errors = document.createElement('div'); errors.className = 'dl-error dl-war-start__errors'; errors.setAttribute('role', 'alert'); form.append(errors);
  let destroyed = false, submitting = false, completed = false;
  const actions = document.createElement('div'); actions.className = 'dl-war-start__actions';
  const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back';
  const begin = document.createElement('button'); begin.type = 'submit'; begin.textContent = 'Begin war'; begin.className = 'dl-primary'; actions.append(back, begin); form.append(actions);
  back.addEventListener('click', () => { if (!destroyed) options.onBack?.(); });
  form.addEventListener('submit', event => { event.preventDefault(); if (destroyed || submitting || completed) return; refresh(); if (begin.disabled) return; submitting = true; begin.disabled = true; try { const war = createWar(worldData, { seed: options.seed, heroId: selectedId!, heroName: heroName.value.trim(), split: inputs.map(input => input.value === '' ? Number.NaN : input.valueAsNumber) }); if (!destroyed) options.onBegin(war); } catch (error) { if (!destroyed) { submitting = false; refresh(); errors.textContent = `${errors.textContent}${errors.textContent ? ' ' : ''}${error instanceof Error ? error.message : String(error)}`; } return; } if (!destroyed) { errors.textContent = ''; completed = true; begin.disabled = true; } });
  setup.append(form); layout.append(choices, profile, setup); root.replaceChildren(shell);
  function refresh(): void {
    if (destroyed) return;
    const values = inputs.map(input => input.value === '' ? Number.NaN : input.valueAsNumber);
    // The form and the pure validator must never drift: one rule set, one call.
    const check = validateWarStart(data, worldData, selectedId as GeneralId, heroName.value, values);
    remaining.textContent = check.remaining >= 0 ? `${check.remaining} troops remaining` : `${-check.remaining} troops overallocated`;
    errors.textContent = check.errors.join(' ');
    begin.disabled = submitting || completed || !check.valid;
  }
  heroName.addEventListener('input', refresh);
  function destroy(): void { if (destroyed) return; destroyed = true; root.replaceChildren(); }
  renderProfile(); refresh();
  return { destroy };
}
