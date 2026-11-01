import { describe, expect, it } from 'vitest';
import { deltaE, deriveSquadColor, hexToRgb, MIN_SIDE_DELTA_E, pickEnemyTeamColor, resolveSideColors, rgbToHex, TEAM_PALETTE } from '../src/data/colors';

describe('team colours', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#3a7bd5'))).toBe('#3a7bd5');
  });

  it('derived squad shades are distinct from each other but close to the team colour', () => {
    for (const team of TEAM_PALETTE) {
      const shades = [0, 1, 2, 3].map((i) => deriveSquadColor(team, i));
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) expect(deltaE(shades[i]!, shades[j]!)).toBeGreaterThan(10);
      // Same family: shades differ from the team colour in lightness, not hue.
      const hue = (hex: string) => { const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 0.08) return null; const d = mx - mn; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
      const h0 = hue(team);
      if (h0 !== null) for (const sh of shades) { const h = hue(sh); if (h !== null) expect(Math.min(Math.abs(h - h0), 360 - Math.abs(h - h0))).toBeLessThan(4); }
    }
  });

  it('explicit squad colours win over derived shades', () => {
    const c = resolveSideColors('#3a7bd5', [undefined, '#ffffff'], '#000000');
    expect(c.squads[1]).toBe('#ffffff');
    expect(c.squads[0]).toBe(deriveSquadColor('#3a7bd5', 0));
  });

  it('enemy keeps its preferred colour unless it clashes with any player colour', () => {
    expect(pickEnemyTeamColor(['#3a7bd5'], '#d5423a')).toBe('#d5423a');
    const clash = pickEnemyTeamColor(['#d5423a', '#c83a30'], '#d5423a');
    expect(clash).not.toBe('#d5423a');
    expect(Math.min(deltaE(clash, '#d5423a'), deltaE(clash, '#c83a30'))).toBeGreaterThanOrEqual(MIN_SIDE_DELTA_E);
  });
});
