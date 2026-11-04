// Flow DOM controller: wires the Builder, EnemyCommit, PlayerResponse, Battle and Result screens
// together using the pure reducer in state.ts. Mounts into a root element; owns its own screen div.
import '../common/theme.css';
import type { GameData } from '../../data';
import { companyComposition, loadoutToSideSetup, matchupSummary, sanitizeLoadout } from '../builder/logic';
import { mountBuilder } from '../builder';
import type { Store } from '../../persist/store';
import type { Loadout } from '../../data/schemas';
import type { World } from '../../sim';
import { commitEnemy, type CommitResult } from '../../ai/commit';
import type { BattleView, StartBattleView } from '../../battle/types';
import { playerDeadIds } from '../../battle/helpers';
import { dataForBattle } from '../debug';
import { getBattleCounter, bumpBattleCounter } from './battleCounter';
import { flowReducer, initialFlowState, type FlowState } from './state';
import { runHeadlessBattle } from './headlessBattle';
import { resolveEnemySideColors } from './colors';
import { DEFAULT_PLAYER_COLOR, resolveSideColors } from '../../data/colors';
import './flow.css';

export interface MountFlowOptions {
  data: GameData;
  store: Store;
  storage: Storage;
}

export interface MountedFlow {
  destroy(): void;
}

