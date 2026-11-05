# MVP3 biome search and recruitment battles

Baseline: eb8a2b8, 630 tests. Target mvp3 only. Headless; no UI, no persistence.

Owned: src/world/search.ts; tests/world/search.test.ts; `data/world.json` biome tables only if a table is genuinely unusable (report first, do not retune balance). No edits to turn.ts, sequence.ts, encounter.ts, movement.ts, engine.ts or any existing test — report required seams instead.

A Search order already consumes a turn and currently emits `searchedNothing`. This slice turns it into a real biome roll that can produce a wild encounter.

Export:
- `searchOutcome(war, divisionId)`: pure, reads the division's node biome table and the seeded war RNG, returns either `{ kind: 'nothing' }` or `{ kind: 'wild', wild: { unitId, count }[] }`. Lair nodes use `SEARCH_CHANCE_LAIR`, wilderness biomes use `SEARCH_CHANCE_WILD`, friendly settlements and `settled` biomes never find anything. Weighted selection comes from the node's authored table weights. Must consume RNG exactly once per resolved search so replay stays exact.
- `wildEncounter(war, divisionId, wild)`: build the `PendingBattle` record for a wild fight, including the acting division as attacker, `defender: null` and the populated `wild` array. Deterministic id derived from turn and node.
- `applyWildVictory(war, divisionId, generalId, defeated)`: the defeated wild troops join that general's company as fresh stage-1 `ProgressTroop` records, clamped to remaining command capacity, with deterministic ids/names from the war RNG. Surplus beyond capacity is discarded, not banked. A loss adds nothing.

Rules: reject a search for a division that does not exist, is empty, belongs to another faction, or sits on a node whose biome table is empty. Never mutate inputs in `searchOutcome`. No free troops on a loss, no healing, no capacity overflow, no duplicate troop ids across the whole war.

Tests (RED first, separate unconditional cases): same seed gives the same outcome and a different seed differs; lair versus wilderness rates differ measurably over a seeded ensemble; friendly settlement always finds nothing; weighted table only ever yields authored species for that biome; capacity clamping discards surplus; a loss adds nothing; ids/names unique against every existing roster; invalid division/faction/empty-table rejected without mutation; RNG consumed exactly once per search.

Deferred and must NOT be implemented here: wiring Search into `resolveTurn`, running the wild battle through `sequenceEncounter` (it currently rejects `wild` encounters by design), UI and persistence. Report the exact seams the parent must add.

Gate: `npm run check` and `npm run build`. Report real numbers and anything unfinished.
