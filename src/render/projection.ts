// Shared ground-plane mapping. Simulation geometry remains flat and unchanged.
export interface FieldProjection {
  readonly fieldW: number;
  readonly fieldH: number;
  readonly verticalScale: number;
  readonly farWidthScale: number;
  readonly nearSpriteScale: number;
  readonly farSpriteScale: number;
}

export function createProjection(fieldW: number, fieldH: number): FieldProjection {
  if (!Number.isFinite(fieldW) || !Number.isFinite(fieldH) || fieldW <= 0 || fieldH <= 0) {
    throw new Error('projection requires finite positive field dimensions');
  }
  return { fieldW, fieldH, verticalScale: 0.75, farWidthScale: 0.82, nearSpriteScale: 1.05, farSpriteScale: 0.85 };
}

function widthScale(p: FieldProjection, y: number): number {
  return p.farWidthScale + (1 - p.farWidthScale) * y / p.fieldH;
}

/** A ground point, including nearby off-field FX positions, into the projected plane. */
export function projectGround(p: FieldProjection, x: number, y: number): [number, number] {
  return [p.fieldW / 2 + (x - p.fieldW / 2) * widthScale(p, y), y * p.verticalScale];
}

/** Inverse used by camera/pointer input; no approximation using sprite scale. */
export function unprojectGround(p: FieldProjection, x: number, y: number): [number, number] {
  const worldY = y / p.verticalScale;
  const scale = widthScale(p, worldY);
  if (Math.abs(scale) < 1e-9) throw new Error('point lies at the perspective singularity');
  return [p.fieldW / 2 + (x - p.fieldW / 2) / scale, worldY];
}

/** Uniform upright sprite scaling, separate from the ground plane transform. */
export function depthScale(p: FieldProjection, y: number): number {
  const t = Math.max(0, Math.min(1, y / p.fieldH));
  return p.farSpriteScale + (p.nearSpriteScale - p.farSpriteScale) * t;
}

export function projectedBounds(p: FieldProjection): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: p.fieldW, height: p.fieldH * p.verticalScale };
}
