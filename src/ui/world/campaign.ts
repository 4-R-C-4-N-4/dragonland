// Campaign controller: joins the war setup screen, the overworld map, battles and admin
// into one playable loop. All rules live in src/world (pure); this file renders, routes
// intents and persists one snapshot per transition.
import type { GameData } from '../../data';
import type { StartBattleView } from '../../battle/types';
import { campaignBattlePerspective, playerSideOf } from './battlePerspective';
import {
  adoptCaptive, applyWildResult, buildWorldData, cancelOrder, clearWar, completeAdmin, issueOrder, loadWar, rawWorldData,
  resolveTurn, resumeTurn, saveWar, wildBattleSetup, WILD_SEARCHER_SIDE,
  type BuiltWorldData, type StorageLike, type War, type WorldOrder,
} from '../../world';
import {
  applySkirmishResult, commitAttacker, commitDefender, retreatEncounter, sequenceEncounter,
  type EncounterSequence, type TerminalBattleSnapshot,
} from '../../world/sequence';
import type { BattleSetup } from '../../sim';
import { planFactionOrders } from '../../ai/strategy';
import { joinDivision, leaveAsGarrison } from '../../world/garrison';
import { mountWorldMap, type WorldMapSelection } from './index';
import { adoptionTarget } from './presentation';
import { mountWarStart } from './start';
import { mountPrepare } from './prepare';
import type { WarArmy } from '../../world/army';
import './campaign.css';

export interface CampaignOptions {
  data: GameData;
  storage: StorageLike;
  startBattleView: StartBattleView;
  /** Seed for a brand new war; existing saves keep their own. */
  seed?: number;
  onExit?: () => void;
}

type Screen = 'title' | 'setup' | 'map' | 'battle' | 'admin' | 'over';

export interface CampaignHandle {
  destroy(): void;
  /** Whether a war is loaded (in progress or just ended). */
  hasWar(): boolean;
  /** Leave whatever is on screen (even a battle) for the war's title screen; the save stays. */
  toTitle(): void;
  /** Delete the saved war and go to the hero picker. */
  abandonWar(): void;
}

