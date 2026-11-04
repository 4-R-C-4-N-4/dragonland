import { describe, expect, it } from 'vitest';
import { getGameData, withConstants } from '../../src/data';
import { balanceSide, matchups, specialFamilies, runMatch } from '../../tools/specialBalance';

const data = getGameData();
describe('special peer balance fixtures', () => {
  it('covers all fifteen specials exactly once by peer family', () => {
    const ids = Object.values(specialFamilies).flat();
    expect(new Set(ids).size).toBe(15);
    expect(ids.slice().sort()).toEqual(data.generals.map(g => g.id).sort());
  });
  it('normalizes heroes and identical mixed armies without replacing the selected special', () => {
    const a = balanceSide(data, 'shepherd', 0, false);
    const b = balanceSide(data, 'dragon', 1, false);
    expect(a.generalId).toBe(b.generalId);
    expect(a.general!.unitId).toBe(b.general!.unitId);
    expect(data.unitById.get(a.general!.unitId)!.line).toBe('M');
    expect(balanceSide(data, 'shepherd', 0, true).generalId).toBe('shepherd');
    expect(a.general!.special.id).toBe('guiding-light');
    expect(b.general!.special.id).toBe('dragon-breath');
    const troops = a.squads.flatMap(s => s.troops);
    expect(troops).toHaveLength(60);
    expect(troops.map(t => t.unitId)).toEqual(b.squads.flatMap(s => s.troops).map(t => t.unitId));
    expect(new Set(troops.map(t => data.unitById.get(t.unitId)!.classId)).size).toBe(5);
    expect(new Set(troops.map(t => data.unitById.get(t.unitId)!.line)).size).toBe(3);
  });
  it('swaps every asymmetric matchup and includes each mirror only once', () => {
    const pairs = matchups(['paladin', 'shepherd'], 'all');
    expect(pairs).toEqual([['paladin','paladin'], ['paladin','shepherd'], ['shepherd','paladin'], ['shepherd','shepherd']]);
  });
  it('includes duel time in combat duration and continuing cast timestamps', () => {
    const r = runMatch(withConstants(data, { SKIRMISH_TIME_S: 1 }), 'paladin', 'shepherd', 701, false);
    expect(r.hadDuel).toBe(true);
    expect(r.durationS).toBeGreaterThan(10);
    expect(r.firstCastS[0]).toBeGreaterThan(1);
  });
  it('fails loudly rather than reporting an unfinished battle as a loss', () => {
    expect(() => runMatch(data, 'paladin', 'shepherd', 701, false, 1)).toThrow('unfinished');
  });
});
