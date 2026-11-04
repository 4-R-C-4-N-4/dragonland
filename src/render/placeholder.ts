// Pixi placeholder texture generation (implementation.md §10). One set of shape textures per
// unitId (body fill is class-coloured, shape is independent of side/colour): a solid body, a
// hollow outline silhouette, a slightly larger hollow rim silhouette, and a flat disc — the
// outline/rim/disc are tinted at runtime to the troop's squad/team colour so side+squad identity
// never requires rebaking a texture per colour.
import { Graphics, Renderer, Texture } from 'pixi.js';
import type { GameData } from '../data';

function lineShape(line: 'A' | 'M' | 'Z', g: Graphics, r: number): void {
  if (line === 'A') {
    g.poly([0, -r, r * 0.87, r * 0.5, -r * 0.87, r * 0.5]);
  } else if (line === 'M') {
    g.circle(0, 0, r);
  } else {
    g.rect(-r, -r, r * 2, r * 2);
  }
}

export interface UnitPlaceholder {
  body: Texture; // class-coloured fill, no outline baked in
  outline: Texture; // hollow stroke at the body radius, white (tint = squad colour)
  rim: Texture; // hollow stroke further out, white (tint = team colour)
  disc: Texture; // flat ellipse, white (tint = squad colour), sits under the troop
  baseR: number;
}

/** Builds one placeholder set per unitId. Call once per battle. */
export function buildPlaceholderTextures(renderer: Renderer, data: GameData): Map<string, UnitPlaceholder> {
  const out = new Map<string, UnitPlaceholder>();
  for (const unit of data.units) {
    const isGeneral = data.generals.some((g) => g.unitId === unit.id);
    const classDef = data.classById.get(unit.classId);
    const fill = classDef ? parseInt(classDef.color.replace('#', ''), 16) : 0x999999;
    const baseR = isGeneral ? 24 : unit.stage === 2 ? 13 : 10;

    const bodyG = new Graphics();
    lineShape(unit.line, bodyG, baseR);
    bodyG.fill({ color: fill });
    if (unit.stage === 2) bodyG.circle(0, 0, baseR * 0.3).fill({ color: 0xffffff, alpha: 0.85 });
    if (unit.flying) bodyG.ellipse(0, baseR + 6, baseR * 0.8, baseR * 0.3).fill({ color: 0x000000, alpha: 0.25 });
    const body = renderer.generateTexture(bodyG);
    bodyG.destroy();

    const outlineG = new Graphics();
    lineShape(unit.line, outlineG, baseR + 1);
    outlineG.stroke({ color: 0xffffff, width: isGeneral ? 5 : 3.5 });
    const outline = renderer.generateTexture(outlineG);
    outlineG.destroy();

    const rimG = new Graphics();
    lineShape(unit.line, rimG, baseR + (isGeneral ? 6 : 4.5));
    rimG.stroke({ color: 0xffffff, width: 1.5 });
    const rim = renderer.generateTexture(rimG);
    rimG.destroy();

    const discG = new Graphics();
    discG.ellipse(0, 0, baseR * (isGeneral ? 1.5 : 1.35), baseR * (isGeneral ? 0.6 : 0.55)).fill({ color: 0xffffff });
    const disc = renderer.generateTexture(discG);
    discG.destroy();

    out.set(unit.id, { body, outline, rim, disc, baseR });
  }
  return out;
}