export function mountFlow(root: HTMLElement, opts: MountFlowOptions): MountedFlow {
  const { data, store, storage } = opts;

  let state: FlowState = initialFlowState(getBattleCounter(storage), getBattleCounter(storage));
  let builderHandle: { destroy(): void } | null = null;
  let battleContainer: HTMLElement | null = null;
  let battleView: BattleView | null = null;
  let destroyed = false;
  const appliedResults = new WeakSet<World>();

  root.innerHTML = '';
  const screenEl = document.createElement('div');
  screenEl.className = 'dl-screen';
  root.appendChild(screenEl);

  function dispatch(event: Parameters<typeof flowReducer>[1]): void {
    state = flowReducer(state, event);
    renderScreen();
  }

  function renderScreen(): void {
    if (destroyed) return;
    builderHandle?.destroy();
    builderHandle = null;
    battleView?.destroy();
    battleView = null;
    if (battleContainer) {
      battleContainer.remove();
      battleContainer = null;
    }
    screenEl.style.display = 'block';
    screenEl.innerHTML = '';

    switch (state.screen) {
      case 'builder':
        renderBuilder();
        break;
      case 'enemyCommit':
        renderEnemyCommit();
        break;
      case 'playerResponse':
        renderPlayerResponse();
        break;
      case 'battle':
        renderBattle();
        break;
      case 'result':
        renderResult();
        break;
    }
  }

  function renderBuilder(): void {
    builderHandle = mountBuilder(screenEl, {
      data,
      store,
      onStartBattle: (loadout) => dispatch({ type: 'startFromBuilder', loadout }),
      initialLoadoutId: state.playerLoadout?.id,
    });
  }

  function renderEnemyCommit(): void {
    screenEl.innerHTML = `
      <div class="dl-screen-wrap">
        <h1 class="dl-title">Enemy Commits</h1>
        <p class="dl-flavor">The enemy general studies the field and commits their forces — without seeing your army.</p>
        <div class="dl-panel dl-commit-card"><p class="dl-dim">Committing…</p></div>
      </div>
    `;
    // Run on next tick so the "Committing…" state briefly shows (and so dispatch doesn't recurse
    // synchronously inside renderScreen).
    setTimeout(() => {
      if (destroyed || state.screen !== 'enemyCommit') return;
      const battleData = dataForBattle(data);
      const seed = bumpBattleCounter(storage);
      let commit: CommitResult;
      try {
        commit = commitEnemy(battleData, store.getLastComposition(), seed);
      } catch (e) {
        screenEl.innerHTML = `<div class="dl-screen-wrap"><p class="dl-error">Could not commit the enemy: ${e instanceof Error ? e.message : String(e)}</p></div>`;
        return;
      }
      dispatch({ type: 'enemyCommitted', commit, seed });
    }, 10);
  }

  function renderPlayerResponse(): void {
    const commit = state.enemyCommit;
    const loadout = state.playerLoadout;
    if (!commit || !loadout) {
      dispatch({ type: 'backToBuilderFromResponse' });
      return;
    }
    const battleData = dataForBattle(data);
    const roster = store.getRoster();
    const { loadout: sanitized } = sanitizeLoadout(loadout, roster);
    state = { ...state, playerLoadout: sanitized };

    const general = battleData.generalById.get(sanitized.generalId);
    const enemyGeneral = battleData.generalById.get(commit.side.generalId);
    const enemyUnitIds = commit.side.squads.flatMap((s) => s.troops.map((t) => t.unitId));
    const enemyClassCounts = new Map<string, number>();
    for (const uid of enemyUnitIds) {
      const cid = battleData.unitById.get(uid)?.classId ?? '?';
      enemyClassCounts.set(cid, (enemyClassCounts.get(cid) ?? 0) + 1);
    }

    const playerColors = resolveSideColors(sanitized.color, sanitized.squads.map((s) => s.color), DEFAULT_PLAYER_COLOR);
    const enemyColors = resolveEnemySideColors(sanitized, commit.side.squads.length, commit.loadout.color);
    const swatch = (color: string) => `<span class="dl-color-swatch" style="background:${color}"></span>`;

    const matchups = sanitized.squads.map((sq) => {
      const unitIds = sq.troopIds.map((id) => roster.find((t) => t.id === id)?.unitId).filter((u): u is string => Boolean(u));
      const verdict = matchupSummary(unitIds, enemyUnitIds, battleData);
      return { squad: sq, verdict };
    });
    const icon = { strong: '▲', neutral: '●', weak: '▼' } as const;
    const strongCount = matchups.filter((m) => m.verdict === 'strong').length;
    const weakCount = matchups.filter((m) => m.verdict === 'weak').length;
    const overall = strongCount > weakCount ? 'Favorable matchup.' : weakCount > strongCount ? 'Unfavorable matchup — consider adjusting.' : 'Even matchup.';

    screenEl.innerHTML = `
      <div class="dl-screen-wrap">
        <h1 class="dl-title">Prepare for Battle</h1>

        <div class="dl-panel dl-commit-card">
          <h2>${swatch(enemyColors.team)} Enemy: ${enemyGeneral?.name ?? commit.side.generalId}</h2>
          <p class="dl-dim">HP ${enemyGeneral?.hp ?? '?'} · Special: ${enemyGeneral?.special.name ?? '?'} · Formation: ${battleData.formationById.get(commit.side.formationId)?.name ?? commit.side.formationId}</p>
          <ul class="dl-enemy-squads">
            ${commit.side.squads
              .map((sq, i) => {
                const counts = new Map<string, number>();
                for (const t of sq.troops) {
                  const cid = battleData.unitById.get(t.unitId)?.classId ?? '?';
                  counts.set(cid, (counts.get(cid) ?? 0) + 1);
                }
                return `<li>${swatch(enemyColors.squads[i]!)} <strong>${escapeHtml(sq.name)}</strong> (${sq.disposition}, ${sq.troops.length}): ${Array.from(counts.entries()).map(([c, n]) => `${c} ×${n}`).join(', ')}</li>`;
              })
              .join('')}
          </ul>
        </div>

        <div class="dl-panel dl-response-card">
          <h2>${swatch(playerColors.team)} Your army: ${escapeHtml(sanitized.name)}</h2>
          <p class="dl-dim">General: ${general?.name ?? sanitized.generalId}</p>
          <button id="dl-back-to-builder">← Edit in builder</button>

          <label class="dl-formation-picker">Formation:
            <select id="dl-formation">
              ${battleData.formations.map((f) => `<option value="${f.id}" ${f.id === state.formationId ? 'selected' : ''}>${f.name}</option>`).join('')}
            </select>
          </label>
          <div class="dl-formation-diagram" id="dl-formation-diagram">${renderFormationDiagram(battleData, state.formationId)}</div>

          <h3>Matchup preview</h3>
          <p>${overall}</p>
          <ul class="dl-matchup-list">
            ${matchups
              .map((m, i) => `<li class="dl-matchup-${m.verdict}">${swatch(playerColors.squads[i]!)} ${icon[m.verdict]} <strong>${escapeHtml(m.squad.name)}</strong> — ${m.verdict}</li>`)
              .join('')}
          </ul>

          <button id="dl-fight" class="dl-primary dl-start">Fight!</button>
        </div>
      </div>
    `;

    screenEl.querySelector('#dl-back-to-builder')?.addEventListener('click', () => dispatch({ type: 'backToBuilderFromResponse' }));
    screenEl.querySelector<HTMLSelectElement>('#dl-formation')?.addEventListener('change', (e) => {
      const formationId = (e.target as HTMLSelectElement).value;
      dispatch({ type: 'chooseFormation', formationId });
    });
    screenEl.querySelector('#dl-fight')?.addEventListener('click', () => {
      const playerSide = loadoutToSideSetup(sanitized, roster, state.formationId);
      const enemySide = {
        ...commit.side,
        color: enemyColors.team,
        squads: commit.side.squads.map((sq, i) => ({ ...sq, color: enemyColors.squads[i] })),
      };
      store.saveLoadout(sanitized);
      store.setLastComposition(companyComposition(sanitized, roster, battleData));
      dispatch({ type: 'fight', setup: { seed: state.seed, sides: [playerSide, enemySide] } });
    });
  }

  function renderFormationDiagram(battleData: GameData, formationId: string): string {
    const f = battleData.formationById.get(formationId);
    if (!f) return '';
    const w = 80;
    const h = 60;
    const dots = f.slots
      .map((s) => {
        const x = w / 2 + s.fx * (w / 2 - 6);
        const y = h / 2 + s.fy * (h / 2 - 6);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--dl-accent)" />`;
      })
      .join('');
    const gx = w / 2 + f.generalOffset.fx * (w / 2 - 6);
    const gy = h / 2 + f.generalOffset.fy * (h / 2 - 6);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="var(--dl-border)" />
      <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="5" fill="var(--dl-bad)" />
      ${dots}
    </svg>`;
  }

  function renderBattle(): void {
    const setup = state.battleSetup;
    const loadout = state.playerLoadout;
    const commit = state.enemyCommit;
    if (!setup || !loadout || !commit) {
      dispatch({ type: 'backToBuilderFromResponse' });
      return;
    }
    screenEl.style.display = 'none';
    const container = document.createElement('div');
    battleContainer = container;
    container.className = 'dl-battle-root';
    root.appendChild(container);
    const battleId = state.battleCount;
    const isActive = () => !destroyed && battleContainer === container && state.screen === 'battle' && state.battleCount === battleId;

    const battleData = dataForBattle(data);
    const labels = { player: loadout.name, enemy: commit.loadout.name };

    function finish(world: World): void {
      if (!isActive() || !world.result) return;
      screenEl.style.display = 'block';
      dispatch({ type: 'battleFinished', world });
    }

    let quitCasualtiesApplied = false;
    function quit(world: World): void {
      if (!isActive() || world.result) return;
      if (!quitCasualtiesApplied) {
        store.applyBattleResult(playerDeadIds(world));
        quitCasualtiesApplied = true;
      }
      const { loadout: sanitized } = sanitizeLoadout(loadout!, store.getRoster());
      store.saveLoadout(sanitized);
      state = { ...state, playerLoadout: sanitized };
      dispatch({ type: 'quitBattle' });
    }

    void (async () => {
      try {
        // Lazy-loaded so Pixi only downloads when a battle starts.
        const mod: { startBattleView: StartBattleView } = await import('../../battle/view');
        if (!isActive()) return;
        const view = await mod.startBattleView(container, {
          data: battleData, setup, labels, onFinished: finish, onQuit: quit,
          quitMessage: 'Return to the builder? Troops already fallen stay lost. No rewards will be earned.',
          quitConfirmLabel: 'Return to builder',
        });
        if (!isActive()) view.destroy();
        else battleView = view;
      } catch (err) {
        if (!isActive()) return;
        // The battle view failed to start (e.g. no WebGL). Resolve the battle headlessly so the
        // player's progress is not lost, but make the failure loud.
        console.error('Battle view failed to start; resolving headlessly.', err);
        const world = runHeadlessBattle(battleData, setup);
        finish(world);
      }
    })();
  }

  function renderResult(): void {
    const world = state.result;
    const loadout = state.playerLoadout;
    const commit = state.enemyCommit;
    if (!world || !world.result || !loadout || !commit) {
      dispatch({ type: 'backToBuilder' } as never);
      return;
    }
    const result = world.result;
    const roster = store.getRoster();
    const rosterById = new Map(roster.map((t) => [t.id, t] as const));
    const playerDeadIds = result.dead[0];
    const playerAliveIds = result.survivors[0];
    const enemyDeadNames = findNamesInSide(commit.side, result.dead[1]);
    const enemyAliveNames = findNamesInSide(commit.side, result.survivors[1]);

    const playerDeadNames = playerDeadIds.map((id) => rosterById.get(id)?.name ?? id);
    const playerAliveNames = playerAliveIds.map((id) => rosterById.get(id)?.name ?? id);

    // Apply roster updates as soon as the result is known (not on button click), exactly once per
    // battle, so closing the tab on the result screen cannot resurrect dead troops.
    // Counter-pick input is the company as it entered this battle (§8 "previous battle's company").
    if (!appliedResults.has(world)) {
      appliedResults.add(world);
      store.setLastComposition(companyComposition(loadout, roster, data));
      store.applyBattleResult(result.dead[0]);
      const { loadout: sanitized } = sanitizeLoadout(loadout, store.getRoster());
      store.saveLoadout(sanitized);
    }

    const winnerLabel = result.winner === 0 ? 'Victory!' : 'Defeat.';
    const loserGeneral = result.winner === 0 ? 'the enemy general was defeated' : 'your general was defeated';
    const reasonLabel = result.reason === 'generalDefeated' ? loserGeneral : 'decided by a duel';

    screenEl.innerHTML = `
      <div class="dl-screen-wrap">
        <h1 class="dl-title">${winnerLabel}</h1>
        <p class="dl-flavor">${result.winner === 0 ? 'Your forces have won' : 'Your forces were defeated'} — ${reasonLabel}. Duration: ${result.durationS.toFixed(1)}s${result.hadDuel ? ' (including a duel)' : ''}.</p>

        <div class="dl-result-grid">
          <div class="dl-panel">
            <h2>Your troops</h2>
            <p>${playerAliveNames.length} survived, ${playerDeadNames.length} fallen.</p>
            <h3>Survivors</h3>
            <ul class="dl-troop-list">${playerAliveNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="dl-dim">none</li>'}</ul>
            <h3>Fallen</h3>
            <ul class="dl-troop-list dl-fallen">${playerDeadNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="dl-dim">none</li>'}</ul>
          </div>
          <div class="dl-panel">
            <h2>Enemy troops</h2>
            <p>${enemyAliveNames.length} survived, ${enemyDeadNames.length} fallen.</p>
            <h3>Survivors</h3>
            <ul class="dl-troop-list">${enemyAliveNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="dl-dim">none</li>'}</ul>
            <h3>Fallen</h3>
            <ul class="dl-troop-list dl-fallen">${enemyDeadNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('') || '<li class="dl-dim">none</li>'}</ul>
          </div>
        </div>

        <button id="dl-back-to-builder-result" class="dl-primary dl-start">Back to builder</button>
      </div>
    `;

    screenEl.querySelector('#dl-back-to-builder-result')?.addEventListener('click', () => {
      dispatch({ type: 'backToBuilder' });
    });
  }

  renderScreen();

  return {
    destroy() {
      destroyed = true;
      builderHandle?.destroy();
      battleView?.destroy();
      battleView = null;
      screenEl.remove();
      battleContainer?.remove();
      battleContainer = null;
    },
  };
}

function findNamesInSide(side: { squads: { troops: { troopId: string; name: string }[] }[] }, troopIds: string[]): string[] {
  const byId = new Map<string, string>();
  for (const sq of side.squads) for (const t of sq.troops) byId.set(t.troopId, t.name);
  return troopIds.map((id) => byId.get(id) ?? id);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
