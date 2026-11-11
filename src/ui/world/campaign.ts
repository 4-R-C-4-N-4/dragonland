// Campaign controller: joins the war setup screen, the overworld map, battles and admin
// into one playable loop. All rules live in src/world (pure); this file renders, routes
// intents and persists one snapshot per transition.
import type { GameData } from '../../data';
import type { StartBattleView } from '../../battle/types';
import type { GeneralRecord } from '../../world/types';
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
import { adoptionTarget, divisionName } from './presentation';
import { mountWarStart } from './start';
import { mountPrepare } from './prepare';
import { fairShare } from './prepareLogic';
import { fightPool } from '../../world/army';
import { mpOf } from '../../world/mp';
import { retreatNode } from '../../world/movement';
import { classRelation } from '../run/logic';
import type { WarArmy } from '../../world/army';
import { bar, chip, el, generalCard, heading, portrait, troopStrip } from '../common/kit';
import worldmapArt from '../../../assets/backgrounds/worldmap.jpg';
import plainsArt from '../../../assets/backgrounds/plains.jpg';
import forestArt from '../../../assets/backgrounds/forest.jpg';
import mountainArt from '../../../assets/backgrounds/mountain.jpg';
import swampArt from '../../../assets/backgrounds/swamp.jpg';
import ruinsArt from '../../../assets/backgrounds/ruins.jpg';
import '../common/theme.css';
import './campaign.css';

const BIOME_ART: Record<string, string> = { plains: plainsArt, forest: forestArt, mountain: mountainArt, swamp: swampArt, ruins: ruinsArt, settled: plainsArt };

/** The whole game in four lines, shown on the title screen. */
const HOW_TO: [string, string][] = [
  ['Give orders', 'Each turn every division gets one order: march one step, search for wild troops, rest or hold. End the turn and the enemy moves at the same time.'],
  ['Fight general to general', 'When armies meet, each side sends one general at a time. You choose who fights and which troops they lead.'],
  ['Grow your army', 'Rest in a castle to recruit, beat wild packs to add them, and adopt the generals you capture.'],
  ['Win the war', 'Take every enemy castle. Keep a general in your own, and keep your hero alive: if the hero falls, the war is lost.'],
];

