// Turn a general's company into legal battle squads. Battles hold at most MAX_SQUADS squads per
// side (one per formation slot); a squad per species overflowed the slots, stacked squads on top
// of each other and gave side 0 a large edge in mirror fights.
import { getGameData } from '../data';
import { deriveTroopStats, type ProgressTroop } from '../progression';
import type { SquadSetup } from '../sim';

interface Group { unitId: string; line: string; troops: ProgressTroop[] }

/**
 * Deterministic and independent of input order. Each species stays in one squad; with more
 * species than slots, extra species join the smallest squad of the same line (else the smallest
 * squad). Squads under MIN_SQUAD are folded into another squad when one exists.
 */
export function companySquads(company: readonly ProgressTroop[], idPrefix: string): SquadSetup[] {
  const game = getGameData();
  const { MAX_SQUADS, MIN_SQUAD } = game.constants;
  const unit = (id: string) => { const u = game.unitById.get(id); if (!u) throw new Error(`Unknown unit ${id}`); return u; };
  const byUnit = new Map<string, ProgressTroop[]>();
  for (const t of company) (byUnit.get(t.unitId) ?? byUnit.set(t.unitId, []).get(t.unitId)!).push(t);
  const groups: Group[] = [...byUnit].map(([unitId, troops]) => ({ unitId, line: unit(unitId).line, troops: [...troops].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => b.troops.length - a.troops.length || a.line.localeCompare(b.line) || a.unitId.localeCompare(b.unitId));

  const squads: Group[][] = [];
  const size = (s: Group[]) => s.reduce((n, g) => n + g.troops.length, 0);
  const smallest = (pool: Group[][]) => pool.reduce((best, s) => (size(s) < size(best) ? s : best), pool[0]!);
  for (const group of groups) {
    if (squads.length < MAX_SQUADS) { squads.push([group]); continue; }
    const sameLine = squads.filter(s => s[0]!.line === group.line);
    smallest(sameLine.length ? sameLine : squads).push(group);
  }
  // Fold undersized squads (smallest first) into the next smallest squad.
  for (;;) {
    if (squads.length < 2) break;
    const small = [...squads].reverse().find(s => size(s) < MIN_SQUAD);
    if (!small) break;
    squads.splice(squads.indexOf(small), 1);
    smallest(squads).push(...small);
  }

  return squads.map((members, index) => {
    const lead = unit(members[0]!.unitId).name;
    return {
      id: `${idPrefix}-squad${index}`,
      name: members.length === 1 ? lead : `${lead} +${members.length - 1}`,
      disposition: 'mixed' as const,
      troops: members.flatMap(g => g.troops).map(t => ({ troopId: t.id, name: t.name, unitId: t.unitId, statMult: deriveTroopStats(unit(t.unitId), t.level).damageMultiplier })),
    };
  });
}
