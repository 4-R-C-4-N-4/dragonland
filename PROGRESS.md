# Progress

Branch: `mvp`. Gate: `npm run check` (tsc + vitest). Node 22.

States: planned → in progress → implemented (child reports) → verified (orchestrator reran gates / drove UI) → merged to `mvp`.

| # | Milestone | State | Notes |
| --- | --- | --- | --- |
| 0 | Scaffold: Vite/TS/Pixi/Vitest/zod, `/data` JSON + zod schemas, sim contract `src/sim/types.ts`, DECISIONS.md | verified | 1 test |
| 1 | Sim sandbox + headless runner | in progress | worktree ../dragonland-wt/m1-sim, also owns src/ai |
| 2 | Battle render | planned | |
| 3 | Army builder + persistence | in progress | worktree ../dragonland-wt/m3-builder |
| 4 | Controls | planned | |
| 5 | Duel display + enemy AI + full loop | planned | |
| 6 | Art pass hooks | partial | parser + discovery on mvp (`src/render/spriteSheets.ts`); Pixi swap-in pending render |
| 7 | Tuning support | planned | |
