// Movement primitives (implementation.md §5 steering.ts). Pure vector math + grid-based separation.
import type { Entities } from './types';
import type { SpatialGrid } from './spatialGrid';

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function normalizeTo(dx: number, dy: number, mag: number): [number, number] {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 0];
  return [(dx / len) * mag, (dy / len) * mag];
}

/** Separation among nearby same-domain (ground/ground or flying/flying) entities within radius. */
export function separationForce(
  ents: Entities,
  flying: Uint8Array,
  grid: SpatialGrid,
  buf: number[],
  e: number,
  radius: number,
  weight: number,
): [number, number] {
  const selfFlying = flying[e] === 1;
  grid.queryNeighborhood(ents.x[e]!, ents.y[e]!, buf);
  let fx = 0;
  let fy = 0;
  for (const o of buf) {
    if (o === e || ents.alive[o] === 0) continue;
    if ((flying[o] === 1) !== selfFlying) continue;
    const dx = ents.x[e]! - ents.x[o]!;
    const dy = ents.y[e]! - ents.y[o]!;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < radius) {
      const push = (radius - d) / radius;
      fx += (dx / d) * push;
      fy += (dy / d) * push;
    }
  }
  return [fx * weight, fy * weight];
}
