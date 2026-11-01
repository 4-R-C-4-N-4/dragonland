// Uniform spatial grid for neighbor queries (implementation.md §6). Rebuilt every step.
export class SpatialGrid {
  readonly cell: number;
  private buckets = new Map<number, number[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  private key(cx: number, cy: number): number {
    // Pack into a single number; field is small (<= a few thousand px) so this stays safe.
    return cx * 100000 + cy;
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(entity: number, x: number, y: number): void {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const k = this.key(cx, cy);
    let b = this.buckets.get(k);
    if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    b.push(entity);
  }

  /** Entities in the 3x3 block of cells around (x, y), in deterministic insertion order. */
  queryNeighborhood(x: number, y: number, out: number[]): void {
    out.length = 0;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = this.buckets.get(this.key(cx + dx, cy + dy));
        if (b) for (const e of b) out.push(e);
      }
    }
  }
}
