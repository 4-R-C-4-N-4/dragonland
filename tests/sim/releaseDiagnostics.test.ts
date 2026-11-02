import { describe, expect, it } from 'vitest';
import { parseDiagnosticArgs, summarizeBattles, runReleaseDiagnostics } from '../../tools/releaseDiagnostics';
import { getGameData, withConstants } from '../../src/data';

describe('release diagnostic input and aggregation', () => {
  it('uses a repeatable per-hero seed ensemble and explicit field/route settings', () => {
    expect(parseDiagnosticArgs(['--runs-per-hero', '2', '--seed', '17', '--field-width', '1200', '--approach', 'farFlank'])).toEqual({ runsPerHero: 2, seed: 17, fieldWidth: 1200, approach: 'farFlank' });
  });
  it('rejects silently invalid diagnostic inputs', () => {
    for (const args of [['--runs-per-hero', '0'], ['--seed', 'NaN'], ['--approach', 'unknown'], ['--field-width'], ['--bogus', '1']]) expect(() => parseDiagnosticArgs(args)).toThrow();
  });
  it('reports real end reasons and durations, not only a win percentage', () => {
    expect(summarizeBattles([
      { durationS: 10, reason: 'generalDefeated', hadDuel: false },
      { durationS: 180, reason: 'duel', hadDuel: true },
      { durationS: 20, reason: 'generalDefeated', hadDuel: false },
    ], 180)).toEqual({ battles: 3, generalDefeated: 2, duel: 1, timeouts: 1, meanDurationS: 70, minDurationS: 10, maxDurationS: 180 });
  });
  it('reports impossible deployments as blocked campaigns instead of throwing or counting defeats', () => {
    const data = withConstants(getGameData(), { MIN_SQUAD: 61 }); // Starter company has only 60 troops.
    const report = runReleaseDiagnostics(data, { runsPerHero: 1, seed: 701, fieldWidth: 1600, approach: 'default' });
    expect(report.summary.runs).toBe(data.generals.length);
    expect(report.summary.blocked).toBe(data.generals.length);
    expect(report.summary.battles).toBe(0);
    expect(report.campaigns.every((r) => r.blocked?.includes('at least 61') && r.battles.length === 0)).toBe(true);
  });
  it('handles an empty sample without NaN or invented results', () => {
    expect(summarizeBattles([], 180)).toEqual({ battles: 0, generalDefeated: 0, duel: 0, timeouts: 0, meanDurationS: null, minDurationS: null, maxDurationS: null });
  });
});
