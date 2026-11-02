import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGameData } from '../../src/data';
import { chooseEncounter, loadRun, newRun, saveRun, type BattleSummary } from '../../src/run';
import { mountRun } from '../../src/ui/run';
import { campaignHelpHtml, heroChoicesHtml, selectedHeroHtml, resultHtml } from '../../src/ui/run/presentation';

const data = getGameData();

describe('campaign presentation', () => {
  it('keeps all fifteen heroes selectable with explicit names and a checked default', () => {
    const html = heroChoicesHtml(data, 'paladin');
    expect(html.match(/data-testid="hero-card"/g)).toHaveLength(15);
    expect(html.match(/ checked/g)).toHaveLength(1);
    for (const hero of data.generals) {
      expect(html).toContain(`value="${hero.id}"`);
      expect(html).toContain(`aria-label="${hero.name}"`);
    }
    expect(html).toContain('Human');
  });
  it('updates the selected summary with the actual special and starting pair', () => {
    for (const hero of data.generals) {
      const html = selectedHeroHtml(data, hero.id);
      expect(html).toContain(hero.name);
      expect(html).toContain(hero.special.name);
      expect(html).toContain('Starts with');
      expect(html).toContain('Selected hero');
    }
  });
  it('separates recovered wounded and permanent losses and renders actual progression', () => {
    const run = newRun(data, { seed: 3, generalId: 'paladin' });
    const summary: BattleSummary = {
      battleId: 'test', won: true, boss: false,
      dead: [{ id: 'd', name: '<Lost>', unitId: run.roster[0]!.unitId }],
      recovered: [{ id: 'r', name: 'Returned', unitId: run.roster[0]!.unitId }],
      xpAwarded: 25, levelUps: 2,
      evolutions: [{ troopId: 'v', name: 'Veteran', from: data.units[0]!.id, to: data.units[1]!.id }],
      heroLevelFrom: 1, heroLevelTo: 2, unlockedClass: 'mage',
    };
    const html = resultHtml(data, { ...run, lastSummary: summary });
    expect(html).toContain('Recovered wounded (1)');
    expect(html).toContain('Permanent losses (1)');
    expect(html).toContain('Returned');
    expect(html).toContain('&lt;Lost&gt;');
    expect(html).not.toContain('<Lost>');
    expect(html).toContain('Promotions / evolutions (1)');
    expect(html).toContain('General level: 1 → 2');
    expect(html).toContain('New class unlocked: Mage');
    expect(html).toContain('25 XP');
    // Older persisted summaries do not identify deployed survivors or bench counts.
    expect(html).toContain('Company roster retained: 60');
    expect(html).not.toContain('60 survivors');
  });
  it('does not claim recovery, XP or upgrades after defeat', () => {
    const run = newRun(data, { seed: 3, generalId: 'paladin' });
    const summary: BattleSummary = { battleId: 'loss', won: false, boss: false, dead: [], recovered: [], xpAwarded: 0, levelUps: 0, evolutions: [], heroLevelFrom: 1, heroLevelTo: 1 };
    const html = resultHtml(data, { ...run, lastSummary: summary });
    expect(html).toContain('Recovered wounded (0)');
    expect(html).toContain('Permanent losses (0)');
    expect(html).not.toContain('XP each');
    expect(html).toContain('No hero upgrade awaiting choice');
  });
  it('reports actual deployed survivors separately from wounded, losses and bench', () => {
    const run = newRun(data, { seed: 3, generalId: 'paladin' });
    const troop = run.roster[0]!;
    const summary: BattleSummary = {
      battleId: 'counts', won: true, boss: false,
      survived: [{ ...troop, name: '<Survivor>' }, run.roster[1]!], benched: 17,
      recovered: [run.roster[2]!], dead: [run.roster[3]!],
      xpAwarded: 25, levelUps: 0, evolutions: [], heroLevelFrom: 1, heroLevelTo: 1,
    };
    const html = resultHtml(data, { ...run, lastSummary: summary });
    expect(html).toContain('Surviving deployment (2)');
    expect(html).toContain('&lt;Survivor&gt;');
    expect(html).toContain('Benched: 17');
    expect(html).toContain('Recovered wounded (1)');
    expect(html).toContain('Permanent losses (1)');
    expect(html).toContain('Company roster retained: 60');
    const empty = resultHtml(data, { ...run, lastSummary: { ...summary, survived: [], benched: 0 } });
    expect(empty).toContain('Surviving deployment (0)');
    expect(empty).toContain('Benched: 0');
    for (const legacy of [{ ...summary, survived: undefined }, { ...summary, benched: undefined }, { ...summary, survived: undefined, benched: undefined }]) {
      const oldHtml = resultHtml(data, { ...run, lastSummary: legacy });
      if (legacy.survived === undefined) {
        expect(oldHtml).toContain('Surviving deployment: not recorded in this saved result');
        expect(oldHtml).not.toContain('Surviving deployment (0)');
      }
      if (legacy.benched === undefined) {
        expect(oldHtml).toContain('Benched: not recorded in this saved result');
        expect(oldHtml).not.toContain('Benched: 0');
      }
    }
  });
  it('only promises a boon choice in rewards and reports won milestones as unspent', () => {
    const run = newRun(data, { seed: 3, generalId: 'paladin' });
    const lastSummary: BattleSummary = { battleId: 'boss', won: true, boss: true, dead: [], recovered: [], xpAwarded: 25, levelUps: 0, evolutions: [], heroLevelFrom: 9, heroLevelTo: 10 };
    const state = { ...run, lastSummary, pendingMilestones: [5, 10] };
    const won = resultHtml(data, { ...state, phase: 'won' });
    expect(won).toContain('Unspent general milestones at levels 5, 10');
    expect(won).not.toContain('awaits your choice');
    expect(won).not.toContain('upgrade available');
    expect(resultHtml(data, { ...state, phase: 'rewards' })).toContain('a boon awaits your choice');
  });
  it('explains that Mixed prioritizes enemy troops', () => {
    const html = campaignHelpHtml(data);
    expect(html).toContain('Mixed prioritizes enemy troops');
    expect(html).not.toContain('Mixed keeps the squad together');
  });
});

