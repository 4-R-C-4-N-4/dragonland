import { describe, it, expect } from 'vitest';
import { Selection } from '../../src/battle/selection';

describe('Selection', () => {
  it('starts with all selected', () => {
    const s = new Selection(4);
    expect(s.isAll()).toBe(true);
    expect(s.selectedSlots()).toBe('all');
  });

  it('selectOnly narrows to one slot', () => {
    const s = new Selection(4);
    s.selectOnly(2);
    expect(s.isAll()).toBe(false);
    expect(s.isSelected(2)).toBe(true);
    expect(s.isSelected(0)).toBe(false);
    expect(s.selectedSlots()).toEqual([2]);
  });

  it('toggle adds/removes and falls back to all when empty', () => {
    const s = new Selection(4);
    s.selectOnly(1);
    s.toggle(1); // removes last -> back to all
    expect(s.isAll()).toBe(true);
    s.toggle(0);
    s.toggle(3);
    expect(s.selectedSlots()).toEqual(expect.arrayContaining([0, 3]));
  });

  it('selectAll resets', () => {
    const s = new Selection(4);
    s.selectOnly(1);
    s.selectAll();
    expect(s.isAll()).toBe(true);
  });
});
