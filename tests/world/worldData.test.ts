import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ClassId, GeneralId, WorldData } from '../../src/data/schemas';
import { WorldConstantsSchema, WorldDataSchema } from '../../src/data/schemas';
import worldConstantsJson from '../../data/world-constants.json';
import worldJson from '../../data/world.json';
import unitsJson from '../../data/units.json';
import { buildWorldData, rawWorldData } from '../../src/world/data';
import type { ProgressTroop } from '../../src/progression';
import type {
  BattleCause, Biome, Division, Faction, GeneralRecord, NodeKind,
  PendingBattle, RecordedWorldTurn, War, WarAction, WorldNode, WorldOrder,
} from '../../src/world/types';

describe('world type contract', () => {
  it('describes nodes, generals and divisions', () => {
    expectTypeOf<NodeKind>().toEqualTypeOf<'castle' | 'town' | 'village' | 'lair'>();
    expectTypeOf<Biome>().toEqualTypeOf<'plains' | 'forest' | 'mountain' | 'swamp' | 'ruins' | 'settled'>();
    expectTypeOf<WorldNode>().toEqualTypeOf<{
      id: string; kind: NodeKind; biome: Biome; name: string; x: number; y: number;
      owner: string | null; supplyPerWeek: number; incomePerTurn: number; garrisonCap: number;
    }>();
    expectTypeOf<GeneralRecord>().toEqualTypeOf<{
      id: string; name: string; generalId: GeneralId; factionId: string; isHero: boolean;
      level: number; xp: number; hp: number; maxHp: number; capacity: number;
      troops: ProgressTroop[]; injuredTurns: number; nodeId: string; mp?: number;
    }>();
    expectTypeOf<Division>().toEqualTypeOf<{
      id: string; factionId: string; generals: string[]; muster?: number; atNode: string; previousNode: string | null;
    }>();
    expectTypeOf<Faction['classes']>().toEqualTypeOf<ClassId[]>();
  });

  it('describes turn orders, battle encounters and replay history', () => {
    expectTypeOf<WorldOrder>().toEqualTypeOf<
      | { type: 'march'; division: string; toNode: string }
      | { type: 'search'; division: string }
      | { type: 'rest'; division: string }
      | { type: 'hold'; division: string }
    >();
    expectTypeOf<BattleCause>().toEqualTypeOf<'contact' | 'swap' | 'assault' | 'wild'>();
    expectTypeOf<PendingBattle>().toEqualTypeOf<{
      id: string; cause: BattleCause; nodeId: string; attacker: string; defender: string | null;
      wild: { unitId: string; count: number }[]; processedSkirmishIds: string[];
    }>();
    expectTypeOf<RecordedWorldTurn>().toEqualTypeOf<{ turn: number; orders: WorldOrder[]; actions?: WarAction[] }>();
    expectTypeOf<War['version']>().toEqualTypeOf<1>();
    expectTypeOf<War['turnLog']>().toEqualTypeOf<RecordedWorldTurn[]>();
    expectTypeOf<War['_internal']>().toEqualTypeOf<unknown>();
  });
});

