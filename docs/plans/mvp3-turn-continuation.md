# MVP3 interrupted-turn continuation slice

Baseline after sequencing: 295587a, 597 tests. Headless only; integrate mvp3, never main automatically.

Goal: finish the SAME strategic turn after one or more encounters, without losing the orders, repeating movement/rest/income, or letting new orders sneak into an interrupted turn. This is not yet battle-result replay or persistence/UI.

Owned: src/world/turn.ts, rng.ts, encounter.ts, engine.ts (internal initialization/order guard only), index.ts exports, tests/world/turnContinuation.test.ts. Existing tests may change only for intentionally corrected capture timing.

Introduce a typed serializable active-turn frame in WorldInternal: original turn, canonical committed orders, original starting positions, resolved-encounter ordinal/identity bookkeeping. resolveTurn commits this frame and moves once. If contact occurs, suspend before rest/upkeep/income/log/turn increment. Capture must not precede contested encounter resolution (including swaps).

Export resumeTurn(war): only works after a sequence clears pendingBattle while phase remains battle. It discovers remaining simultaneous encounters from the same frame, preserving unique deterministic encounter/skirmish ids even for multiple encounters at the same node. Once no encounter remains, apply original node actions and upkeep once, append exactly one turnLog record, clear frame/pending orders, increment turn exactly once and enter admin at week boundary. Do not reapply march or accept orders for the active frame. Hero death/terminal phase stops continuation without further income, movement or revival.

Multiple divisions contesting a node: do not discard unhandled hostile divisions. Stable detection independent of faction/division insertion order; resolve sequentially with fresh surviving state. Voluntary retreat should not cause an already-resolved encounter to be replayed from stale start positions. Do not change battle simulation or sequence signatures without a concrete parent-reviewed contract need.

Expose completeAdmin(war) to leave admin without spending a turn or moving enemies. No automatic admin rewards. At settled turn boundaries evaluate hero death, no-player-castle loss and all-castles-held victory, without early victory before unresolved opponents finish.

Tests RED then GREEN, meaningful separate cases: a real sequence result pauses/resumes one turn; no orders/log/income lost or duplicated; reject/no-op midbattle order edits without mutation; multiple simultaneous encounters each handled once with unique IDs; contested castle cannot change owner before fighting; insertion order invariance; weekly admin exactly once after resumed boundary; repeated resume no-op; terminal hero loss prevents upkeep; completed no-battle replay still identical. Use actual createWar, sequence and at least one real createBattle/step result. Explicit fixture snapshots allowed for the transition matrix, not passed off as real simulator output.

Gate npm run check && npm run build, whitespace. Parent reruns gates and independent spec/quality reviews. Battle-result replay, war save schema/storage, biome Search and admin rehabilitation remain separate follow-ups.
