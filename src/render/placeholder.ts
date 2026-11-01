// Pixi placeholder texture generation (implementation.md §10). One texture per (unitId, side, stage, isGeneral).
import { Graphics, Renderer, Texture } from 'pixi.js';
import type { GameData } from '../data';

export const PLAYER_OUTLINE = 0x3a7bd5;
export const ENEMY_OUTLINE = 0xd5423a;

function lineShape(line: 'A' | 'M' | 'Z', g: Graphics, r: number): void {
  if (line === 'A') {
    g.poly([0, -r, r * 0.87, r * 0.5, -r * 0.87, r * 0.5]);
  } else if (line === 'M') {
    g.circle(0, 0, r);
  } else {
    g.rect(-r, -r, r * 2, r * 2);
  }
}

export interface PlaceholderKey {
  unitId: string;
  side: 0 | 1;
}

/** Builds one GPU texture per (unitId, side) placeholder shape. Call once per battle. */
export function buildPlaceholderTextures(renderer: Renderer, data: GameData): Map<string, Texture> {
  const out = new Map<string, Texture>();
  for (const unit of data.units) {
    for (const side of [0, 1] as const) {
      const isGeneral = data.generals.some((g) => g.unitId === unit.id);
      const classDef = data.classById.get(unit.classId);
      const fill = classDef ? parseInt(classDef.color.replace('#', ''), 16) : 0x999999;
      const outline = side === 0 ? PLAYER_OUTLINE : ENEMY_OUTLINE;
      const baseR = isGeneral ? 18 : unit.stage === 2 ? 9 : 7;

      const g = new Graphics();
      lineShape(unit.line, g, baseR);
      g.fill({ color: fill });
      lineShape(unit.line, g, baseR);
      g.stroke({ color: outline, width: isGeneral ? 3 : 2 });
      if (unit.stage === 2) g.circle(0, 0, baseR * 0.3).fill({ color: 0xffffff, alpha: 0.85 });
      if (isGeneral) {
        // Banner/flag above a general.
        g.rect(-2, -baseR - 16, 4, 16).fill({ color: outline });
        g.poly([2, -baseR - 16, 2, -baseR - 6, 14, -baseR - 11]).fill({ color: outline, alpha: 0.9 });
      }
      if (unit.flying) {
        g.ellipse(0, baseR + 6, baseR * 0.8, baseR * 0.3).fill({ color: 0x000000, alpha: 0.25 });
      }
      const tex = renderer.generateTexture(g);
      g.destroy();
      out.set(`${unit.id}:${side}`, tex);
    }
  }
  return out;
}

export function placeholderKey(unitId: string, side: 0 | 1): string {
  return `${unitId}:${side}`;
}
