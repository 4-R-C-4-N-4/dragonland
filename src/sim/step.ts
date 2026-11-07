// Fixed-step entry point (implementation.md §5 step.ts, §6).
import { flushDeaths, retargetAndMoveTroops, runGenerals, settleBodies } from './behavior';
import { canFireSpecial, doFireSpecial, tickActiveEffects, rechargeMp } from './specials';
import { checkFightEnd } from './skirmish';
import { runDuelTick } from './duel';
import type { Approach, Command } from '../data/schemas';
import type { RecordedCommand, Side, World } from './types';
import { internalOf, type PendingCommand, type WorldInternal } from './world';

function applyPendingCommands(world: World): void {
  const internal = internalOf(world);
  const pending = internal.pending;
  internal.pending = [];
  for (const p of pending) {
    const rec: RecordedCommand = { tick: world.tick, side: p.side, squadId: p.squadId, command: p.command };
    world.commandLog.push(rec);
    if (p.command === 'special') {
      const data = internal.data;
      if (canFireSpecial(world, p.side)) doFireSpecial(world, data, p.side);
      continue;
    }
    for (const squad of world.squads) {
      if (squad.side !== p.side) continue;
      if (p.squadId !== 'all' && squad.id !== p.squadId) continue;
      if (p.command === 'direct' || p.command === 'farFlank' || p.command === 'nearFlank') {
        if (squad.approach !== p.command) squad.flankReady = false;
        squad.approach = p.command;
      } else {
        if (squad.command !== p.command && p.command === 'advance') squad.flankReady = false;
        squad.command = p.command;
      }
    }
  }
}

function snapshotPrev(world: World): void {
  const ents = world.ents;
  ents.prevX.set(ents.x);
  ents.prevY.set(ents.y);
}

export function step(world: World): void {
  if (world.paused || world.phase === 'result') return;
  const internal = internalOf(world);
  const data = internal.data;
  const dt = 1 / data.constants.SIM_HZ;

  snapshotPrev(world);
  world.events.length = 0;
  applyPendingCommands(world);
  if (world.result) {
    world.tick++;
    return;
  }

  if (world.phase === 'deploy') {
    settleBodies(world);
    world.deployRemainingS = Math.max(0, world.deployRemainingS - dt);
    if (world.deployRemainingS === 0) {
      world.phase = 'fight';
      world.events.push({ type: 'phase', phase: 'fight' });
    }
  } else if (world.phase === 'fight') {
    retargetAndMoveTroops(world, dt);
    runGenerals(world);
    flushDeaths(world);
    tickActiveEffects(world, dt);
    rechargeMp(world, dt);
    world.fightTimeS += dt;
    checkFightEnd(world);
  } else if (world.phase === 'duel') {
    rechargeMp(world, dt);
    runDuelTick(world, dt);
  }

  world.tick++;
}

export function setPaused(world: World, paused: boolean): void {
  world.paused = paused;
}

export function issueCommand(world: World, side: Side, squadId: string | 'all', command: Command): void {
  const internal = internalOf(world) as WorldInternal;
  internal.pending.push({ side, squadId, command });
}

/** Latest queued intent for HUD/planning, without executing a simulation tick. */
export function getSquadIntent(world: World, squadIndex: number): { command: Command; approach: Approach; pending: boolean } {
  const squad = world.squads[squadIndex];
  if (!squad) throw new Error(`unknown squad index ${squadIndex}`);
  let { command, approach } = squad;
  let pending = false;
  for (const p of internalOf(world).pending) {
    if (p.side !== squad.side || (p.squadId !== 'all' && p.squadId !== squad.id) || p.command === 'special') continue;
    if (p.command === 'direct' || p.command === 'farFlank' || p.command === 'nearFlank') approach = p.command;
    else command = p.command;
    pending = true;
  }
  return { command, approach, pending };
}

export function issueApproach(world: World, side: Side, squadId: string | 'all', approach: Approach): void {
  internalOf(world).pending.push({ side, squadId, command: approach });
}

export function fireSpecial(world: World, side: Side): boolean {
  const internal = internalOf(world) as WorldInternal;
  const can = canFireSpecial(world, side);
  internal.pending.push({ side, squadId: 'all', command: 'special' });
  return can;
}
