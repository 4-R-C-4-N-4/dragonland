# Progress

Branch: `mvp`. Gate: `npm run check` (tsc + vitest, 135 tests) and `npm run build`. Node 22.

## MVP2 implementation (branch `mvp2`)

Contract/queue: `docs/mvp2.md`. MVP1 sandbox remains available.

- Written and committed the run/progression contract and validated finite-run tuning JSON.
- Implemented a serialized resumable art generator with dependency ordering and pending-review records.
- Removed floating battlefield flags and centroid decorations; HUD squad selection, tint and selection rings remain.
- Parent gate: 141 tests pass and production build passes. New flags regression tests observed red before removal.
- Initial three Hermes workers failed before writing code due to Anthropic HTTP 429; no implementation was lost.
  Recovery used authenticated Codex CLI in the same isolated worktrees (content, art specs, pure progression).
- Q1/Q2/Q3 merged into `mvp2` (gates green: 172 tests at merge); independent spec review PASS, quality review APPROVED (follow-ups: art-spec drift test added; progression keeps its own chain check by design).
- Q4 sim: per-troop `statMult`, hero `general` override, stage-3 troops keep troop stats (no longer overwritten by
  the same-species general profile), `STAGE3_STAT_MULT` 1.6.
- Q5 run engine `src/run/*`: seeded encounters/recruits, frozen battles, idempotent results, versioned storage with
  semantic validation; real-sim integration test.
- Q6 campaign UI `src/ui/run/*` is the default mode (sandbox via link). Browser-verified: new run -> encounter ->
  deploy -> battle -> reload mid-battle resumes the same frozen battle -> victory -> rewards -> recruit -> next select.
  Fixed: duplicate recruit offers.
- Q8 art: `tools/art/production.ts` running serially (Codex); contact sheets via `tools/art/contact.py`; isolated
  vision reviewers judge each batch. Picks are provisional until reviewed.
- Balance (tools/runsim.ts, naive bot): runs currently end at 0-2 victories; attrition far too punishing. Open.
- Gate now: 194 tests, build passes.

## Art handoff

- All 14 MVP unit/general IDs have raw candidates; picks and processed sprites are provisional.
- Raw full sheets and walk strips live in `art/raw/` (Git LFS), with YAML direction in `art/units/`
  and `art/style.yaml`. Generated game assets live in `assets/sprites/`.
- Targeted six-frame walks are selected for Soldier, Archer, Dog, Rogue, Paladin, Dragon and Wolf.
  Rogue also has a revised full sheet with explicit knife grips; Wolf has a leaner quadrupedal
  redesign. Other units retain four-frame full-sheet walks.
- Fixed false invalid-grid failures from dilation bridging adjacent animation rows; added regression
  coverage. Custom strip choreography replaces conflicting generic walk instructions.
- Art remains a first pass: repeated gait poses, weapon/limb clarity and residual jitter may need
  hand cleanup. This is not a final animation-quality signoff. See `docs/art-pipeline.md` for the
  non-destructive hand-edit/reprocess workflow.


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