describe('buildWorldData', () => {
  it('collects cross-reference failures into one readable error', () => {
    const world = structuredClone(worldJson);
    world.nodes[1]!.owner = 'unknown-owner';
    world.nodes[1]!.garrisonCap = 1;
    world.routes[0]!.from = 'unknown-endpoint';
    world.routes.push(structuredClone(world.routes[1]!));
    world.nodes.push(structuredClone(world.nodes[2]!));
    world.factions.push(structuredClone(world.factions[1]!));
    world.nodes[0]!.owner = null;
    world.routes = world.routes.filter(route => route.from !== 'mirehollow' && route.to !== 'mirehollow');
    world.biomes.plains[0]!.unitId = 'unknown-unit';
    world.biomes.forest[0]!.unitId = 'ranger';
    world.biomes.swamp = [];
    let message = '';
    try { buildWorldData({ ...rawWorldData, world }); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^Invalid world data:\n  /);
    for (const detail of [
      'westmere', 'unknown-owner', 'garrisonCap', 'dawn-west', 'unknown-endpoint',
      'duplicate route id west-green', 'duplicate node id greenfield', 'duplicate faction id invader',
      'faction player', 'starting castle', 'disconnected nodes: mirehollow',
      'biome plains: unknown species unknown-unit', 'biome forest: species ranger must be stage 1',
      'biome swamp: empty wild table',
    ]) expect(message).toContain(detail);
  });
  it.each(['plains', 'forest', 'mountain', 'swamp', 'ruins'] as const)('rejects missing wild biome table %s', biome => {
    const world: WorldData = WorldDataSchema.parse(worldJson);
    delete world.biomes[biome];
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(new RegExp(`biome ${biome}.*missing`));
  });
  it.each(['plains', 'forest', 'mountain', 'swamp', 'ruins'] as const)('rejects empty wild biome table %s', biome => {
    const world = structuredClone(worldJson);
    world.biomes[biome] = [];
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(new RegExp(`biome ${biome}.*empty`));
  });
  it.each([2, 3])('rejects stage-%s species in biome tables', stage => {
    const world = structuredClone(worldJson);
    const species = unitsJson.find(unit => unit.stage === stage)!.id;
    world.biomes.forest[0]!.unitId = species;
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(new RegExp(`biome forest.*${species}.*stage 1`));
  });
  it('names unknown species in biome tables', () => {
    const world = structuredClone(worldJson);
    world.biomes.plains[0]!.unitId = 'missing-species';
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/biome plains.*unknown.*missing-species/);
  });
  it('rejects garrison capacity on a non-castle and names the node', () => {
    const world = structuredClone(worldJson);
    world.nodes[1]!.garrisonCap = 1;
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/westmere.*garrisonCap.*non-castle/);
  });
  it('rejects an empty map', () => {
    const world = { ...structuredClone(worldJson), nodes: [], routes: [], factions: [] };
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/empty.*map/);
  });
  it('names disconnected nodes', () => {
    const world = structuredClone(worldJson);
    world.routes = world.routes.filter(route => route.from !== 'mirehollow' && route.to !== 'mirehollow');
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/disconnected.*mirehollow/);
  });
  it('rejects multiple starting castles for a faction', () => {
    const world = structuredClone(worldJson);
    world.nodes[1]!.kind = 'castle';
    world.nodes[1]!.garrisonCap = 7;
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/faction player.*dawnkeep.*westmere/);
  });
  it('requires a starting castle for every faction', () => {
    const world = structuredClone(worldJson);
    world.nodes[0]!.owner = null;
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/faction player.*starting castle/);
  });
  it('names nodes and their unknown owning faction', () => {
    const world = structuredClone(worldJson);
    world.nodes[0]!.owner = 'missing-faction';
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/dawnkeep.*missing-faction/);
  });
  it.each(['nodes', 'routes', 'factions'] as const)('rejects duplicate ids in %s', category => {
    const world = structuredClone(worldJson);
    const first = world[category][0]!;
    // Clone the complete record so the only introduced defect is its duplicate id.
    (world[category] as { id: string }[]).push(structuredClone(first));
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(new RegExp(`duplicate.*${first.id}`));
  });
  it('names unknown route endpoints in either direction', () => {
    const world = structuredClone(worldJson);
    world.routes[0]!.from = 'missing-from';
    world.routes[0]!.to = 'missing-to';
    expect(() => buildWorldData({ ...rawWorldData, world })).toThrow(/dawn-west.*missing-from[\s\S]*dawn-west.*missing-to/);
  });
  it('validates authored data and builds symmetric adjacency and id lookups', () => {
    const data = buildWorldData(rawWorldData);
    expect(data.nodes).toEqual(worldJson.nodes);
    expect(data.constants).toEqual(worldConstantsJson);
    for (const node of data.nodes) expect(data.nodeById.get(node.id)).toBe(node);
    for (const faction of data.factions) expect(data.factionById.get(faction.id)).toBe(faction);
    for (const route of data.routes) {
      expect(data.routeById.get(route.id)).toBe(route);
      expect(data.neighbours.get(route.from)).toContain(route.to);
      expect(data.neighbours.get(route.to)).toContain(route.from);
    }
  });
});

