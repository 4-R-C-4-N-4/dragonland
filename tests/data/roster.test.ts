import { describe, expect, it } from 'vitest';
import { buildGameData, rawGameData, type UnitDef } from '../../src/data';

const chains = {
  beast: ['raven hawk eagle', 'wyrm drake dragon', 'dog wolf warg'],
  ethereal: ['imp demon devil', 'sprite spirit shepherd', 'cherub angel archangel'],
  human: ['archer ranger deadeye', 'spy rogue assassin', 'soldier knight paladin'],
  mage: ['witch necromancer diabolist', 'adept wizard archmage', 'monk cleric hierophant'],
  construct: ['zombie skeleton servitor', 'golem elemental kyilkhor', 'automata machine anima'],
};
// Snapshot of the 14 pre-MVP2 profiles; new content must not retune them.
const originalUnits: UnitDef[] = [
  {
    "id": "archer",
    "name": "Archer",
    "classId": "human",
    "line": "A",
    "stage": 1,
    "evolvesTo": "ranger",
    "moveSpeed": 45,
    "attackRange": 120,
    "attackCooldownS": 2.4,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "ranger",
    "name": "Ranger",
    "classId": "human",
    "line": "A",
    "stage": 2,
    "evolvesTo": "deadeye",
    "moveSpeed": 48,
    "attackRange": 120,
    "attackCooldownS": 2.3,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "spy",
    "name": "Spy",
    "classId": "human",
    "line": "M",
    "stage": 1,
    "evolvesTo": "rogue",
    "moveSpeed": 60,
    "attackRange": 24,
    "attackCooldownS": 1.0,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "rogue",
    "name": "Rogue",
    "classId": "human",
    "line": "M",
    "stage": 2,
    "evolvesTo": "assassin",
    "moveSpeed": 64,
    "attackRange": 24,
    "attackCooldownS": 0.95,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "soldier",
    "name": "Soldier",
    "classId": "human",
    "line": "Z",
    "stage": 1,
    "evolvesTo": "knight",
    "moveSpeed": 50,
    "attackRange": 24,
    "attackCooldownS": 1.2,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "knight",
    "name": "Knight",
    "classId": "human",
    "line": "Z",
    "stage": 2,
    "evolvesTo": "paladin",
    "moveSpeed": 52,
    "attackRange": 24,
    "attackCooldownS": 1.15,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "raven",
    "name": "Raven",
    "classId": "beast",
    "line": "A",
    "stage": 1,
    "evolvesTo": "hawk",
    "moveSpeed": 85,
    "attackRange": 24,
    "attackCooldownS": 0.9,
    "flying": true,
    "bodyRadius": 5
  },
  {
    "id": "hawk",
    "name": "Hawk",
    "classId": "beast",
    "line": "A",
    "stage": 2,
    "evolvesTo": "eagle",
    "moveSpeed": 90,
    "attackRange": 24,
    "attackCooldownS": 0.85,
    "flying": true,
    "bodyRadius": 5
  },
  {
    "id": "wyrm",
    "name": "Wyrm",
    "classId": "beast",
    "line": "M",
    "stage": 1,
    "evolvesTo": "drake",
    "moveSpeed": 50,
    "attackRange": 24,
    "attackCooldownS": 1.2,
    "flying": false,
    "bodyRadius": 8
  },
  {
    "id": "drake",
    "name": "Drake",
    "classId": "beast",
    "line": "M",
    "stage": 2,
    "evolvesTo": "dragon",
    "moveSpeed": 52,
    "attackRange": 24,
    "attackCooldownS": 1.15,
    "flying": false,
    "bodyRadius": 8
  },
  {
    "id": "dog",
    "name": "Dog",
    "classId": "beast",
    "line": "Z",
    "stage": 1,
    "evolvesTo": "wolf",
    "moveSpeed": 55,
    "attackRange": 24,
    "attackCooldownS": 1.0,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "wolf",
    "name": "Wolf",
    "classId": "beast",
    "line": "Z",
    "stage": 2,
    "evolvesTo": "warg",
    "moveSpeed": 58,
    "attackRange": 24,
    "attackCooldownS": 0.95,
    "flying": false,
    "bodyRadius": 6
  },
  {
    "id": "paladin",
    "name": "Paladin",
    "classId": "human",
    "line": "Z",
    "stage": 3,
    "moveSpeed": 40,
    "attackRange": 32,
    "attackCooldownS": 1.0,
    "flying": false,
    "bodyRadius": 12
  },
  {
    "id": "dragon",
    "name": "Dragon",
    "classId": "beast",
    "line": "M",
    "stage": 3,
    "moveSpeed": 40,
    "attackRange": 40,
    "attackCooldownS": 1.0,
    "flying": false,
    "bodyRadius": 14
  }
];
function changedUnits(change: (units: UnitDef[]) => void) {
  const units = structuredClone(rawGameData.units) as UnitDef[];
  change(units);
  return () => buildGameData({ ...rawGameData, units });
}