interface AftermathLine { text: string; tone?: 'good' | 'bad' | 'next' }
/** What the player is told after a fight, before the war moves on. */
interface Aftermath {
  kicker: string;
  won: boolean;
  art: string;
  own: { generalId: string; sent: number; left: number };
  foe: { generalId: string; sent: number; left: number } | { pack: { unitId: string; count: number }[] };
  lines: AftermathLine[];
}

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
  // Shown once after a fight; the result is already saved, so a reload simply skips it.
  let aftermath: Aftermath | null = null;

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
    const b = el('button', primary ? 'dl-primary' : undefined, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /** Art behind the current screen: the map for the war's own screens, the biome for a fight. */
  function setArt(url: string | null): void {
    if (url) shell.style.setProperty('--art', `url("${url}")`); else shell.style.removeProperty('--art');
  }
  function battleArt(): string {
    const biome = war?.pendingBattle ? world.nodeById.get(war.pendingBattle.nodeId)?.biome : undefined;
    return BIOME_ART[biome ?? 'settled'] ?? plainsArt;
  }

  /** A centred screen: kicker, title (focused for screen readers), then lines of text. */
  function panel(kicker: string, title: string, lines: string[] = [], wide = false): HTMLElement {
    const box = el('section', `dl-campaign__panel dl-panel dl-enter${wide ? ' dl-campaign__panel--wide' : ''}`);
    const head = heading(kicker, title);
    box.append(head.kicker, head.h1);
    for (const line of lines) box.append(el('p', 'dl-campaign__lede', line));
    return box;
  }
  function show(box: HTMLElement): void {
    shell.replaceChildren(box);
    box.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
  function errorLine(error: unknown): HTMLElement {
    return el('p', 'dl-error', error instanceof Error ? error.message : String(error));
  }
  const general = (id: string) => war!.generals.find(g => g.id === id)!;
  const kindName = (g: GeneralRecord) => data.generalById.get(g.generalId)?.name ?? g.generalId;
  const nodeNameOf = (id: string) => world.nodeById.get(id)?.name ?? id;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
    setArt(worldmapArt);
    const box = el('section', 'dl-title-screen dl-enter');
    const logo = el('h1', 'dl-logo', 'Dragonland'); logo.tabIndex = -1;
    box.append(el('p', 'dl-kicker', 'War campaign'), logo);
    box.append(el('p', 'dl-title-screen__tag', corrupt
      ? 'A saved war could not be loaded, so it has been left untouched.'
      : 'Lead a hero and two generals of its kind. Share one army between them. Take every enemy castle.'));
    if (corrupt) box.append(el('p', 'dl-error', corrupt));
    const current = war;
    const over = !!current && (current.phase === 'won' || current.phase === 'lost');
    const hero = current?.generals.find(g => g.isHero);
    if (current && hero && !corrupt) {
      const castles = current.nodes.filter(n => n.kind === 'castle');
      const troops = current.generals.filter(g => g.factionId === playerId).reduce((n, g) => n + g.troops.length, 0);
      const card = generalCard(hero, {
        tone: 'own', troops,
        note: over ? `${current.phase === 'won' ? 'Won' : 'Lost'} after ${plural(current.turn - 1, 'turn')}.`
          : `Saved war · turn ${current.turn}, week ${current.week} · ${castles.filter(n => n.owner === playerId).length} of ${plural(castles.length, 'castle')} held`,
      });
      card.classList.add('dl-title-screen__save');
      box.append(card);
    }
    const actions = el('div', 'dl-campaign__actions');
    if (current && !corrupt) actions.append(button(over ? 'See how the war ended' : 'Continue the war', () => { screen = screenFor(current); render(); }, true));
    actions.append(button(current && !corrupt ? 'New war (replaces the saved one)' : 'New war', () => { corrupt = null; screen = 'setup'; render(); }, !current || !!corrupt));
    if (corrupt) actions.append(button('Discard the broken save', () => { clearWar(storage); corrupt = null; render(); }));
    if (opts.onExit) actions.append(button('Back to menu', () => opts.onExit!()));
    box.append(actions);
    const how = el('ol', 'dl-howto');
    for (const [title, text] of HOW_TO) { const li = el('li'); li.append(el('b', undefined, title), document.createTextNode(text)); how.append(li); }
    box.append(how);
    show(box);
  }

  function renderSetup(): void {
    setArt(worldmapArt);
    const host = document.createElement('div');
    shell.replaceChildren(host);
    childHandle = mountWarStart(host, {
      // A fixed seed (tests, ?seed=) replays one war; otherwise every new war is different.
      data, worldData: world, seed: opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0),
      onBegin: next => { war = next; mapSelection = undefined; commit(); },
      onBack: () => { screen = 'title'; render(); },
    });
  }

  function renderMap(): void {
    if (!war) return;
    const host = document.createElement('div'); host.className = 'dl-campaign__map';
    const status = document.createElement('div'); status.className = 'dl-campaign__status';
    setArt(null);
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
        catch (error) { renderStatus(status, error); }
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
          renderStatus(status, error);
        }
      },
      onEndTurn: endTurn,
    }).then(handle => {
      if (destroyed || screen !== 'map') { handle.destroy(); return; }
      mapHandle = handle;
    });
  }

  /** The war at a glance: time, what to do to win, and how the hero is. */
  function renderStatus(host: HTMLElement, error?: unknown): void {
    if (!war) return;
    const stat = (label: string, value: string, sub?: string, cls = ''): HTMLElement => {
      const s = el('div', `dl-stat ${cls}`.trim());
      const b = el('b', undefined, value);
      if (sub) b.append(' ', el('em', undefined, sub));
      s.append(el('small', undefined, label), b);
      return s;
    };
    const held = war.nodes.filter(n => n.kind === 'castle' && n.owner === playerId).length;
    const toTake = war.nodes.filter(n => n.kind === 'castle' && n.owner !== playerId);
    const hero = war.generals.find(g => g.isHero);
    const troops = war.generals.filter(g => g.factionId === playerId && g.hp > 0 && !war!.factions.some(f => f.captives.includes(g.id))).reduce((n, g) => n + g.troops.length, 0);
    const perWeek = world.constants.TURNS_PER_WEEK;
    const toMuster = perWeek - ((war.turn - 1) % perWeek);
    // Gold is collected but has no use yet, so it is not shown.
    const week = stat('Week', String(war.week), `castles restock in ${plural(toMuster, 'turn')}`);
    const pips = el('span', 'dl-pips'); pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < perWeek; i++) pips.append(el('i', i < perWeek - toMuster ? 'is-on' : undefined));
    week.querySelector('b')!.append(pips);
    host.replaceChildren(
      stat('Turn', String(war.turn)),
      week,
      stat('To win the war', toTake.length ? `Take ${toTake.map(n => n.name).join(', ')}` : 'Every castle is yours', undefined, 'dl-stat--objective'),
      stat('Castles', String(held), `of ${held + toTake.length}`),
      stat('Troops', String(troops)),
    );
    if (hero) {
      const h = el('div', 'dl-stat dl-stat--hero');
      const text = el('div', 'dl-stat');
      text.append(el('small', undefined, `${hero.name}${hero.injuredTurns ? ` · injured ${hero.injuredTurns}` : ''}`), bar('hp', hero.hp, hero.maxHp, `HP ${Math.round(hero.hp)} / ${hero.maxHp}`));
      h.append(portrait(data.generalById.get(hero.generalId)?.unitId ?? '', 32), text);
      host.append(h);
    }
    if (error) host.append(el('div', 'dl-campaign__status-error', error instanceof Error ? error.message : String(error)));
  }

  function renderBattle(): void {
    if (!war?.pendingBattle) { afterEngineStep(); return; }
    const pending = war.pendingBattle;
    if (pending.cause === 'wild') return renderWildBattle();
    try { sequence ??= sequenceEncounter(war, pending); } catch (error) {
      // An encounter the sequencer refuses must not strand the campaign.
      war.pendingBattle = null;
      const box = panel('Battle', 'The encounter could not be fought', [error instanceof Error ? error.message : String(error)]);
      const actions = el('div', 'dl-campaign__actions'); actions.append(button('Continue', () => afterEngineStep(), true));
      box.append(actions);
      show(box);
      return;
    }
    if (sequence.status === 'resolved') { war.pendingBattle = null; afterEngineStep(); return; }
    renderSkirmishChoice(sequence);
  }

  function renderSkirmishChoice(seq: EncounterSequence): void {
    if (!war) return;
    const pending = war.pendingBattle!;
    const side = seq.status === 'selecting-defender' ? 'defender' : 'attacker';
    const ids = side === 'defender' ? seq.defenderGeneralIds : seq.attackerGeneralIds;
    const available = ids.filter(id => !seq.defeatedGeneralIds.includes(id) && !seq.usedGeneralIds.includes(id));
    const mine = war.generals.filter(g => available.includes(g.id) && g.factionId === playerId);
    if (!mine.length) {
      // The enemy owns this side: pick for them, deterministically, then re-render.
      const pick = available[0];
      if (pick) { chooseGeneral(seq, pick, side); return; }
      war.pendingBattle = null; afterEngineStep(); return;
    }

    const attackerIsPlayer = war.divisions.find(d => d.id === pending.attacker)?.factionId === playerId;
    const cause = pending.cause === 'assault' ? 'Castle assault' : pending.cause === 'swap' ? 'Clash on the road' : 'Field battle';
    const sent = side === 'attacker' && seq.selectedDefender ? general(seq.selectedDefender) : undefined;
    setArt(battleArt());
    const box = panel(
      `${cause} · you ${attackerIsPlayer ? 'attack' : 'defend'} · skirmish ${pending.processedSkirmishIds.length + 1}`,
      `Battle at ${nodeNameOf(pending.nodeId)}`,
      [sent
        ? `${sent.name} has come forward. Choose who answers. A skirmish ends when one general falls; the battle ends when one side has nobody left.`
        : 'You commit a general first, then they answer. A skirmish ends when one general falls; the battle ends when one side has nobody left.'],
      true,
    );

    // Who you would face, so fighting on or retreating is an informed choice.
    const enemyIds = side === 'attacker' ? seq.defenderGeneralIds : seq.attackerGeneralIds;
    const standing = enemyIds.filter(id => !seq.defeatedGeneralIds.includes(id) && general(id).hp > 0);
    const facing = sent ? [sent.id] : standing;
    const classOf = (g: GeneralRecord) => data.unitById.get(data.generalById.get(g.generalId)!.unitId)!.classId;

    const grid = el('div', 'dl-versus');
    const ours = el('div', 'dl-versus__side dl-versus__side--own dl-campaign__choices');
    const pool = fightPool(war, mine[0]!.id).length;
    const oursHead = el('h2', undefined, 'Your side'); oursHead.append(el('small', undefined, `${plural(pool, 'troop')} to share`));
    ours.append(oursHead, el('p', 'dl-versus__prompt', `Choose your ${side}. You pick their troops on the next screen.`));
    for (const g of mine) {
      // The class matchup against a known enemy general (generals' own attacks follow the hunt too).
      const rel = sent ? classRelation(data, classOf(g), classOf(sent)) : 'neutral';
      const chips = rel === 'quarry' ? [chip(`Hunts ${kindName(sent!)}`, { tone: 'own' })] : rel === 'nemesis' ? [chip(`Hunted by ${kindName(sent!)}`, { tone: 'foe' })] : [];
      ours.append(generalCard(g, {
        tone: 'own', chips, key: `pick-${g.id}`,
        troops: Math.min(g.capacity, data.constants.MAX_COMPANY), troopsLabel: 'troops at most',
        note: g.isHero ? `${g.name} is your hero: if they fall, the war is lost.` : undefined, noteTone: 'warn',
        onClick: () => prepareSkirmish(seq, g.id, side, facing, mine.length),
      }));
    }

    const theirs = el('div', 'dl-versus__side dl-versus__side--foe');
    const foeFaction = war.factions.find(f => f.id === general(enemyIds[0]!)?.factionId)?.name ?? 'The enemy';
    const theirsHead = el('h2', undefined, foeFaction);
    theirsHead.append(el('small', undefined, `${plural(standing.length, 'general')}, ${plural(standing.reduce((n, id) => n + general(id).troops.length, 0), 'troop')}`));
    theirs.append(theirsHead, el('p', 'dl-versus__prompt', sent ? 'The general you fight now is first; the rest wait behind.' : 'Any of these may answer you.'));
    for (const id of [...facing, ...standing.filter(x => !facing.includes(x))]) {
      const isSent = sent?.id === id;
      theirs.append(generalCard(general(id), { tone: 'foe', mp: false, compact: !!sent && !isSent, chips: isSent ? [chip('Fighting now', { tone: 'foe' })] : [] }));
    }
    grid.append(ours, el('div', 'dl-versus__mid', 'VS'), theirs);
    box.append(grid);

    const actions = el('div', 'dl-campaign__actions');
    const own = war.divisions.find(d => d.factionId === playerId && (d.id === pending.attacker || d.id === pending.defender));
    const fallback = own ? retreatNode(war, own) : null;
    if (own && seq.status !== 'battling' && fallback && fallback !== own.atNode) {
      actions.append(button(`Retreat to ${nodeNameOf(fallback)}`, () => {
        try { retreatEncounter(war!, seq, own.id); sequence = null; afterEngineStep(); } catch (error) { box.append(errorLine(error)); }
      }));
      actions.append(el('p', 'dl-campaign__hint', `Retreating ends the battle now: your division falls back to ${nodeNameOf(fallback)} without fighting.`));
    }
    if (actions.childElementCount) box.append(actions);
    show(box);
  }

  /** Before the player's general fights, choose its troops from the pool (see prepare.ts). */
  /** `fighters`: how many of the player's generals can still fight this encounter. */
  function prepareSkirmish(seq: EncounterSequence, generalId: string, side: 'defender' | 'attacker', facing: string[], fighters: number): void {
    if (!war) return;
    // The attacker sees the committed defender's army; the defender only knows who might answer.
    const known = side === 'attacker' && !!seq.selectedDefender;
    const enemyTroops = known ? general(seq.selectedDefender!).troops : [];
    const enemyCards: HTMLElement[] = facing.map(id => generalCard(general(id), { tone: 'foe', mp: false, compact: !known }));
    if (known) enemyCards.push(troopStrip(enemyTroops, 'They bring no troops.'));
    const host = document.createElement('div');
    shell.replaceChildren(host);
    childHandle?.destroy();
    const fighter = general(generalId);
    const poolSize = fightPool(war, generalId).length;
    const command = Math.min(fighter.capacity, data.constants.MAX_COMPANY);
    // Defending, the answer is unknown: plan for the strongest general who could be sent.
    const strongest = Math.max(0, ...facing.map(id => general(id)?.troops.length ?? 0));
    const share = fairShare(poolSize, fighters, command, known ? enemyTroops.length : strongest);
    childHandle = mountPrepare(host, {
      data, war, generalId, enemyCards, enemyTroops, share,
      enemyNote: known ? undefined : 'They choose who answers after you commit, so plan for any of them.',
      shareNote: share < Math.min(poolSize, command)
        ? `Auto-arrange sends ${share} of ${poolSize}: ${fighters} of your generals may still have to fight here.${known ? ' That outnumbers this enemy by a fifth.' : strongest ? ` That outnumbers their strongest general (${strongest} troops) by a fifth.` : ''} Raise the counts to go all in.`
        : undefined,
      kicker: `Battle at ${nodeNameOf(war.pendingBattle!.nodeId)} · skirmish ${war.pendingBattle!.processedSkirmishIds.length + 1}`,
      title: `Ready ${fighter.name}'s army`,
      onBack: () => render(),
      onFight: army => {
        try { chooseGeneral(seq, generalId, side, army); }
        catch (error) { host.append(errorLine(error)); }
      },
    });
  }

  function chooseGeneral(seq: EncounterSequence, generalId: string, side: 'defender' | 'attacker', army?: WarArmy): void {
    if (!war) return;
    if (side === 'defender') { commitDefender(war, seq, generalId, army); render(); return; }
    const selection = commitAttacker(war, seq, generalId, army);
    const defender = general(selection.generalIds[0]);
    const attacker = general(selection.generalIds[1]);
    const playerDefends = defender.factionId === playerId;
    const pending = war.pendingBattle!;
    const place = nodeNameOf(pending.nodeId);
    const kicker = `Battle at ${place} · skirmish ${pending.processedSkirmishIds.length + 1}`;
    const art = battleArt();
    const ownerBefore = war.nodes.find(n => n.id === pending.nodeId)?.owner ?? null;
    runBattle(selection.setup, playerDefends ? 0 : 1, { player: playerDefends ? defender.name : attacker.name, enemy: playerDefends ? attacker.name : defender.name }, snapshot => {
      const w = war!;
      const seen = w.events.length;
      applySkirmishResult(w, seq, selection.id, snapshot);
      // Sim side 0 is the defender, side 1 the attacker.
      const mineSide = playerDefends ? 0 : 1, theirSide = playerDefends ? 1 : 0;
      const me = playerDefends ? defender : attacker, foe = playerDefends ? attacker : defender;
      const sentBy = (s: 0 | 1) => selection.setup.sides[s]!.squads.reduce((n, q) => n + q.troops.length, 0);
      const leftTo = (s: 0 | 1) => snapshot.result.survivors[s]!.length;
      const won = snapshot.result.winner === mineSide;
      const lines: AftermathLine[] = [];
      if (snapshot.result.reason === 'duel') lines.push({ text: 'The armies could not settle it, so the generals fought a duel.' });
      lines.push({ text: `${me.name} lost ${sentBy(mineSide) - leftTo(mineSide)} of ${plural(sentBy(mineSide), 'troop')}; ${foe.name} lost ${sentBy(theirSide) - leftTo(theirSide)} of ${sentBy(theirSide)}.` });
      for (const e of w.events.slice(seen)) {
        if (e.type === 'generalDefeated') {
          const g = general(e.general), ours = e.by !== playerId;
          const fate = e.outcome === 'captured' ? (ours ? 'was captured' : 'is your prisoner: adopt them from Prisoners on the map')
            : e.outcome === 'injured' ? `escaped, injured for ${plural(g.injuredTurns, 'turn')}` : 'was killed';
          lines.push({ text: `${g.name} ${fate}.`, tone: ours ? 'bad' : 'good' });
        } else if (e.type === 'retreated') {
          const ours = w.divisions.find(d => d.id === e.division)?.factionId === playerId;
          lines.push({ text: `${ours ? 'Your division' : 'The enemy'} fell back to ${nodeNameOf(e.toNode)}.`, tone: ours ? 'bad' : 'good' });
        }
      }
      const ownerAfter = w.nodes.find(n => n.id === pending.nodeId)?.owner ?? null;
      if (ownerAfter !== ownerBefore) lines.push(ownerAfter === playerId ? { text: `${place} is yours.`, tone: 'good' } : { text: `${place} has fallen to the enemy.`, tone: 'bad' });
      lines.push({ tone: 'next', text: w.phase === 'lost' ? 'Your hero has fallen. The war is over.' : seq.status !== 'resolved' ? 'The battle goes on: choose who fights next.' : 'The battle is over.' });
      aftermath = { kicker, won, art, lines, own: { generalId: me.id, sent: sentBy(mineSide), left: leftTo(mineSide) }, foe: { generalId: foe.id, sent: sentBy(theirSide), left: leftTo(theirSide) } };
      if (seq.status === 'resolved') sequence = null;
      afterEngineStep();
    });
  }

  /** The result of the fight just finished: who won, what it cost, what happens next. */
  function renderAftermath(a: Aftermath): void {
    setArt(a.art);
    const box = el('section', 'dl-campaign__panel dl-campaign__panel--wide dl-panel dl-enter');
    const h = el('h1', `dl-result dl-result--${a.won ? 'won' : 'lost'}`, a.won ? 'Victory' : 'Defeat'); h.tabIndex = -1;
    box.append(el('p', 'dl-kicker', a.kicker), h);
    const grid = el('div', 'dl-versus');
    const ours = el('div', 'dl-versus__side dl-versus__side--own');
    const me = general(a.own.generalId);
    ours.append(el('h2', undefined, 'Your general'), generalCard(me, { tone: 'own', out: me.hp <= 0, troops: a.own.left, troopsLabel: `of ${a.own.sent} sent still standing` }));
    const theirs = el('div', 'dl-versus__side dl-versus__side--foe');
    if ('pack' in a.foe) {
      theirs.append(el('h2', undefined, 'Wild pack'), troopStrip(a.foe.pack.flatMap(p => Array.from({ length: p.count }, () => ({ unitId: p.unitId })))));
    } else {
      const foe = general(a.foe.generalId);
      theirs.append(el('h2', undefined, 'Their general'), generalCard(foe, { tone: 'foe', mp: false, out: a.won, troops: a.foe.left, troopsLabel: `of ${a.foe.sent} sent still standing` }));
    }
    grid.append(ours, el('div', 'dl-versus__mid', 'VS'), theirs);
    const list = el('ul', 'dl-outcomes');
    for (const line of a.lines) list.append(el('li', line.tone ? `is-${line.tone}` : undefined, line.text));
    const actions = el('div', 'dl-campaign__actions');
    actions.append(button('Continue', () => { aftermath = null; render(); }, true));
    box.append(grid, list, actions);
    show(box);
    actions.querySelector('button')?.focus({ preventScroll: true });
  }

  function renderWildBattle(): void {
    if (!war?.pendingBattle) return;
    const pending = war.pendingBattle;
    const division = war.divisions.find(d => d.id === pending.attacker);
    const place = nodeNameOf(pending.nodeId);
    const packTroops = pending.wild.flatMap(w => Array.from({ length: w.count }, () => ({ unitId: w.unitId })));
    const members = () => (division?.generals ?? []).reduce((n, id) => n + general(id).troops.length, 0);
    setArt(battleArt());
    const box = panel(`Wild creatures · ${place}`, 'Your search found a pack', [
      `Beat them and the pack joins your division (${plural(members(), 'troop')} now), as far as your generals can command. Lose, and the division falls back.`,
    ]);
    const packHead = el('h2', undefined, `The pack: ${plural(packTroops.length, 'troop')}`);
    box.append(packHead, troopStrip(packTroops));
    const list = el('div', 'dl-campaign__choices');
    const fighters = war.generals.filter(g => division?.generals.includes(g.id) && g.hp > 0 && g.injuredTurns === 0);
    if (fighters.length) box.append(el('h2', undefined, 'Choose who hunts them'));
    for (const g of fighters) {
      list.append(generalCard(g, {
        tone: 'own', key: `pick-${g.id}`,
        troops: Math.min(g.capacity, data.constants.MAX_COMPANY), troopsLabel: 'troops at most',
        note: g.isHero ? `${g.name} is your hero: if they fall, the war is lost.` : undefined, noteTone: 'warn',
        onClick: () => {
          const host = document.createElement('div');
          shell.replaceChildren(host);
          childHandle?.destroy();
          childHandle = mountPrepare(host, {
            data, war: war!, generalId: g.id,
            kicker: `Wild creatures · ${place}`,
            title: `Ready ${g.name}'s army`,
            enemyCards: [troopStrip(packTroops)],
            enemyNote: 'A wild pack, led by the apex of its kind.',
            enemyTroops: packTroops,
            onBack: () => render(),
            onFight: army => {
              const selection = wildBattleSetup(war!, division!.id, g.id, army);
              const before = members(), art = battleArt();
              const sent = selection.setup.sides[WILD_SEARCHER_SIDE]!.squads.reduce((n, q) => n + q.troops.length, 0);
              runBattle(selection.setup, WILD_SEARCHER_SIDE, { player: g.name, enemy: 'Wild pack' }, snapshot => {
                const w = war!;
                const seen = w.events.length;
                const { won } = applyWildResult(w, selection, snapshot);
                const left = snapshot.result.survivors[WILD_SEARCHER_SIDE]!.length;
                const joined = members() - (before - (sent - left));
                const lines: AftermathLine[] = [{ text: `${g.name} lost ${sent - left} of ${plural(sent, 'troop')}.` }];
                if (won) lines.push({ tone: 'good', text: `${plural(joined, 'wild troop')} joined your division, which now has ${members()}.${joined < packTroops.length ? ' Your generals cannot command more: adopt another general to lead a bigger army.' : ''}` });
                for (const e of w.events.slice(seen)) if (e.type === 'retreated') lines.push({ tone: 'bad', text: `Your division fell back to ${nodeNameOf(e.toNode)}.` });
                lines.push({ tone: 'next', text: w.phase === 'lost' ? 'Your hero has fallen. The war is over.' : 'The turn goes on.' });
                aftermath = { kicker: `Wild creatures · ${place}`, won, art, lines, own: { generalId: g.id, sent, left }, foe: { pack: pending.wild } };
                afterEngineStep();
              });
            },
          });
        },
      }));
    }
    box.append(list);
    if (!fighters.length) {
      const actions = el('div', 'dl-campaign__actions');
      actions.append(button('Withdraw', () => { war!.pendingBattle = null; afterEngineStep(); }, true), el('p', 'dl-campaign__hint', 'Nobody in this division can fight.'));
      box.append(actions);
    }
    show(box);
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
    battleRoot = el('div', 'dl-campaign__battle');
    // The field takes a moment to load its sprites; say so instead of showing an empty field.
    const loading = el('div', 'dl-campaign__loading');
    loading.append(el('b', undefined, `${labels.player} vs ${labels.enemy}`), el('span', undefined, 'Taking the field'));
    battleRoot.append(loading);
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
      loading.remove();
      childHandle = view;
    }).catch(error => {
      if (destroyed || started !== epoch) return;
      busy = false;
      const box = panel('Battle', 'The battle could not start', [error instanceof Error ? error.message : String(error)]);
      const actions = el('div', 'dl-campaign__actions');
      actions.append(button('Back to the map', () => { if (war) { war.pendingBattle = null; afterEngineStep(); } }, true));
      box.append(actions);
      show(box);
    });
  }

  function renderAdmin(): void {
    if (!war) return;
    const player = war.factions.find(f => f.id === playerId)!;
    // The muster is only for adopting prisoners; with none, it would be a screen to click past.
    if (!player.captives.length) { completeAdmin(war); commit(); return; }
    setArt(worldmapArt);
    const box = panel(`Week ${war.week} · muster`, 'Your prisoners', [
      'A general you captured can join you. They fight as themselves, keep the troops they still have, and arrive wounded. The muster costs no turn.',
    ], true);
    const hero = war.generals.find(g => g.isHero);
    const heroDivision = war.divisions.find(d => hero && d.generals.includes(hero.id))?.id ?? null;
    const target = adoptionTarget(war, playerId, heroDivision);
    const into = target.division ? war.divisions.find(d => d.id === target.division) : undefined;
    const prisoners = el('div', 'dl-campaign__roster');
    for (const id of player.captives) {
      const g = war.generals.find(x => x.id === id); if (!g) continue;
      const cell = el('div', 'dl-campaign__choices');
      const b = button(`Adopt ${g.name}`, () => {
        if (!target.division) return;
        try { adoptCaptive(war!, playerId, id, target.division); saveWar(storage, war!); render(); }
        catch (error) { box.append(errorLine(error)); }
      });
      b.disabled = !target.division;
      cell.append(generalCard(g, { tone: 'foe', mp: false, note: into ? `Joins ${divisionName(war, into)}.` : target.division === null ? target.reason : undefined }), b);
      prisoners.append(cell);
    }
    box.append(prisoners, el('h2', undefined, 'Your generals'));
    const roster = el('div', 'dl-campaign__roster');
    for (const g of war.generals.filter(x => x.factionId === playerId)) {
      const captor = war.factions.find(f => f.id !== playerId && f.captives.includes(g.id));
      const division = war.divisions.find(d => d.generals.includes(g.id));
      const where = captor ? `Captured by ${captor.name}.` : g.hp <= 0 ? 'Fallen.'
        : division ? `In ${divisionName(war, division)} at ${nodeNameOf(division.atNode)}.` : `Holding ${nodeNameOf(g.nodeId)}.`;
      roster.append(generalCard(g, { tone: 'own', compact: true, out: !!captor || g.hp <= 0, note: where }));
    }
    box.append(roster);
    const actions = el('div', 'dl-campaign__actions');
    actions.append(button('Resume the war', () => { completeAdmin(war!); commit(); }, true));
    box.append(actions);
    show(box);
  }

  function renderOver(): void {
    if (!war) return;
    const won = war.phase === 'won';
    const hero = war.generals.find(g => g.isHero);
    setArt(worldmapArt);
    const box = el('section', 'dl-campaign__panel dl-campaign__panel--wide dl-panel dl-enter');
    const h = el('h1', `dl-result dl-result--${won ? 'won' : 'lost'}`, won ? 'Dragonland is yours' : 'The war is lost'); h.tabIndex = -1;
    box.append(el('p', 'dl-kicker', `War over · ${plural(war.turn - 1, 'turn')}`), h);
    box.append(el('p', 'dl-campaign__lede', won ? 'Every enemy castle has fallen.'
      : hero && hero.hp <= 0 ? `${hero.name} fell, and the war died with them.` : 'You hold no castles.'));
    // A short account of the war, read from its final state.
    const player = war.factions.find(f => f.id === playerId)!;
    const serving = war.generals.filter(g => g.factionId === playerId && g.hp > 0 && !war!.factions.some(f => f.captives.includes(g.id)));
    const held = war.nodes.filter(n => n.owner === playerId);
    const adopted = (war.turnLog ?? []).flatMap(t => t.actions ?? []).filter(a => a.type === 'adopt').length;
    const lost = war.generals.filter(g => g.factionId === playerId && (g.hp <= 0 || war!.factions.some(f => f.id !== playerId && f.captives.includes(g.id)))).length;
    if (hero) { const card = generalCard(hero, { tone: 'own', out: hero.hp <= 0, troops: false, note: `Level ${hero.level} ${kindName(hero)}.` }); card.style.maxWidth = '420px'; box.append(card); }
    const tally = el('div', 'dl-tally');
    for (const [n, label] of [
      [held.filter(x => x.kind === 'castle').length, 'Castles held'], [held.length, 'Places held'], [serving.length, 'Generals serving'],
      [serving.reduce((sum, g) => sum + g.troops.length, 0), 'Troops'], [adopted, 'Rivals adopted'], [player.captives.length, 'Prisoners held'], [lost, 'Generals lost'],
    ] as [number, string][]) { const cell = el('div'); cell.append(el('b', undefined, String(n)), el('small', undefined, label)); tally.append(cell); }
    box.append(tally);
    const actions = el('div', 'dl-campaign__actions');
    actions.append(button('Start a new war', () => { clearWar(storage); war = null; sequence = null; screen = 'setup'; render(); }, true));
    if (opts.onExit) actions.append(button('Back to menu', () => opts.onExit!()));
    box.append(actions);
    show(box);
  }

  function render(): void {
    if (destroyed) return;
    teardownChildren();
    if (corrupt) return renderTitle();
    if (aftermath && war) return renderAftermath(aftermath);
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
    aftermath = null;
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
