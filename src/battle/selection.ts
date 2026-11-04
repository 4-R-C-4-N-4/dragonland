// Squad selection state (pure) — used by input.ts and the HUD.
export class Selection {
  private selected = new Set<number>();
  private all = false;

  constructor(private numSquads: number) {
    this.selectAll();
  }

  selectAll(): void {
    this.all = true;
    this.selected.clear();
  }

  selectOnly(slot: number): void {
    this.all = false;
    this.selected.clear();
    this.selected.add(slot);
  }

  toggle(slot: number): void {
    this.all = false;
    if (this.selected.has(slot)) this.selected.delete(slot);
    else this.selected.add(slot);
    if (this.selected.size === 0) this.all = true;
  }

  isSelected(slot: number): boolean {
    return this.all || this.selected.has(slot);
  }

  isAll(): boolean {
    return this.all;
  }

  selectedSlots(): number[] | 'all' {
    if (this.all) return 'all';
    return [...this.selected];
  }
}
