// Public overworld API, shared by UI, AI and headless consumers.
export * from './types';
export { buildWorldData, rawWorldData, type BuiltWorldData, type RawWorldData } from './data';
export { createWar, startingArmyPlan, issueOrder, queuedOrders, cancelOrder, hashWar, replayWar, type WarSetup } from './engine';
export { resolveTurn, resumeTurn, completeAdmin } from './turn';
export { retreatNode } from './movement';
export { searchOutcome, wildEncounter, applyWildVictory, wildBattleSetup, applyWildResult, wildLeaderFor, WILD_SEARCHER_SIDE, type SearchOutcome, type WildSelection } from './search';
export { leaveAsGarrison, joinDivision, garrisonAt } from './garrison';
export { adoptCaptive } from './adopt';
export { WAR_KEY, loadWar, saveWar, clearWar, validateWar, toSnapshot, fromSnapshot, type LoadedWar, type StorageLike } from './storage';
export { WarSnapshotSchema, type WarSnapshot } from './schema';