export function mountCampaign(root: HTMLElement, opts: CampaignOptions): CampaignHandle {
  const { data, storage } = opts;
  const world: BuiltWorldData = buildWorldData(rawWorldData);
  const playerId = world.factions.find(f => f.isPlayer)!.id;

  let war: War | null = null;
  let corrupt: string | null = null;
  let screen: Screen = 'title';
  let sequence: EncounterSequence | null = null;
  let destroyed = false;
  let mapHandle: { update(w: War): void; destroy(): void } | null = null;
  let childHandle: { destroy(): void } | null = null;
  let battleRoot: HTMLElement | null = null;
  let busy = false;
  // Bumped when the player leaves a battle through the menu, so its late callbacks are ignored.
  let epoch = 0;
  // Map selection survives the remount that follows every turn.
  let mapSelection: WorldMapSelection | undefined;

  const shell = document.createElement('div');
  shell.className = 'dl-campaign';
  root.replaceChildren(shell);

  const loaded = loadWar(storage, world, data);
  if (loaded.kind === 'ok') { war = loaded.state; screen = screenFor(war); }
  else if (loaded.kind === 'corrupt') corrupt = loaded.error;

  function screenFor(w: War): Screen {
    if (w.phase === 'won' || w.phase === 'lost') return 'over';
    if (w.phase === 'battle') return 'battle';
    if (w.phase === 'admin') return 'admin';
    return 'map';
  }

  /** Persist then render: every transition is one atomic write. */
  function commit(): void {
    if (!war || destroyed) return;
    saveWar(storage, war);
    screen = screenFor(war);
    render();
  }

  function teardownChildren(): void {
    shell.classList.remove('dl-campaign--fill');
    mapHandle?.destroy(); mapHandle = null;
    childHandle?.destroy(); childHandle = null;
    battleRoot?.remove(); battleRoot = null;
  }

  function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label;
    if (primary) el.classList.add('dl-primary');
    el.addEventListener('click', onClick);
    return el;
  }

  function panel(title: string, lines: string[]): HTMLElement {
    const box = document.createElement('section');
    box.className = 'dl-campaign__panel dl-panel';
    const h = document.createElement('h1'); h.textContent = title; h.tabIndex = -1; box.append(h);
    for (const line of lines) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
    return box;
  }

  // ---- turn flow -------------------------------------------------------

  /** Enemy factions commit their orders through the same queue the player uses. */
  function queueEnemyOrders(): void {
    if (!war) return;
    for (const faction of war.factions.filter(f => !f.isPlayer)) {
      for (const order of planFactionOrders(war, faction.id)) issueOrder(war, order);
    }
  }

  function endTurn(): void {
    if (!war || busy) return;
    queueEnemyOrders();
    resolveTurn(war);
    afterEngineStep();
  }

  /** Continue an interrupted turn until the engine settles or asks for another battle. */
  function afterEngineStep(): void {
    if (!war) return;
    if (war.phase === 'battle' && !war.pendingBattle) resumeTurn(war);
    sequence = null;
    commit();
  }

  // ---- screens ---------------------------------------------------------

  function renderTitle(): void {
    const lines = corrupt
      ? ['A saved war could not be loaded, so it has been left untouched.', corrupt]
      : ['Lead your hero and two generals of the same kind, share your troops between them, and win the war for Dragonland.'];
    const box = panel('Dragonland: War', lines);
    const actions = document.createElement('div'); actions.className = 'dl-campaign__actions';
    const current = war;
    if (current && !corrupt) actions.append(button(current.phase === 'won' || current.phase === 'lost' ? 'See how the war ended' : 'Continue the war', () => { screen = screenFor(current); render(); }, true));
    actions.append(button(current && !corrupt ? 'New war (replaces the saved one)' : 'New war', () => { corrupt = null; screen = 'setup'; render(); }, !current || !!corrupt));
    if (corrupt) actions.append(button('Discard the broken save', () => { clearWar(storage); corrupt = null; render(); }));
    if (opts.onExit) actions.append(button('Back to menu', () => opts.onExit!()));
    box.append(actions);
    shell.replaceChildren(box);
    box.querySelector('h1')?.focus();
  }

  function renderSetup(): void {
    const host = document.createElement('div');
    shell.replaceChildren(host);
    childHandle = mountWarStart(host, {
      data, worldData: world, seed: opts.seed ?? 1,
      onBegin: next => { war = next; mapSelection = undefined; commit(); },
      onBack: () => { screen = 'title'; render(); },
    });
  }

  function renderMap(): void {
    if (!war) return;
    const host = document.createElement('div'); host.className = 'dl-campaign__map';
    const status = document.createElement('div'); status.className = 'dl-campaign__status';
    shell.replaceChildren(status, host);
    shell.classList.add('dl-campaign--fill');
    renderStatus(status);
    void mountWorldMap(host, {
      war, factionId: playerId,
      selection: mapSelection,
      onSelectionChange: next => { mapSelection = next; },
      onOrder: (order: WorldOrder) => { if (war) { issueOrder(war, order); saveWar(storage, war); renderStatus(status); } },
      onCancelOrder: division => { if (war) { cancelOrder(war, division); saveWar(storage, war); renderStatus(status); } },
      onAdopt: (captive, division) => {
        if (!war) return;
        try { adoptCaptive(war, playerId, captive, division); saveWar(storage, war); mapHandle?.update(war); renderStatus(status); }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
      },
      onGarrison: intent => {
        if (!war) return;
        try {
          if (intent.type === 'leave') leaveAsGarrison(war, intent.division, intent.general);
          else joinDivision(war, intent.division, intent.general);
          saveWar(storage, war);
          mapHandle?.update(war);
          renderStatus(status);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      },
      onEndTurn: endTurn,
    }).then(handle => {
      if (destroyed || screen !== 'map') { handle.destroy(); return; }
      mapHandle = handle;
    });
  }

  function renderStatus(host: HTMLElement): void {
    if (!war) return;
    const player = war.factions.find(f => f.id === playerId)!;
    const castles = war.nodes.filter(n => n.kind === 'castle' && n.owner === playerId).length;
    const hero = war.generals.find(g => g.isHero);
    const troops = war.generals.filter(g => g.factionId === playerId).reduce((n, g) => n + g.troops.length, 0);
    host.textContent = `Turn ${war.turn} · Week ${war.week} · ${player.gold} gold · ${castles} castle${castles === 1 ? '' : 's'} · ${troops} troops` + (hero ? ` · ${hero.name} ${Math.round(hero.hp)}/${hero.maxHp} HP` : '');
  }

  function renderBattle(): void {
    if (!war?.pendingBattle) { afterEngineStep(); return; }
    const pending = war.pendingBattle;
    if (pending.cause === 'wild') return renderWildBattle();
    try { sequence ??= sequenceEncounter(war, pending); } catch (error) {
      // An encounter the sequencer refuses must not strand the campaign.
      war.pendingBattle = null;
      const box = panel('The encounter could not be fought', [error instanceof Error ? error.message : String(error)]);
      box.append(button('Continue', () => afterEngineStep(), true));
      shell.replaceChildren(box);
      return;
    }
    if (sequence.status === 'resolved') { war.pendingBattle = null; afterEngineStep(); return; }
    renderSkirmishChoice(sequence);
  }

  function renderSkirmishChoice(seq: EncounterSequence): void {
    if (!war) return;
    const node = world.nodeById.get(war.pendingBattle!.nodeId);
    const attackerIsPlayer = war.divisions.find(d => d.id === war!.pendingBattle!.attacker)?.factionId === playerId;
    const box = panel(`Battle at ${node?.name ?? war.pendingBattle!.nodeId}`, [
      `${war.pendingBattle!.cause === 'assault' ? 'Castle assault' : war.pendingBattle!.cause === 'swap' ? 'Clash on the road' : 'Contact'} · you are the ${attackerIsPlayer ? 'attacker' : 'defender'}.`,
      'The defender commits a general first, then the attacker answers.',
    ]);
    const side = seq.status === 'selecting-defender' ? 'defender' : 'attacker';
    const ids = side === 'defender' ? seq.defenderGeneralIds : seq.attackerGeneralIds;
    const available = ids.filter(id => !seq.defeatedGeneralIds.includes(id) && !seq.usedGeneralIds.includes(id));
    const mine = war.generals.filter(g => available.includes(g.id) && g.factionId === playerId);
    const list = document.createElement('div'); list.className = 'dl-campaign__choices';

    if (mine.length) {
      // Show who you would face, so fighting on or retreating is an informed choice: a lost
      // fight costs a general, and the hero's loss ends the war.
      const enemyIds = side === 'attacker' ? seq.defenderGeneralIds : seq.attackerGeneralIds;
      const facing = side === 'attacker' && seq.selectedDefender ? [seq.selectedDefender]
        : enemyIds.filter(id => !seq.defeatedGeneralIds.includes(id) && war!.generals.find(g => g.id === id)!.hp > 0);
      const foe = document.createElement('p'); foe.className = 'dl-campaign__foe';
      foe.textContent = (side === 'attacker' && seq.selectedDefender ? 'They sent: ' : 'They still have: ') + facing.map(id => {
        const g = war!.generals.find(x => x.id === id)!;
        return `${g.name} (${data.generalById.get(g.generalId)?.name ?? g.generalId}) · ${Math.round(g.hp)}/${g.maxHp} HP · ${g.troops.length} troops`;
      }).join('; ');
      list.append(foe);
      const prompt = document.createElement('p');
      prompt.textContent = `Choose your ${side}:`;
      list.append(prompt);
      for (const g of mine) {
        const kind = data.generalById.get(g.generalId)?.name ?? g.generalId;
        list.append(button(`${g.name}${g.isHero ? ' (hero)' : ''} · ${kind} · ${Math.round(g.hp)}/${g.maxHp} HP`, () => prepareSkirmish(seq, g.id, side, facing)));
      }
    } else {
      // The enemy owns this side: pick for them, deterministically, then re-render.
      const pick = available[0];
      if (pick) { chooseGeneral(seq, pick, side); return; }
      war.pendingBattle = null; afterEngineStep(); return;
    }
    box.append(list);
    const actions = document.createElement('div'); actions.className = 'dl-campaign__actions';
    const own = war.divisions.find(d => d.factionId === playerId && (d.id === war!.pendingBattle!.attacker || d.id === war!.pendingBattle!.defender));
    if (own && seq.status !== 'battling') {
      actions.append(button('Retreat', () => {
        try { retreatEncounter(war!, seq, own.id); sequence = null; afterEngineStep(); } catch (error) {
          const p = document.createElement('p'); p.className = 'dl-error';
          p.textContent = error instanceof Error ? error.message : String(error);
          box.append(p);
        }
      }));
    }
    box.append(actions);
    shell.replaceChildren(box);
    box.querySelector('h1')?.focus();
  }

  /** One line per enemy general the player may see: name, kind, HP, and troops by species. */
  function describeGeneral(id: string, withTroops: boolean): string {
    const g = war!.generals.find(x => x.id === id)!;
    const counts = new Map<string, number>();
    for (const t of g.troops) counts.set(t.unitId, (counts.get(t.unitId) ?? 0) + 1);
    const troops = withTroops ? ` — ${g.troops.length} troops: ${[...counts].map(([u, n]) => `${n} ${data.unitById.get(u)?.name ?? u}`).join(', ') || 'none'}` : '';
    return `${g.name} (${data.generalById.get(g.generalId)?.name ?? g.generalId}) · ${Math.round(g.hp)}/${g.maxHp} HP${troops}`;
  }

  /** Before the player's general fights, choose its troops from the pool (see prepare.ts). */
  function prepareSkirmish(seq: EncounterSequence, generalId: string, side: 'defender' | 'attacker', facing: string[]): void {
    if (!war) return;
    // The attacker sees the committed defender's army; the defender only knows who might answer.
    const known = side === 'attacker' && !!seq.selectedDefender;
    const enemyLines = known ? [describeGeneral(seq.selectedDefender!, true)] : ['Whoever they send answers after you commit:', ...facing.map(id => describeGeneral(id, false))];
    const enemyTroops = known ? war.generals.find(g => g.id === seq.selectedDefender)!.troops : [];
    const host = document.createElement('div');
    shell.replaceChildren(host);
    childHandle?.destroy();
    childHandle = mountPrepare(host, {
      data, war, generalId, enemyLines, enemyTroops,
      title: `Battle at ${world.nodeById.get(war.pendingBattle!.nodeId)?.name ?? war.pendingBattle!.nodeId}: prepare ${war.generals.find(g => g.id === generalId)!.name}`,
      onBack: () => render(),
      onFight: army => {
        try { chooseGeneral(seq, generalId, side, army); }
        catch (error) { const p = document.createElement('p'); p.className = 'dl-error'; p.textContent = error instanceof Error ? error.message : String(error); host.append(p); }
      },
    });
  }

  function chooseGeneral(seq: EncounterSequence, generalId: string, side: 'defender' | 'attacker', army?: WarArmy): void {
    if (!war) return;
    if (side === 'defender') { commitDefender(war, seq, generalId, army); render(); return; }
    const selection = commitAttacker(war, seq, generalId, army);
    const defender = war.generals.find(g => g.id === selection.generalIds[0])!;
    const attacker = war.generals.find(g => g.id === selection.generalIds[1])!;
    const playerDefends = defender.factionId === playerId;
    runBattle(selection.setup, playerDefends ? 0 : 1, { player: playerDefends ? defender.name : attacker.name, enemy: playerDefends ? attacker.name : defender.name }, snapshot => {
      applySkirmishResult(war!, seq, selection.id, snapshot);
      if (seq.status === 'resolved') sequence = null;
      afterEngineStep();
    });
  }

  function renderWildBattle(): void {
    if (!war?.pendingBattle) return;
    const pending = war.pendingBattle;
    const division = war.divisions.find(d => d.id === pending.attacker);
    const node = world.nodeById.get(pending.nodeId);
    const pack = pending.wild.map(w => `${w.count}x ${data.unitById.get(w.unitId)?.name ?? w.unitId}`).join(', ');
    const box = panel(`Wild creatures at ${node?.name ?? pending.nodeId}`, [
      `Your search disturbed ${pack}.`,
      'Beat them and the survivors join the general who fought.',
    ]);
    const list = document.createElement('div'); list.className = 'dl-campaign__choices';
    const fighters = war.generals.filter(g => division?.generals.includes(g.id) && g.hp > 0 && g.injuredTurns === 0);
    for (const g of fighters) {
      list.append(button(`${g.name} · ${data.generalById.get(g.generalId)?.name ?? g.generalId} · ${Math.round(g.hp)}/${g.maxHp} HP`, () => {
        const host = document.createElement('div');
        shell.replaceChildren(host);
        childHandle?.destroy();
        childHandle = mountPrepare(host, {
          data, war: war!, generalId: g.id,
          title: `Wild creatures at ${node?.name ?? pending.nodeId}: prepare ${g.name}`,
          enemyLines: [`A wild pack: ${pack}.`],
          enemyTroops: pending.wild.flatMap(w => Array.from({ length: w.count }, () => ({ unitId: w.unitId }))),
          onBack: () => render(),
          onFight: army => {
            const selection = wildBattleSetup(war!, division!.id, g.id, army);
            runBattle(selection.setup, WILD_SEARCHER_SIDE, { player: g.name, enemy: 'Wild pack' }, snapshot => {
              applyWildResult(war!, selection, snapshot);
              afterEngineStep();
            });
          },
        });
      }));
    }
    if (!fighters.length) {
      box.append(button('Withdraw', () => { war!.pendingBattle = null; afterEngineStep(); }, true));
    }
    box.append(list);
    shell.replaceChildren(box);
    box.querySelector('h1')?.focus();
  }

  /**
   * Launch the tactical view on a strategic setup. The view always gives the human side 0, so the
   * caller states which strategic side is the player's and receives the result mapped back to
   * strategic sides. Passing a raw setup put the player in charge of the enemy twice.
   */
  function runBattle(strategic: BattleSetup, playerSide: 0 | 1, labels: { player: string; enemy: string }, onDone: (snapshot: TerminalBattleSnapshot) => void): void {
    if (!war || busy) return;
    busy = true;
    // Cross-check the caller against the troops actually deployed; a wrong side here hands the
    // player the enemy army, which has happened twice.
    const playerTroops = new Set(war.generals.filter(g => g.factionId === playerId).flatMap(g => g.troops.map(t => t.id)));
    const side = playerSideOf(strategic, playerTroops, playerSide);
    if (side !== playerSide) console.warn('Campaign battle: caller claimed player side', playerSide, 'but the player\'s troops are on side', side, { battle: war.pendingBattle?.id, generals: strategic.sides.map(s => s.generalId) });
    const perspective = campaignBattlePerspective(strategic, side);
    const setup = perspective.setup;
    const biome = war.pendingBattle ? world.nodeById.get(war.pendingBattle.nodeId)?.biome : undefined;
    teardownChildren();
    battleRoot = document.createElement('div');
    battleRoot.className = 'dl-campaign__battle';
    shell.replaceChildren(battleRoot);
    const started = epoch;
    void opts.startBattleView(battleRoot, {
      data, setup, labels, biome,
      onFinished: world => {
        if (destroyed || started !== epoch) return;
        busy = false;
        onDone(perspective.snapshot(world));
      },
    }).then(view => {
      if (destroyed || started !== epoch) { view.destroy(); return; }
      childHandle = view;
    }).catch(error => {
      if (destroyed || started !== epoch) return;
      busy = false;
      const box = panel('The battle could not start', [error instanceof Error ? error.message : String(error)]);
      box.append(button('Back to the map', () => { if (war) { war.pendingBattle = null; afterEngineStep(); } }, true));
      shell.replaceChildren(box);
    });
  }

  function renderAdmin(): void {
    if (!war) return;
    const player = war.factions.find(f => f.id === playerId)!;
    const mine = war.generals.filter(g => g.factionId === playerId);
    const box = panel(`Week ${war.week} muster`, [
      `${player.gold} gold in the war chest.`,
      'Admin costs no turn and the enemy does not move.',
    ]);
    const list = document.createElement('div'); list.className = 'dl-campaign__choices';
    for (const g of mine) {
      const row = document.createElement('p');
      row.textContent = `${g.name} · ${Math.round(g.hp)}/${g.maxHp} HP · ${g.troops.length}/${g.capacity} troops` + (g.injuredTurns ? ` · injured (${g.injuredTurns})` : '');
      list.append(row);
    }
    box.append(list);
    if (player.captives.length) {
      const heading = document.createElement('h2'); heading.textContent = 'Prisoners'; box.append(heading);
      const prisoners = document.createElement('div'); prisoners.className = 'dl-campaign__choices';
      const hero = war.generals.find(g => g.isHero);
      const heroDivision = war.divisions.find(d => hero && d.generals.includes(hero.id))?.id ?? null;
      const target = adoptionTarget(war, playerId, heroDivision);
      for (const id of player.captives) {
        const g = war.generals.find(x => x.id === id); if (!g) continue;
        const label = `Adopt ${g.name} · ${data.generalById.get(g.generalId)?.name ?? g.generalId} · ${g.troops.length} troops`;
        const b = button(label, () => {
          if (!target.division) return;
          try { adoptCaptive(war!, playerId, id, target.division); saveWar(storage, war!); render(); }
          catch (error) { const p = document.createElement('p'); p.className = 'dl-error'; p.textContent = error instanceof Error ? error.message : String(error); box.append(p); }
        });
        b.disabled = !target.division;
        if (target.division === null) b.title = target.reason;
        prisoners.append(b);
      }
      box.append(prisoners);
    }
    const actions = document.createElement('div'); actions.className = 'dl-campaign__actions';
    actions.append(button('Resume the war', () => { completeAdmin(war!); commit(); }, true));
    box.append(actions);
    shell.replaceChildren(box);
    box.querySelector('h1')?.focus();
  }

  function renderOver(): void {
    if (!war) return;
    const won = war.phase === 'won';
    const hero = war.generals.find(g => g.isHero);
    const box = panel(won ? 'Dragonland is yours' : 'The war is lost', [
      won
        ? `Every enemy castle has fallen after ${war.turn - 1} turns.`
        : hero && hero.hp <= 0 ? `${hero.name} fell after ${war.turn - 1} turns, and the war died with them.` : `You hold no castles after ${war.turn - 1} turns.`,
    ]);
    const actions = document.createElement('div'); actions.className = 'dl-campaign__actions';
    actions.append(button('Start a new war', () => { clearWar(storage); war = null; sequence = null; screen = 'setup'; render(); }, true));
    if (opts.onExit) actions.append(button('Back to menu', () => opts.onExit!()));
    box.append(actions);
    shell.replaceChildren(box);
    box.querySelector('h1')?.focus();
  }

  function render(): void {
    if (destroyed) return;
    teardownChildren();
    if (corrupt) return renderTitle();
    // Setup is the one screen that runs before a war exists; check it before the war guard.
    if (screen === 'setup') return renderSetup();
    if (!war) return renderTitle();
    switch (screen) {
      case 'map': return renderMap();
      case 'battle': return renderBattle();
      case 'admin': return renderAdmin();
      case 'over': return renderOver();
      default: return renderTitle();
    }
  }

  /** Drop any in-flight battle or pending screen state before showing another screen. */
  function interrupt(): void {
    epoch++;
    busy = false;
    sequence = null;
  }

  render();

  return {
    hasWar: () => war !== null,
    toTitle(): void {
      if (destroyed) return;
      interrupt();
      // A battle left mid-way is replayed from the saved state at the start of its encounter.
      const loaded = loadWar(storage, world, data);
      war = loaded.kind === 'ok' ? loaded.state : null;
      screen = 'title';
      render();
    },
    abandonWar(): void {
      if (destroyed) return;
      interrupt();
      clearWar(storage);
      war = null; corrupt = null; mapSelection = undefined;
      screen = 'setup';
      render();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      teardownChildren();
      shell.remove();
    },
  };
}
