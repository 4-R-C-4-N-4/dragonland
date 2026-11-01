import { describe, it, expect } from 'vitest';
import { contrastMono, squadColorFor, squadColorNumberFor, teamColorNumber, colorTextureKey, hexToNumber } from '../../src/render/colorUi';
import type { SideColors } from '../../src/data/colors';

describe('contrastMono', () => {
  it('picks white text over dark backgrounds', () => {
    expect(contrastMono('#111111')).toBe(0xffffff);
    expect(contrastMono('#30303a')).toBe(0xffffff);
  });

  it('picks black text over light/bright backgrounds', () => {
    expect(contrastMono('#ffffff')).toBe(0x111111);
    expect(contrastMono('#e0b030')).toBe(0x111111); // gold
  });
});

describe('squadColorFor', () => {
  const colors: SideColors = { team: '#3a7bd5', squads: ['#3a7bd5', '#88aee0'] };

  it('returns the explicit squad colour when present', () => {
    expect(squadColorFor(colors, 0)).toBe('#3a7bd5');
    expect(squadColorFor(colors, 1)).toBe('#88aee0');
  });

  it('derives a shade for slots beyond the resolved array', () => {
    const derived = squadColorFor(colors, 3);
    expect(derived).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('squadColorNumberFor / teamColorNumber convert to Pixi colour numbers', () => {
    expect(squadColorNumberFor(colors, 0)).toBe(hexToNumber('#3a7bd5'));
    expect(teamColorNumber(colors)).toBe(hexToNumber('#3a7bd5'));
  });
});

describe('colorTextureKey', () => {
  it('is stable and case-insensitive on the colour', () => {
    expect(colorTextureKey('ogre', '#AABBCC')).toBe(colorTextureKey('ogre', '#aabbcc'));
    expect(colorTextureKey('ogre', '#aabbcc')).not.toBe(colorTextureKey('wolf', '#aabbcc'));
  });
});
