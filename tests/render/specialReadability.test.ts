import { describe, expect, it } from 'vitest';
import { fxSize, fxDurationScale } from '../../src/render/fx';

describe('support-special readability', () => {
  it('keeps Guiding Light visible twice as long without slowing other specials', () => {
    expect(fxDurationScale('guiding-light')).toBe(2);
    expect(fxDurationScale('holy-rally')).toBe(1);
  });
  it('gives Shepherd a larger beam while preserving its aspect ratio and other spells', () => {
    const size = fxSize('aura', 246, 504, 'guiding-light');
    expect(size.height).toBe(90);
    expect(size.width / size.height).toBeCloseTo(246 / 504);
    expect(fxSize('aura', 246, 504, 'holy-rally').height).toBe(60);
  });
});
