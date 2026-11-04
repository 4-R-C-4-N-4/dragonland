import { describe, it, expect } from 'vitest';
import { formatTimer, lerp, pickAnimation } from '../../src/battle/helpers';

describe('formatTimer', () => {
  it('formats mm:ss', () => {
    expect(formatTimer(125)).toBe('2:05');
    expect(formatTimer(5)).toBe('0:05');
    expect(formatTimer(0)).toBe('0:00');
  });
  it('clamps negative to zero', () => {
    expect(formatTimer(-10)).toBe('0:00');
  });
});

describe('lerp', () => {
  it('interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

describe('pickAnimation', () => {
  it('prioritizes death over everything', () => {
    expect(pickAnimation({ alive: false, speed: 10, recentAttack: true, recentHit: true, dying: true })).toBe('death');
    expect(pickAnimation({ alive: false, speed: 0, recentAttack: false, recentHit: false, dying: false })).toBe('death');
  });
  it('shows attack before hit before walk before idle', () => {
    expect(pickAnimation({ alive: true, speed: 5, recentAttack: true, recentHit: true, dying: false })).toBe('attack');
    expect(pickAnimation({ alive: true, speed: 5, recentAttack: false, recentHit: true, dying: false })).toBe('hit');
    expect(pickAnimation({ alive: true, speed: 5, recentAttack: false, recentHit: false, dying: false })).toBe('walk');
    expect(pickAnimation({ alive: true, speed: 0, recentAttack: false, recentHit: false, dying: false })).toBe('idle');
  });
});