describe('world constants', () => {
  it('keeps the rival opening field inside the rival roster and one division', () => {
    const field = (aggressive: number) => ({ ...worldConstantsJson, RIVAL_OPENING_FIELD: { ...worldConstantsJson.RIVAL_OPENING_FIELD, aggressive } });
    expect(WorldConstantsSchema.safeParse(field(5)).success).toBe(true);
    expect(WorldConstantsSchema.safeParse(field(6)).success).toBe(false);
    expect(WorldConstantsSchema.safeParse({ ...field(5), RIVAL_GENERALS: 4 }).success).toBe(false);
    expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, ADOPTED_HP_FRAC: 0 }).success).toBe(false);
  });
  it('requires the garrison capacity to exceed division capacity', () => {
    for (const GARRISON_CAP of [4, 5]) {
      expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, GARRISON_CAP }).success).toBe(false);
    }
    expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, GARRISON_CAP: 8 }).success).toBe(true);
  });
  it('rejects defeat weights that do not sum to one', () => {
    expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, CAPTURE_WEIGHT: 0.5 }).success).toBe(false);
    expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, CAPTURE_WEIGHT: 0.1, INJURE_WEIGHT: 0.2, KILL_WEIGHT: 0.7 }).success).toBe(true);
  });
  it('rejects invalid numeric ranges while allowing tuning', () => {
    const positiveIntegers = ['TURNS_PER_WEEK', 'GARRISON_CAP', 'MAX_DIVISION_GENERALS', 'STARTING_CAPACITY', 'PLAYER_STARTING_CAPACITY', 'RIVAL_GENERALS'] as const;
    const nonnegativeIntegers = ['RESUPPLY_TROOPS_PER_REST', 'INJURY_TURNS', 'STARTING_GOLD'] as const;
    const fractions = ['HEAL_HP_PER_REST_FRAC', 'CAPTURE_WEIGHT', 'INJURE_WEIGHT', 'KILL_WEIGHT', 'SEARCH_CHANCE_LAIR', 'SEARCH_CHANCE_WILD'] as const;
    for (const key of positiveIntegers) {
      for (const value of [0, -1, 1.5]) expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, [key]: value }).success, `${key}=${value}`).toBe(false);
    }
    for (const key of nonnegativeIntegers) {
      for (const value of [-1, 1.5]) expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, [key]: value }).success, `${key}=${value}`).toBe(false);
    }
    for (const key of fractions) {
      for (const value of [-0.1, 1.1]) expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, [key]: value }).success, `${key}=${value}`).toBe(false);
    }
    expect(WorldConstantsSchema.safeParse({ ...worldConstantsJson, TURNS_PER_WEEK: 10, SEARCH_CHANCE_WILD: 0.4 }).success).toBe(true);
  });
  it('ships valid tuning with legal opening troop capacity and defender advantage', () => {
    const constants = WorldConstantsSchema.parse(worldConstantsJson);
    expect(constants).toEqual({
      TURNS_PER_WEEK: 7, HEAL_HP_PER_REST_FRAC: 0.25, RESUPPLY_TROOPS_PER_REST: 60,
      CAPTURE_WEIGHT: 0.6, INJURE_WEIGHT: 0.3, KILL_WEIGHT: 0.1, GARRISON_CAP: 7,
      MAX_DIVISION_GENERALS: 5, SEARCH_CHANCE_LAIR: 0.5, SEARCH_CHANCE_WILD: 0.2,
      INJURY_TURNS: 3, STARTING_GOLD: 100, STARTING_CAPACITY: 50, PLAYER_STARTING_CAPACITY: 100, PLAYER_STARTING_TROOPS_PER_LINE: 25,
      RIVAL_GENERALS: 6, RIVAL_OPENING_FIELD: { aggressive: 2, opportunist: 2, defensive: 1 },
      RIVAL_OPENING_DIVISION_SIZE: 1, LOSE_WITHOUT_CASTLES: false, ADOPTED_HP_FRAC: 0.25,
    });
    expect(constants.CAPTURE_WEIGHT + constants.INJURE_WEIGHT + constants.KILL_WEIGHT).toBeCloseTo(1);
    expect(Number.isInteger(constants.TURNS_PER_WEEK) && constants.TURNS_PER_WEEK > 0).toBe(true);
    expect(Number.isInteger(constants.MAX_DIVISION_GENERALS) && constants.MAX_DIVISION_GENERALS > 0).toBe(true);
    expect(constants.GARRISON_CAP).toBeGreaterThan(constants.MAX_DIVISION_GENERALS);
  });
});

