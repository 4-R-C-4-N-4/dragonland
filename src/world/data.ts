// Validated authored world data. Pure: shared by the sim and headless consumers.
import worldJson from '../../data/world.json';
import constantsJson from '../../data/world-constants.json';
import { getGameData, type GameData } from '../data';
import { WorldConstantsSchema, WorldDataSchema, type WorldConstants, type WorldData } from '../data/schemas';

export interface RawWorldData {
  world: unknown;
  constants: unknown;
}

export interface BuiltWorldData extends WorldData {
  constants: WorldConstants;
  nodeById: Map<string, WorldData['nodes'][number]>;
  routeById: Map<string, WorldData['routes'][number]>;
  factionById: Map<string, WorldData['factions'][number]>;
  neighbours: Map<string, string[]>;
}

export const rawWorldData: RawWorldData = { world: worldJson, constants: constantsJson };

/** Parse authored JSON and collect cross-reference errors into one readable message. */
export function buildWorldData(raw: RawWorldData, gameData: Pick<GameData, 'unitById'> = getGameData()): BuiltWorldData {
  const world = WorldDataSchema.parse(raw.world);
  const constants = WorldConstantsSchema.parse(raw.constants);
  const nodeById = new Map(world.nodes.map(node => [node.id, node]));
  const routeById = new Map(world.routes.map(route => [route.id, route]));
  const factionById = new Map(world.factions.map(faction => [faction.id, faction]));
  const neighbours = new Map(world.nodes.map(node => [node.id, [] as string[]]));
  const errors: string[] = [];
  for (const biome of ['plains', 'forest', 'mountain', 'swamp', 'ruins'] as const) {
    if (world.biomes[biome] === undefined) errors.push(`biome ${biome}: missing wild table`);
    if (world.biomes[biome]?.length === 0) errors.push(`biome ${biome}: empty wild table`);
  }
  for (const [biome, entries] of Object.entries(world.biomes)) {
    for (const entry of entries) {
      const unit = gameData.unitById.get(entry.unitId);
      if (!unit) errors.push(`biome ${biome}: unknown species ${entry.unitId}`);
      else if (unit.stage !== 1) errors.push(`biome ${biome}: species ${entry.unitId} must be stage 1`);
    }
  }
  for (const faction of world.factions) {
    const castles = world.nodes.filter(node => node.kind === 'castle' && node.owner === faction.id);
    if (castles.length === 0) errors.push(`faction ${faction.id}: no starting castle`);
    if (castles.length > 1) errors.push(`faction ${faction.id}: multiple starting castles ${castles.map(node => node.id).join(', ')}`);
  }
  for (const node of world.nodes) {
    if (node.owner !== null && !factionById.has(node.owner)) errors.push(`node ${node.id}: unknown owner faction ${node.owner}`);
    if (node.kind !== 'castle' && node.garrisonCap > 0) errors.push(`node ${node.id}: garrisonCap must be 0 on a non-castle`);
  }
  for (const [category, records] of [['node', world.nodes], ['route', world.routes], ['faction', world.factions]] as const) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) errors.push(`duplicate ${category} id ${record.id}`);
      seen.add(record.id);
    }
  }
  for (const route of world.routes) {
    if (!nodeById.has(route.from)) errors.push(`route ${route.id}: unknown endpoint ${route.from}`);
    if (!nodeById.has(route.to)) errors.push(`route ${route.id}: unknown endpoint ${route.to}`);
    neighbours.get(route.from)?.push(route.to);
    neighbours.get(route.to)?.push(route.from);
  }
  const first = world.nodes[0];
  if (!first) errors.push('empty world map: no nodes');
  if (first) {
    const seen = new Set([first.id]);
    const queue = [first.id];
    for (let index = 0; index < queue.length; index++) {
      for (const neighbour of neighbours.get(queue[index]!) ?? []) {
        if (nodeById.has(neighbour) && !seen.has(neighbour)) {
          seen.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    const disconnected = world.nodes.filter(node => !seen.has(node.id));
    if (disconnected.length) errors.push(`disconnected nodes: ${disconnected.map(node => node.id).join(', ')}`);
  }
  if (errors.length) throw new Error(`Invalid world data:\n  ${errors.join('\n  ')}`);
  return { ...world, constants, nodeById, routeById, factionById, neighbours };
}
