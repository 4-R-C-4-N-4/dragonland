import { describe, expect, it } from 'vitest';
import { getRunConfig, RunConfigSchema } from '../../src/run/config';

describe('run tuning', () => {
  it('provides a short finite run with scarce rewards and all five starting classes', () => {
    const cfg = getRunConfig();
    expect(cfg.battles).toBe(8);
    expect(cfg.startingTroopsPerLine * 3).toBe(60);
    expect(cfg.recruitOfferCount).toBe(3);
    expect(cfg.recruitsPerOffer).toBe(12);
    expect(cfg.rosterCap).toBeGreaterThanOrEqual(100);
    expect(cfg.startingClasses).toHaveLength(5);
  });
  it('rejects unusable capacity and empty encounter progression', () => {
    const cfg = getRunConfig();
    expect(() => RunConfigSchema.parse({ ...cfg, battles: 0 })).toThrow();
    expect(() => RunConfigSchema.parse({ ...cfg, rosterCap: 20 })).toThrow();
    expect(() => RunConfigSchema.parse({ ...cfg, recruitsPerOffer: -1 })).toThrow();
  });
});
