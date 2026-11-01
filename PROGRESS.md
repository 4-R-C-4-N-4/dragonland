# Progress

Branch: `mvp`. Gate: `npm run check` (tsc + vitest). Node 22.

States: planned → in progress → implemented (child reports) → verified (orchestrator reran gates / drove UI) → merged to `mvp`.

| # | Milestone | State | Notes |
| --- | --- | --- | --- |
| 0 | Scaffold: Vite/TS/Pixi/Vitest/zod, `/data` JSON + zod schemas, sim contract `src/sim/types.ts`, DECISIONS.md | verified | 1 test |
| 1 | Sim sandbox + headless runner | merged | 21 tests; mirror Human wins 86% / 81.5% swapped (200 runs each); every mirror battle goes to the duel (see notes) |
| 2 | Battle render | planned | |
| 3 | Army builder + persistence | merged, browser-checked | 42 tests; 4x25 army via auto-fill verified in Chromium; squad panel overflows at 1280px (fix in flow stream) |
| 4 | Controls | planned | |
| 5 | Duel display + enemy AI + full loop | planned | |
| 6 | Art pass hooks | partial | parser + discovery on mvp (`src/render/spriteSheets.ts`); Pixi swap-in pending render |
| 7 | Tuning support | planned | |

## Notes

- M1 sim: main melee resolves in ~30-45 s with tuned cooldowns (~0.5 s); Guard squads then stand off around their generals, so mirror battles run to the 180 s duel. D15 (duel-entry chip damage per surviving enemy troop) carries the troop result into the duel. Flag for playtest.
- `tools/trace.ts <a> <b> <seed>` prints a 15 s timeline of one battle for tuning.