describe('world data schema', () => {
  it('accepts a minimal valid map', () => {
    const parsed = WorldDataSchema.parse({
      nodes: [{ id: 'a', kind: 'castle', biome: 'settled', name: 'A', x: 0, y: 0, owner: 'player', supplyPerWeek: 20, incomePerTurn: 0, garrisonCap: 7 }],
      routes: [],
      factions: [{ id: 'player', name: 'You', isPlayer: true, personality: 'aggressive', classes: ['human'] }],
      biomes: { settled: [] },
    });
    expect(parsed.nodes[0]!.garrisonCap).toBe(7);
  });

  it('ships a connected starter map with one castle per faction and two fronts', () => {
    const world = WorldDataSchema.parse(worldJson);
    expect(world.nodes).toHaveLength(12);
    expect(world.factions.map(f => f.id).sort()).toEqual(['invader', 'player']);
    for (const faction of world.factions) {
      expect(world.nodes.filter(n => n.owner === faction.id && n.kind === 'castle')).toHaveLength(1);
    }
    const castles = world.nodes.filter(n => n.kind === 'castle');
    expect(castles).toHaveLength(2);
    expect(castles.every(n => n.garrisonCap === 7 && n.supplyPerWeek === 60 && n.biome === 'settled')).toBe(true);
    expect(Math.abs(castles[0]!.x - castles[1]!.x)).toBeGreaterThanOrEqual(800);
    const towns = world.nodes.filter(n => n.kind === 'town');
    expect(towns).toHaveLength(3);
    expect(towns.every(n => n.supplyPerWeek === 30 && n.incomePerTurn === 2 && n.biome === 'settled')).toBe(true);
    const villages = world.nodes.filter(n => n.kind === 'village');
    expect(villages).toHaveLength(5);
    expect(villages.every(n => n.incomePerTurn === 3 && n.supplyPerWeek === 0)).toBe(true);
    expect(new Set(villages.map(n => n.biome)).size).toBeGreaterThan(1);
    const lairs = world.nodes.filter(n => n.kind === 'lair');
    expect(lairs.map(n => n.biome).sort()).toEqual(['mountain', 'swamp']);
    expect(lairs.every(n => n.supplyPerWeek === 0 && n.incomePerTurn === 0)).toBe(true);
    expect(world.nodes.filter(n => n.kind !== 'castle').every(n => n.garrisonCap === 0)).toBe(true);
    const ids = new Set(world.nodes.map(n => n.id));
    for (const route of world.routes) {
      expect(ids.has(route.from)).toBe(true);
      expect(ids.has(route.to)).toBe(true);
    }
    const reachable = (omittedRoute?: string) => {
      const seen = new Set([castles[0]!.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const route of world.routes) {
          if (route.id === omittedRoute) continue;
          if (seen.has(route.from) && !seen.has(route.to)) { seen.add(route.to); changed = true; }
          if (seen.has(route.to) && !seen.has(route.from)) { seen.add(route.from); changed = true; }
        }
      }
      return seen;
    };
    expect(reachable().size).toBe(world.nodes.length);
    for (const route of world.routes) expect(reachable(route.id).has(castles[1]!.id)).toBe(true);
    expect(world.biomes.settled).toEqual([]);
    const stageOneIds = new Set(unitsJson.filter(unit => unit.stage === 1).map(unit => unit.id));
    for (const biome of ['plains', 'forest', 'mountain', 'swamp', 'ruins'] as const) {
      const table = world.biomes[biome]!;
      expect(table.length).toBeGreaterThanOrEqual(2);
      expect(table.length).toBeLessThanOrEqual(3);
      for (const entry of table) expect(stageOneIds.has(entry.unitId)).toBe(true);
    }
  });

  it('rejects an unknown node kind, an unknown biome and a self route', () => {
    const base = { routes: [], factions: [{ id: 'p', name: 'P', isPlayer: true, personality: 'aggressive', classes: ['human'] }], biomes: {} };
    const node = { id: 'a', kind: 'castle', biome: 'settled', name: 'A', x: 0, y: 0, owner: null, supplyPerWeek: 0, incomePerTurn: 0, garrisonCap: 0 };
    expect(WorldDataSchema.safeParse({ ...base, nodes: [{ ...node, kind: 'fortress' }] }).success).toBe(false);
    expect(WorldDataSchema.safeParse({ ...base, nodes: [{ ...node, biome: 'lava' }] }).success).toBe(false);
    expect(WorldDataSchema.safeParse({ ...base, nodes: [node], routes: [{ id: 'r', from: 'a', to: 'a' }] }).success).toBe(false);
  });
});
