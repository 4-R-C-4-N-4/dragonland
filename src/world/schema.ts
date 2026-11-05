// Persisted war state (MVP3). One versioned snapshot under one key.
// The authored map is NOT persisted: it is rebuilt from data/world.json and the
// snapshot is checked against it, so a content change cannot silently reinterpret a save.
import { z } from 'zod';
import { GeneralIdSchema } from '../data/schemas';
import { ProgressTroopSchema } from '../run/schema';

const Id = z.string().min(1);

export const WorldOrderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('march'), division: Id, toNode: Id }),
  z.object({ type: z.literal('search'), division: Id }),
  z.object({ type: z.literal('rest'), division: Id }),
  z.object({ type: z.literal('hold'), division: Id }),
]);

export const GeneralRecordSchema = z.object({
  id: Id,
  name: z.string().min(1),
  generalId: GeneralIdSchema,
  factionId: Id,
  isHero: z.boolean(),
  level: z.number().int().min(1),
  xp: z.number().finite().nonnegative(),
  hp: z.number().finite().nonnegative(),
  maxHp: z.number().finite().positive(),
  capacity: z.number().int().nonnegative(),
  troops: z.array(ProgressTroopSchema),
  injuredTurns: z.number().int().nonnegative(),
  nodeId: Id,
});

export const DivisionSchema = z.object({
  id: Id,
  factionId: Id,
  generals: z.array(Id),
  atNode: Id,
  previousNode: Id.nullable(),
});

export const PendingBattleSchema = z.object({
  id: Id,
  cause: z.enum(['contact', 'swap', 'assault', 'wild']),
  nodeId: Id,
  attacker: Id,
  defender: Id.nullable(),
  wild: z.array(z.object({ unitId: Id, count: z.number().int().positive() })),
  processedSkirmishIds: z.array(z.string()),
});

export const WarSnapshotSchema = z.object({
  version: z.literal(1),
  id: Id,
  seed: z.number().int(),
  turn: z.number().int().positive(),
  week: z.number().int().positive(),
  phase: z.enum(['orders', 'battle', 'admin', 'won', 'lost']),
  factions: z.array(z.object({
    id: Id,
    name: z.string().min(1),
    isPlayer: z.boolean(),
    personality: z.enum(['aggressive', 'defensive', 'opportunist']),
    gold: z.number().finite(),
    captives: z.array(Id),
    classes: z.array(z.string().min(1)),
  })),
  nodes: z.array(z.object({ id: Id, owner: Id.nullable() })),
  generals: z.array(GeneralRecordSchema),
  divisions: z.array(DivisionSchema),
  pendingBattle: PendingBattleSchema.nullable(),
  turnLog: z.array(z.object({ turn: z.number().int().positive(), orders: z.array(WorldOrderSchema) })),
  internal: z.object({
    rngState: z.number().int().nonnegative(),
    pending: z.array(WorldOrderSchema),
    supply: z.record(Id, z.number().int().nonnegative()),
    paths: z.record(Id, z.array(Id)),
    activeTurn: z.object({
      turn: z.number().int().positive(),
      orders: z.array(WorldOrderSchema),
      starts: z.record(Id, Id),
      resolved: z.array(z.string()),
      ordinal: z.number().int().nonnegative(),
      current: z.string().nullable(),
    }).optional(),
  }),
});

export type WarSnapshot = z.infer<typeof WarSnapshotSchema>;
