# Progress

Branch: `mvp2`. Current parent gate: `npm run check` (tsc + vitest, 294 tests) and `npm run build`. Node 22. Mainline readiness: `docs/mainline-readiness.md`. Earlier milestone measurements below are historical.

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
- D21 disposition rework + D22 wounded recovery: see DECISIONS.md. Campaign (30 runs, default Mixed/Mixed/Guard):
  40% won, 6.5 avg victories of 8. Superseded measurements below (old dispositions):
- Balance (tools/runsim.ts, 20 runs, auto-deploy, best-edge encounter): disposition dominates outcomes.
  all Mixed 1.50 mean victories / 0% won; all Fierce 5.15 / 20% won; Mixed,Mixed,Fierce,Mixed 1.80 / 0%;
  Guard,Mixed,Fierce,Mixed 0.70 / 0%. Auto-arrange now defaults to all Fierce. Open: Fierce dominance
  (disposition balance) and run recovery tuning.
- Hero retaliation: removed the fixed home leash that let ranged Imps chip a stationary hero forever. Actual attackers can be pursued across the field; aggro expires five sim seconds after they stop targeting the hero, or immediately on death. Heroes return to their original position when clear. Mirrored Imp regression tests, pursuit persistence, return/expiry, pause and determinism verified. Gate: 244 tests and production build pass.
- Paused planning: order and approach previews update immediately in squad cards and button highlights without stepping the sim. Added Direct/Far Flank/Near Flank controls (R/T/Y); orders remain Q/W/E; disposition stays locked. Queued intentions execute/log on resume and replay identically. Browser checked both keyboard and mouse changes while paused. Gate: 247 tests and production build pass. Perspective projection has not changed in this pass.
- Gate now: 194 tests, build passes (historical, before hero/special expansion).

## Mainline preparation

- Integrated local hero retaliation and pause/approach controls in `1e6cafd`; preserved provisional FX sources/runtime assets and slicer fixes in `02c1c70`.
- Browser audit: hero selection, encounters and preparation at 1280×800; battle HUD at 800×600. Confirmed fixed-width HUD overlap/clipping, small metadata and primary actions below the fold.
- `docs/mainline-readiness.md` ranks the focused UX pass, FX correctness/signoff, perspective work and release gates. No merge to `main` is authorized by this integration step.
- FX review status is explicit in `art/reviews/fx.json`; generation/technical validity is not visual approval.

## Active mainline UI/UX execution

Checklist: `docs/plans/mainline-ux.md` (all findings from the readiness audit are in scope; no automatic main merge).

- Active isolated implementation streams: `polish-hud` (responsive battle HUD/planning cues), `polish-campaign` (campaign readability/actions/help/results), `polish-fx` (first-cast/per-area targets/sizing/waves/FX lifetime). Workers do not push or commit; parent reviews and integrates.
- Parent foundation implemented: battle drag handlers now detach on teardown, including cancel/lost-capture; destroy is idempotent. Three lifecycle regressions pass. Full repeated-battle browser verification is still pending.
- Parent foundation implemented: pure shared perspective/inverse/depth-scale/bounds module with four geometry tests. It is **not wired into battlefield/camera yet**; integrate only after the FX stream to avoid conflicting edits.
- Added Node22 GitHub CI and README. Local parent gate: **254 tests pass, production build passes**. Remote CI execution and clean-install verification are pending.
- Node22 remote CI passed for `e73fa7c`: https://github.com/4-R-C-4-N-4/dragonland/actions/runs/41489935249.
- HUD stream implementation completed and parent gate passed (255 tests on its isolated baseline); independent spec/quality reviews and live integration are pending.
- Added `tools/releaseDiagnostics.ts` (validated arguments, per-hero seed ensemble, both AIs/specials, first-hit timing, battle duration/end reasons and blocked-run reporting). Parent gate now **258 tests and build pass**. Executed baseline and 1200-wide comparison, one seed for each of 15 heroes: baseline 7/15 campaigns won, 100 battles, no timeouts; short-field 8/15, 102 battles, no timeouts. This is exploration, not a statistically stable balance claim; defaults unchanged. Durable data: `docs/qa/field-distance-baseline.json`.
- Campaign stream implementation completed and parent gate passed (261 tests on its isolated baseline). Parent browser testing caught a real sticky-Fight overflow inherited from the old full-width `.dl-start` rule; bounded CSS fix now passes button/viewport containment at 1280×800, 1024×768 and 800×600. Evidence under `/home/ivy/.hermes/cache/scratch/polish-browser/`; independent reviews and full integrated flow remain pending.
- Parent added optional `survived`/`benched` battle-summary fields to distinguish deployed survivors from recovered wounded and bench without breaking old v2 summaries. Victory/defeat regression cases pass; parent gate now **260 tests and build pass**. Campaign presentation will consume these fields during integration.
- Recovery after unhandled completion notifications: collected all worker/reviewer reports and preserved existing diffs. HUD spec review passed; quality requested bounded name truncation and avoiding per-frame layout invalidation. Campaign reviews requested metadata sizing, final-win milestone wording and the already browser-fixed sticky-Fight width. Follow-up workers are active on those exact surfaces; campaign now has the real optional survivor/bench contract available.
- FX implementation completed; parent gate on its synced worktree passed **271 tests and build**. First independent spec/quality reviews are active. No visual approval inferred from these tests.
- Parent camera/projection composition now has two additional regressions (pan/zoom/HUD-offset inverse and projected bounds inside HUD bands); parent gate **262 tests and build pass**. Live renderer/camera wiring remains pending reviewed HUD/FX integration.
- Campaign corrections passed independent spec review and quality re-review with no remaining findings, then merged as `ecc1de8` into `mvp2`. Parent combined gate: **283 tests and build pass**. Integrated final browser flow remains under the release checklist, not inferred from mocked DOM tests.
- HUD quality re-review approved the corrected diff with no findings; merged as `0c10d49`. Parent integrated its dynamic band reservation into camera fit, HUD pointer/wheel exclusion and resize handling. Actual browser inspection at 1280×800, 1024×768 and 800×600 confirms visible controls, keyboard/mouse paused intent updates and honest mixed-selection highlights. Evidence: `/home/ivy/.hermes/cache/scratch/polish-browser/integrated-hud-*.png`. Combined gate: **294 tests and build pass**.
- Independent spec/quality reviews, integrated browser evidence, per-FX visual verdicts, broader final balance diagnostics and release PR remain pending; a green foundation gate does not close those items.

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
