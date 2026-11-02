// In-battle enemy (and player-assist) command policy (implementation.md §8). Reads World only,
// acts only through issueCommand/fireSpecial — no cheating, no direct mutation.
import type { GameData } from '../data';
import { fireSpecial, issueCommand } from '../sim/step';
import { canFireSpecial } from '../sim/specials';
import type { Side, World } from '../sim/types';

export interface AiController {
  update(world: World): void;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function enemySide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export function createAiController(data: GameData, side: Side): AiController {
  let lastDecisionFightTime = -Infinity;
  let retreating = false;

  return {
    update(world: World): void {
      if (world.phase !== 'fight') return;
      const policy = data.aiPolicy;
      if (world.fightTimeS - lastDecisionFightTime < policy.decisionIntervalS) return;
      lastDecisionFightTime = world.fightTimeS;

      const general = world.generals[side];
      const ents = world.ents;
      const hpFrac = ents.hp[general.entity]! / ents.maxHp[general.entity]!;
      const guardSquads = world.squads.filter((s) => s.side === side && s.disposition === 'guard');

      if (hpFrac < policy.generalLowHpFrac) {
        retreating = true;
        for (const sq of guardSquads) issueCommand(world, side, sq.id, 'fallBack');
      } else if (retreating) {
        let threatNear = false;
        const gx = ents.x[general.entity]!;
        const gy = ents.y[general.entity]!;
        for (let i = 0; i < ents.count; i++) {
          if (ents.alive[i] === 0 || ents.side[i] !== enemySide(side)) continue;
          if (dist(gx, gy, ents.x[i]!, ents.y[i]!) <= policy.threatClearRadius) {
            threatNear = true;
            break;
          }
        }
        if (!threatNear) {
          retreating = false;
          for (const sq of guardSquads) issueCommand(world, side, sq.id, 'advance');
        }
      }

      if (canFireSpecial(world, side)) {
        // Field-wide specials (D24): fire once enough enemies are on the field, or, for heal-only
        // specials, once enough allies are wounded.
        const healOnly = general.special.effects.every((e) => e.type === 'heal' || e.type === 'buff');
        let enemies = 0;
        let wounded = 0;
        for (let i = 0; i < ents.count; i++) {
          if (ents.alive[i] === 0 || ents.isGeneral[i] === 1) continue;
          if (ents.side[i] === side) {
            if (ents.hp[i]! < ents.maxHp[i]!) wounded++;
          } else enemies++;
        }
        const ready = healOnly ? wounded >= policy.specialMinWoundedAllies : enemies >= policy.specialMinEnemiesInArea;
        if (ready) fireSpecial(world, side);
      }
    },
  };
}
