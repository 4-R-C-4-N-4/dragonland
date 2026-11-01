import { describe, expect, it } from 'vitest';
import { stepAnim, type AnimTrack } from '../../src/battle/helpers';

const base = { dtMs: 16, speedFrac: 0, attacked: false, hit: false, attackMs: 360, hitMs: 440 };

describe('sheet animation state machine', () => {
  it('plays attack to completion even when moving', () => {
    let t: AnimTrack = { anim: 'walk', lockMs: 0 };
    t = stepAnim(t, { ...base, attacked: true, speedFrac: 1 }).track;
    for (let ms = 0; ms < 300; ms += 16) t = stepAnim(t, { ...base, speedFrac: 1 }).track;
    expect(t.anim).toBe('attack');
    for (let ms = 0; ms < 100; ms += 16) t = stepAnim(t, { ...base, speedFrac: 1 }).track;
    expect(t.anim).toBe('walk');
  });

  it('a hit does not interrupt an attack, and repeated hits do not restart the hit', () => {
    let r = stepAnim({ anim: 'idle', lockMs: 0 }, { ...base, attacked: true });
    r = stepAnim(r.track, { ...base, hit: true });
    expect(r.track.anim).toBe('attack');
    r = stepAnim({ anim: 'idle', lockMs: 0 }, { ...base, hit: true });
    expect(r.restart).toBe(true);
    r = stepAnim(r.track, { ...base, hit: true });
    expect(r.restart).toBe(false);
  });

  it('walk/idle use hysteresis and never restart the same loop', () => {
    let r = stepAnim({ anim: 'idle', lockMs: 0 }, { ...base, speedFrac: 0.2 });
    expect(r.track.anim).toBe('idle');
    r = stepAnim(r.track, { ...base, speedFrac: 0.5 });
    expect(r.track.anim).toBe('walk');
    expect(r.restart).toBe(true);
    r = stepAnim(r.track, { ...base, speedFrac: 0.2 }); // jostle: still walking
    expect(r.track.anim).toBe('walk');
    expect(r.restart).toBe(false);
    r = stepAnim(r.track, { ...base, speedFrac: 0.05 });
    expect(r.track.anim).toBe('idle');
  });

  it('walk playback rate follows speed, clamped', () => {
    expect(stepAnim({ anim: 'walk', lockMs: 0 }, { ...base, speedFrac: 0.4 }).rate).toBe(0.6);
    expect(stepAnim({ anim: 'walk', lockMs: 0 }, { ...base, speedFrac: 3 }).rate).toBe(1.4);
  });
});