describe('MVP2 roster', () => {
  it('contains exactly 45 lowercase species in the 15 design chains', () => {
    const data = buildGameData(rawGameData);
    expect(data.units).toHaveLength(45);
    expect(data.unitById.size).toBe(45);
    for (const [classId, lines] of Object.entries(chains)) {
      lines.forEach((chain, lineIndex) => {
        const ids = chain.split(' ');
        ids.forEach((id, index) => {
          const unit = data.unitById.get(id)!;
          expect(unit).toMatchObject({ id, name: id.charAt(0).toUpperCase() + id.slice(1), classId, line: ['A', 'M', 'Z'][lineIndex], stage: index + 1 });
          expect(unit.evolvesTo).toBe(ids[index + 1]);
        });
      });
    }
  });
  it('preserves all 14 existing profiles', () => {
    const data = buildGameData(rawGameData);
    for (const unit of originalUnits) expect(data.unitById.get(unit.id)).toEqual(unit);
  });
  it('uses positive simple profiles and the specified ranged/flying identities', () => {
    const data = buildGameData(rawGameData);
    for (const unit of data.units) {
      for (const value of [unit.moveSpeed, unit.attackRange, unit.attackCooldownS, unit.bodyRadius]) expect(value).toBeGreaterThan(0);
      const ranged = (unit.line === 'A' && !['beast', 'construct'].includes(unit.classId)) || (unit.classId === 'mage' && unit.line === 'M');
      expect(unit.attackRange > data.constants.RANGED_THRESHOLD).toBe(ranged);
      expect(unit.flying).toBe(unit.classId === 'ethereal' || (unit.classId === 'beast' && unit.line === 'A'));
    }
  });
  it('allows every stage-3 species as an ordinary AI troop', () => {
    const data = buildGameData(rawGameData);
    for (const unit of data.units.filter((u) => u.stage === 3)) {
      const aiLoadouts = structuredClone(data.aiLoadouts);
      aiLoadouts[0]!.squads[0]!.units[0]!.unitId = unit.id;
      expect(() => buildGameData({ ...rawGameData, aiLoadouts })).not.toThrow();
    }
  });
  it('rejects missing evolution targets', () => {
    expect(changedUnits((u) => { u[0]!.evolvesTo = 'missing'; })).toThrow(/unknown evolution target/);
  });
  it('rejects evolution that skips a stage', () => {
    expect(changedUnits((u) => { u[0]!.evolvesTo = 'paladin'; })).toThrow(/stage/);
  });
  it('rejects evolution across classes', () => {
    expect(changedUnits((u) => { u[0]!.evolvesTo = 'hawk'; })).toThrow(/same class/);
  });
  it('rejects evolution across lines', () => {
    expect(changedUnits((u) => { u[0]!.evolvesTo = 'rogue'; })).toThrow(/same line/);
  });
  it('rejects duplicate species IDs', () => {
    expect(changedUnits((u) => { u.push({ ...u[0]! }); })).toThrow(/duplicate unit id/);
  });
  it('rejects chains ending before stage 3', () => {
    expect(changedUnits((u) => { delete u[0]!.evolvesTo; })).toThrow(/must evolve/);
  });
  it('rejects evolution from stage 3, including cycles', () => {
    expect(changedUnits((u) => { u.find((v) => v.id === 'paladin')!.evolvesTo = 'soldier'; })).toThrow(/stage 3.*terminate/);
  });
});
