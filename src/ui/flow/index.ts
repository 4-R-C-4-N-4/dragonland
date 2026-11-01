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
import type { StartBattleView } from '../../battle/types';
import { dataForBattle } from '../debug';
import { getBattleCounter, bumpBattleCounter } from './battleCounter';
import { flowReducer, initialFlowState, type FlowState } from './state';
import { runHeadlessBattle } from './headlessBattle';
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
  let destroyed = false;

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
    const initial = state.playerLoadout;
    builderHandle = mountBuilder(screenEl, {
      data,
      store,
      onStartBattle: (loadout) => dispatch({ type: 'startFromBuilder', loadout }),
    });
    if (initial) {
      // The builder already loads the player's last-saved loadout by default; nothing extra
      // needed here since store.saveLoadout() was called before returning to the builder.
      void initial;
    }
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
          <h2>Enemy: ${enemyGeneral?.name ?? commit.side.generalId}</h2>
          <p class="dl-dim">HP ${enemyGeneral?.hp ?? '?'} · Special: ${enemyGeneral?.special.name ?? '?'} · Formation: ${battleData.formationById.get(commit.side.formationId)?.name ?? commit.side.formationId}</p>
          <ul class="dl-enemy-squads">
            ${commit.side.squads
              .map((sq) => {
                const counts = new Map<string, number>();
                for (const t of sq.troops) {
                  const cid = battleData.unitById.get(t.unitId)?.classId ?? '?';
                  counts.set(cid, (counts.get(cid) ?? 0) + 1);
                }
                return `<li><strong>${escapeHtml(sq.name)}</strong> (${sq.disposition}, ${sq.troops.length}): ${Array.from(counts.entries()).map(([c, n]) => `${c} ×${n}`).join(', ')}</li>`;
              })
              .join('')}
          </ul>
        </div>

        <div class="dl-panel dl-response-card">
          <h2>Your army: ${escapeHtml(sanitized.name)}</h2>
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
              .map((m) => `<li class="dl-matchup-${m.verdict}">${icon[m.verdict]} <strong>${escapeHtml(m.squad.name)}</strong> — ${m.verdict}</li>`)
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
      store.saveLoadout(sanitized);
      store.setLastComposition(companyComposition(sanitized, roster, battleData));
      dispatch({ type: 'fight', setup: { seed: state.seed, sides: [playerSide, commit.side] } });
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
    battleContainer = document.createElement('div');
    battleContainer.className = 'dl-battle-root';
    root.appendChild(battleContainer);

    const battleData = dataForBattle(data);
    const labels = { player: loadout.name, enemy: commit.loadout.name };

    function finish(world: World): void {
      if (destroyed) return;
      screenEl.style.display = 'block';
      dispatch({ type: 'battleFinished', world });
    }

    void (async () => {
      try {
        // Lazy-loaded so Pixi only downloads when a battle starts.
        const mod: { startBattleView: StartBattleView } = await import('../../battle/view');
        const view = await mod.startBattleView(battleContainer!, { data: battleData, setup, labels, onFinished: finish });
        // Keep a destroy hook reachable in case the flow is torn down mid-battle.
        (battleContainer as HTMLElement & { __view?: { destroy(): void } }).__view = view;
      } catch (err) {
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

    const winnerLabel = result.winner === 0 ? 'Victory!' : 'Defeat.';
    const reasonLabel = result.reason === 'generalDefeated' ? 'the enemy general was defeated' : 'won by duel';

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
      store.applyBattleResult(result.dead[0]);
      const freshRoster = store.getRoster();
      const { loadout: sanitized } = sanitizeLoadout(loadout, freshRoster);
      store.setLastComposition(companyComposition(sanitized, freshRoster, data));
      store.saveLoadout(sanitized);
      dispatch({ type: 'backToBuilder' });
    });
  }

  renderScreen();

  return {
    destroy() {
      destroyed = true;
      builderHandle?.destroy();
      screenEl.remove();
      battleContainer?.remove();
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