// Small DOM adapter for event wiring in Node; layout/focus rendering needs the parent browser gate.
class TestElement {
  private html = '';
  nodes: TestElement[] = [];
  children: TestElement[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  value = '';
  disabled = false;
  listeners = new Map<string, (() => void)[]>();
  get valueAsNumber(): number { return this.value === '' ? NaN : Number(this.value); }
  set innerHTML(html: string) {
    this.html = html;
    this.nodes = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map((match) => {
      const node = new TestElement();
      node.attrs.tag = match[1]!;
      for (const attr of match[2]!.matchAll(/([\w-]+)="([^"]*)"|\b(checked)\b/g)) {
        const key = attr[1] ?? attr[3]!;
        node.attrs[key] = attr[2] ?? '';
        if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = attr[2]!;
      }
      node.value = node.attrs.value ?? '';
      return node;
    });
  }
  get innerHTML(): string { return this.html; }
  querySelectorAll(selector: string): TestElement[] {
    return this.nodes.filter((node) => {
      if (selector.startsWith('#')) return node.attrs.id === selector.slice(1);
      if (selector.startsWith('.')) return node.attrs.class?.split(' ').includes(selector.slice(1));
      const match = selector.match(/^(\w+)?\[([\w-]+)(?:=([^\]]+))?\](:checked)?$/);
      if (match) return (!match[1] || node.attrs.tag === match[1]) && match[2]! in node.attrs && (!match[3] || node.attrs[match[2]!] === match[3]) && (!match[4] || 'checked' in node.attrs);
      return node.attrs.tag === selector;
    });
  }
  querySelector(selector: string): TestElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  appendChild(node: TestElement): void { this.children.push(node); }
  addEventListener(event: string, fn: () => void): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]); }
  dispatch(event: string): void { for (const fn of this.listeners.get(event) ?? []) fn(); }
  setAttribute(key: string, value: string): void { this.attrs[key] = value; }
  focus(): void { /* Browser checks verify actual focus presentation. */ }
  remove(): void { /* No layout tree needed. */ }
}

vi.mock('../../src/render/spriteSheets', () => ({ discoverSheets: () => new Map() }));
afterEach(() => vi.unstubAllGlobals());

it('wires zero/invalid composition to a disabled Fight and restores it after auto-arrange', () => {
  vi.stubGlobal('document', { createElement: () => new TestElement() });
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  saveRun(storage, chooseEncounter(newRun(data, { seed: 3, generalId: 'paladin' }), 'enc-0-0'));
  const root = new TestElement();
  const view = mountRun(root as unknown as HTMLElement, { data, storage, onSandbox: () => {} });
  const screen = root.children[0]!;
  const fight = screen.querySelector('#dl-fight')!;
  expect(fight.disabled).toBe(false);
  const inputs = screen.querySelectorAll('[data-count]');
  for (const input of inputs) { input.value = '0'; input.dispatch('input'); }
  expect(fight.disabled).toBe(true);
  expect(screen.querySelector('#dl-total')!.textContent).toBe('0');
  expect(screen.querySelector('#dl-benched')!.textContent).toBe('60');
  const first = inputs[0]!;
  first.value = '2.5'; first.dispatch('input');
  expect(fight.disabled).toBe(true);
  expect(first.attrs['aria-invalid']).toBe('true');
  expect(screen.querySelector('.dl-issues')!.textContent).toContain('invalid count');
  // Even a synthetic click must revalidate before starting a battle.
  fight.dispatch('click');
  const blocked = loadRun(storage, data);
  expect(blocked.kind).toBe('ok');
  if (blocked.kind === 'ok') expect(blocked.state.phase).toBe('prepare');
  screen.querySelector('#dl-auto')!.dispatch('click');
  expect(screen.querySelector('#dl-fight')!.disabled).toBe(false);
  expect(screen.querySelector('#dl-total')!.textContent).toBe('60');
  view.destroy();
});

it('places Begin above all heroes and starts with the selected hero after a change', () => {
  vi.stubGlobal('document', { createElement: () => new TestElement() });
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const root = new TestElement();
  const view = mountRun(root as unknown as HTMLElement, { data, storage, onSandbox: () => {} });
  const screen = root.children[0]!;
  expect(screen.innerHTML.indexOf('data-testid="begin-run"')).toBeLessThan(screen.innerHTML.indexOf('data-testid="hero-card"'));
  const radios = screen.querySelectorAll('input[name=dl-gen]');
  expect(radios).toHaveLength(15);
  for (const radio of radios) delete radio.attrs.checked;
  const selected = radios.at(-1)!;
  selected.attrs.checked = '';
  selected.dispatch('change');
  // Hero order is grouped by class; find the selected definition from its input.
  const actualHero = data.generals.find((g) => g.id === selected.value)!;
  expect(screen.querySelector('#dl-selected-hero')!.innerHTML).toContain(actualHero.name);
  screen.querySelector('#dl-new')!.dispatch('click');
  const saved = loadRun(storage, data);
  expect(saved.kind).toBe('ok');
  if (saved.kind === 'ok') expect(saved.state.hero.generalId).toBe(actualHero.id);
  expect(screen.innerHTML).toContain('Choose your next battle');
  view.destroy();
});
