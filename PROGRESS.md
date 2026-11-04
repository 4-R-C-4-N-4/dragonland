# Progress

## MVP3 — the full game (branch `mvp3`)

Contract: `docs/mvp3.md`. Phase 1-2 task plan: `docs/plans/mvp3-phase1-world-core.md`.

MVP2 is merged to `main` as `cac3773` (PR #2). MVP3 adds the war layer: overworld navigation, sequenced general-vs-general battles, general promotion, weekly admin and a full campaign. MVP2's 8-battle run is retained as Skirmish Campaign so nothing regresses.

Decided with Ivy: castle garrison 7 vs attacking division 5 (tighter than Dragon Force's 10v5, so castles matter but still change hands); the overworld is **turn-based** — one node per turn, every node action costs a turn, enemies move simultaneously; losing or retreating returns a division to its previous node.

Four open questions remain in `docs/mvp3.md` with defaults: map size, starting force, rival general count and hero signature moves, plus search success rates and enemy visibility. Nothing is implemented yet.


Branch: `mvp2`. Current parent gate: `npm run check` (tsc + vitest, 492 tests) and `npm run build`. Node 22. Mainline readiness: `docs/mainline-readiness.md`. Earlier milestone measurements below are historical.

## Release blockers closed

- Depleted-company recovery integrated from its worktree: select/prepare below `MIN_SQUAD` offers explicit abandon-and-restart, preserving unrelated storage and never auto-recruiting a replacement army.
- `validateRun` now checks persisted encounter offers, the chosen encounter, both frozen battle sides, recruit offers and summary troops/evolutions. Semantically corrupt saves report recovery instead of crashing the screen, and are never silently rewritten.
- Backtick debug overlay has one owner per press; the battle listener stops propagation so the application listener cannot toggle it straight back.
- Balance diagnostics regenerated on the corrected pursuit engine: 2,216 runs, all 15 specials, zero unfinished and **zero time-limit transitions** (previously 54-94). Shepherd 6/48 -> 25/48 among healers. `docs/qa/mp-special-balance.md`.
- Parent gate: 490 tests, build and `git diff --check` pass. Real-browser release smoke covered depleted recovery, corrupt-save recovery and a full campaign battle with MP cast; storage restored and read back. `docs/qa/release-smoke.json`.
- Final integration review (`cee0b6b`) found a frozen-general override that bypassed semantic validation: an unknown override species loaded as ok and then threw in `createBattle`, with the headless fallback hitting the same setup. Validation now requires a saved override to describe that side's own hero and checks its unit reference, while accepting legitimately progressed stats/special power. Two regressions went red first; gate is 492 tests.
- Confirmation re-review at `52cc1c7`: APPROVED, no regressions in scope. It independently loaded 540 real progression saves and rejected 1,080 invalid overrides with stored bytes unchanged, and recomputed the fingerprint shared by all four balance reports. Browser check confirmed the override recovery screen, preserved corrupt save and a still-resumable valid save. `docs/qa/override-validation-browser.json`. CI green on `52cc1c7`.

## Quit battle and lifecycle completion

- Added visible Quit battle / Escape confirmation in both app modes. Modal pauses, initially focuses Continue, blocks background shortcuts, and restores prior pause state on cancel. Failed save writes keep the battle recoverable.
- Campaign confirm persists terminal forfeiture with actual casualties and no rewards; legacy saves still load. Sandbox confirm returns to builder without resurrecting fallen IDs or altering the campaign save.
- Fixed sandbox view ownership on result/quit/controller teardown and stale async completion/rejection. Startup now cleans acquired Pixi/DOM/input/RAF resources on failure before a handle exists.
- Review found and regressions fixed valid-empty sandbox roster auto-reset and rejected-startup resource leaks. Parent475tests/build/diff checks pass; complete real-browser keyboard/pointer, storage failure, reload, three viewports and both modes passed. Evidence: `docs/qa/quit-battle.md`.
- This closes the sandbox cleanup release blocker. Depleted-company preparation recovery integration, semantic save validation, debug shortcut, post-pursuit balance/release verification and commit/push/CI are not closed by this feature. No main merge.

## Hero versus stragglers repair

- Reproduced the reported zero-hit drifting: slow return-home speed was reused for pursuit, and attacks checked only before movement could miss forever as a kiter stepped away each next tick.
- Active pursuit now has a data-defined closing margin; return-home speed stays unchanged. Heroes attack when movement reaches range in the same tick. No HP/damage/range/cadence inflation.
- Parent439 tests/build pass;67 new regression cases cover all15 heroes/both sides/Hold/FallBack,10 wounded ranged survivors, attack timing, slows and return walking. Independent review APPROVED. Real battle renderer confirmed20 normal hits,10 defeated and780 HP remaining without specials; campaign storage unchanged and view destroyed.
- Evidence: `docs/qa/hero-stragglers.md`. Old special calibration reports are explicitly historical after this AI correction; an all15 peer smoke is recorded separately. Earlier release blockers remain open; no commit/push/main merge.

## MP-only recharge and special peer tuning

- User-approved MP-only model is implemented in the working tree: start empty, linear combat-time recharge, spend the full bar, no second meter/cost/cooldown state or hit charging. Pause, replay, duplicate queued casts and legacy frozen-v2 saves have regressions.
- All 15 specials calibrated by peer family. Shepherd now heals35% every16s plus movement, versus25% every20s before; its beam is50% larger and lasts twice as long. Waves trade band width against damage; buffs trade offense/frequency against protection; targeted and field attacks have explicit burst/coverage/delay trade-offs.
- Parent check:372 tests and build pass. Independent spec/quality reviews approved the MP mechanics and diagnostics after fixing MP color invalidation and missing duel time in reports. Final numeric calibration is recorded in the exact report definitions.
- Reproducible final evidence: `docs/qa/mp-special-balance.md` and four `special-balance-*.json` reports:2,216 executed runs, all15 heroes, paired sides, neutral-line normalized and native profiles, zero unfinished. Peer time-limit transitions increased54->69; this is disclosed, not a universal campaign-balance signoff. Shepherd normalized healer-peer results7/48->23/48.
- Live existing-server QA: real Shepherd selection/preparation/battle, MP pause freeze/full readiness/cast/refill and extended FX passed; QA storage restored. Only the main repo dev server is left running. No new art generation, dependencies, commits, pushes or main merge.
- Earlier release issues (depleted-company recovery integration, sandbox teardown, semantic corrupt-save recovery) remain separate work; this pass does not close the draft PR's release gates.

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

- Current state: HUD, campaign and corrected FX streams are integrated. `polish-perspective` is active in an isolated worktree based on `a3127cb`; parent gates/reviews/browser integration remain authoritative. The bullets below retain chronological implementation history, not current worker status.
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
- FX corrections passed both independent re-reviews with no remaining findings (`fx-fixed-{spec,quality}-review.txt`), merged as `c16345e`. Parent processed all 15 picks using shared trim into runtime assets (`a3127cb`); raw picks unchanged. Parent gate: **318 tests and build pass**. Source contact review is separate from still-pending in-game playback signoff.
- The broader diagnostic ensemble exposed illegal singleton auto-arrange squads after attrition. Added red→green planner regressions and explicit blocked-deployment reporting, fixed in `f2fac7a`; parent gate **322 tests/build pass**. Independent spec and quality reviews both approved; reviewer reported additional property-case checks. A clean archived checkout also passed npm-ci, 322 tests and build.
- Final seeded diagnostic evidence: `docs/qa/release-diagnostics.{json,md}` — four variants, all 15 heroes, **90 campaigns / 588 completed battles**, both sides casting specials, zero blocked deployments after the planner fix. Compared 1600 versus 1400 width on seeds 701–702, plus whole-army far/near variants on seed 701. Retained 1600 simulation width deliberately: shorter travel changes outcomes/planning time, while perspective remains a presentation-only change. The near-only bot performs poorly; no claim of route/hero balance certification.
- Perspective implementation and aura deduplication passed the parent's isolated **335-test/build** gate. Parent inspected the compact projected battlefield and all15 actual game-scale special captures; each first cast used real assets, lethal snapshots/pause/wave advancement/cleanup were checked, and exact diff-bound provisional verdicts are committed in `art/reviews/fx.json`. Dense peaks remain an explicit art limitation.
- Perspective spec review passed. Quality review identified stale/general-directed route previews when Mixed has not acquired a target or queues Advance from Hold. A bounded correction is active on the same worktree: reuse canonical read-only targeting for queued intent and refresh active endpoints without extending the 1.5s guide lifetime. Simulation parity and affected reviews are required before merge.
- Production campaign UI smoke passed eight scenarios using validated snapshots from real seed701 simulations: invalid/zero composition and auto-arrange, survivors/wounded/permanent losses/promotions, recruitment, milestone selection, final win, defeat, corrupt and incompatible save recovery. Original test-origin save restored; no recorded errors.
- A continuous real production browser run also passed hero choice → seeded encounter →59 deployed/1 benched → Fight → identical frozen-battle reload → actual victory → recruits → next encounter. Result:45 deployed survivors,7 wounded recoverees,7 permanent losses,1 benched; roster65 after recruits; Beast unlocked. No recorded errors and the battle root was removed after results. See `docs/qa/browser-smoke.md`. This is the pre-projection production build; rerun the combined final build after perspective integration.
- The bounded route correction now passes the parent's isolated **344-test/build** gate. It reuses canonical read-only acquisition with queued intent and refreshes active guide endpoints without resetting the original 1.5s lifetime. Parent compared full first-battle end states for all15 heroes/seed701 against the baseline: hashes, ticks, results, generals, targets, cooldowns, effects and logs are exactly equal. Affected spec/quality re-reviews are active; not merged yet.
- Parent inspected corrected route/framing at800×600,1024×768 and1280×800, including paused keyboard planning, live resize and mouse approach changes. Actual startBattleView teardown passed3 successive cycles during real Dragon waves/Holy Rally and an active drag: each removed all9 tracked new global input/resize handlers, canceled the game-frame callback, detached canvas and produced no subsequent FX/finish callbacks or errors. Evidence: `docs/qa/perspective-verification.json`.
- Opened and read-back verified draft PR #2 (`mvp2` → `main`): https://github.com/4-R-C-4-N-4/dragonland/pull/2. Closed/read-back verified the stale MVP1 PR #1 with an explicit supersession comment; preserved its branch. Final integrated production smoke/current-head CI, final integration review and ready-for-review transition remain pending. No mainline merge is authorized.

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
