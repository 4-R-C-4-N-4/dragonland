import { describe, expect, it } from 'vitest';
import { parseDiagnosticArgs, summarizeBattles } from '../../tools/releaseDiagnostics';

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
  it('handles an empty sample without NaN or invented results', () => {
    expect(summarizeBattles([], 180)).toEqual({ battles: 0, generalDefeated: 0, duel: 0, timeouts: 0, meanDurationS: null, minDurationS: null, maxDurationS: null });
  });
});
