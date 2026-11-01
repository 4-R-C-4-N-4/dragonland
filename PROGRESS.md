# Progress

Branch: `mvp`. Gate: `npm run check` (tsc + vitest, 96 tests) and `npm run build`. Node 22.

| # | Milestone | State | Evidence / notes |
| --- | --- | --- | --- |
| 0 | Scaffold, data JSON + zod schemas, sim contract | verified | |
| 1 | Sim sandbox + headless runner | verified, 1 criterion open | §9.3 tests pass; `npm run sim`, `--matrix`, `--set`, `tools/trace.ts`, `tools/sweep.ts`. Human beats Beast in the mirror **100%** (spec wants "not 100%") — see DECISIONS D19 |
| 2 | Battle render | verified in Chromium (SwiftShader) | placeholder shapes, squad banners + markers, camera, HUD, interpolation. 60 fps NOT verified: test browser is software-GL (~38 fps); sim costs ~0.27 ms/tick |
| 3 | Army builder + persistence | verified in Chromium | 4x25 army via auto-fill in < 30 s of clicks; validation inline |
| 4 | Controls | verified in Chromium | Space, 1-4, A, Q/W/E, S, F (speed), backtick; HUD buttons |
| 5 | Duel + enemy AI + full loop | verified in Chromium | Builder -> commit -> response -> battle -> result -> builder; 77 dead removed from roster (160 -> 83); builder reopens the used loadout sanitized |
| 6 | Art pass hooks | verified | dropping `assets/sprites/dog.{png,json}` replaced Dog placeholders with no code change (test sheet in `assets/sprites-test/`) |
| 7 | Tuning support | verified | debug constants panel (applies next battle), reset roster, headless matrix/overrides |

## Open

- D19 class-counter decisiveness at 100 v 100 (design call).
- Real-GPU fps check on a mid-range laptop.
- Paladin/Dragon duel balance (D1) unmeasured in isolation; duels are now rare (~9% across the AI matrix).
- The AI-loadout matrix is lopsided (several 100/0 pairings); loadouts are hand-made placeholders.
