# Mainline UI/UX and release implementation plan

> **For Hermes:** Use subagent-driven-development to execute tasks with independent spec and quality review. Track exact verification; do not merge main automatically.

**Goal:** Finish every item in `docs/mainline-readiness.md` as a coherent, tested UI/UX and presentation pass on `mvp2`.

**Architecture:** Keep the pure seeded fixed-step simulation. Keep plain DOM/CSS campaign screens and Pixi battle rendering; no new framework or runtime dependencies. HUD reads queued intentions without advancing simulation. Perspective is a shared pure mapping, not scattered sprite offsets. UI choices do not silently rebalance the game.

**Tech stack:** Node 22, TypeScript, Pixi v8, zod, Vitest, Vite. Baseline `8c3e0f3`, 247 passing tests.

## Execution rules

For code: add a regression first, run it red, implement minimally, rerun focused tests and `npm run check && npm run build`. Separate commits by owned stream. Parent reruns gates before integrating and drives actual browser flows. Disposition remains fixed; orders and approaches are editable during pause with immediate visual intent and deferred simulation execution. No image regeneration until a specific inspected source is rejected.

Effort: S bounded, M connected components, L cross-cutting. The detailed findings/acceptance in `docs/mainline-readiness.md` remain binding.

## Phase 1 — independent streams

### HUD stream (M)

Owned: `src/render/hud.ts`, new `src/battle/hudLayout.ts`, `tests/battle/hudLayout.test.ts`, `tests/render/hud*.test.ts`. Do not edit battle/view.ts (parent integrates camera/input reservations).

- [ ] Pure layout function produces nonoverlapping rectangles at 1280×800, 1024×768, 800×600. Add rectangle containment/intersection tests first.
- [ ] Group/select squad cards with an expanded selected-squad detail area at compact widths.
- [ ] Explicit Order and Approach headings; fixed disposition displayed read-only.
- [ ] Human-readable pending-on-resume and mixed selection labels; retain getSquadIntent semantics.
- [ ] Existing keyboard/mouse controls retained. Export/read bottom-band reservation through Hud so view and renderer agree after resizing.
- [ ] Root gate, then parent browser checks all three sizes, pause edits and pointer hit areas.

### Campaign stream (M)

Owned: `src/ui/run/*`, tests/ui/runLogic.test.ts and new tests/ui/runPresentation.test.ts. If new result fields are needed, use the existing BattleSummary source first; request parent changes to run engine/schema rather than guessing or editing shared contracts.

- [ ] Hero choice: compact grid/class grouping, selected hero summary, primary Begin action reachable without reading/scanning the whole roster; keep all 15 accessible.
- [ ] Better metadata sizes/contrast, focus states and text/icon alternatives to colour.
- [ ] Portraits in preparation; clear deployed vs benched counts; retain composition-first editing and named veteran controls.
- [ ] Clear class cycle, A/M/Z role explanations, doctrine/unlock/special help, disposition/order/approach distinction.
- [ ] Intro describes wounded recovery accurately. Results distinguish survivors, recovered wounded, permanent losses, promotions, hero upgrade and unlocked class using real summary fields.
- [ ] Keep Fight reachable with sticky action summary; test zero/invalid composition still blocks fight.
- [ ] Root gate; parent browser chooses hero/encounter, auto-arranges, edits a count, launches battle and checks reward flow, keyboard focus and responsive layout.

### FX stream (M)

Owned: src/render/battlefield.ts (FX-specific sections only), src/render/fx.ts, src/sim/specials.ts, src/sim/types.ts (special event contract only), tools/art/fx.ts (processing only), tests/render/fx*.test.ts, tests/sim/fieldSpecials.test.ts, tests/art/fx*.test.ts. Do not modify art picks/raw or UI/HUD/view/camera.

- [ ] First cast uses real sheets: preload FX during existing sheet preload, or safely wait for texture readiness; no first-use placeholder when asset exists.
- [ ] Per-area visual affected targets for mixed specials; buff/debuff-only spells animate correct side without misplacing hostile impacts on allies. Maintain backwards compatibility or update every consumer.
- [ ] Trim common background padding/shared anchors, set explicit game-scale sizes, preserve raw sources and distinct sequential poses. Process all picks only after tests.
- [ ] Actually timed crossing waves; strikes at event positions including targets just killed by the special.
- [ ] All FX callbacks/texture continuations are safe after destroy; no orphan rAF chain. Keep animation paused while simulation is paused where practical.
- [ ] Root gate. Parent exercises actual assets at first cast and reviews all 15 effects after final projection integration.

## Phase 2 — parent integration and stability

### Shared view lifecycle (S/M)

Paths: src/battle/view.ts, tests/battle/viewLifecycle.test.ts (new). Add regression for listener cleanup, then use named handlers removed in destroy. Make destruction idempotent; release active pointer capture/drag state. Read HUD's dynamic band height for camera fit/HUD hit filtering after HUD merge. Check repeated start/destroy and campaign transitions.

### CI and documentation (S)

Create `.github/workflows/ci.yml`, README.md. Node22 checkout → npm ci → npm run check → npm run build. Do not download art generation dependencies or secrets in CI; generated runtime assets are in git. Document development/production commands, campaign vs sandbox, controls, saves/restart semantics and provisional art. Verify clean npm-ci gate in a disposable checkout if practical.

## Phase 3 — perspective (L, after FX/HUD integration)

Paths: new src/render/projection.ts and tests/render/projection.test.ts; src/render/battlefield.ts; src/battle/view.ts and camera.ts/tests/battle/camera.test.ts as needed.

- [ ] Pure projection/inverse: shallow trapezoid, restrained depth scaling, parameterized field bounds. Test corners, midpoint, offscreen points and forward/inverse round trips.
- [ ] Project feet and ground consistently; sprites upright, correct depth sort; selection discs/effects/projectiles/debug geometry share mapping. Avoid per-system approximations.
- [ ] Fit/pan/zoom based on projected bounds and correct projected-to-sim inverse; input remains correct after resize.
- [ ] Subtle far/near flank lane cues; transient selected route preview when changing/hovering approaches, not permanent markers.
- [ ] Browser screenshots at target sizes and active effects near/far; verify no projection-induced combat changes.

## Phase 4 — diagnostics and complete QA (M)

Paths: tools/runsim.ts, tools/dispo.ts (existing filename verify), tools/headless.ts; new durable reports under docs/qa/. No tuning sweep while sim/data files are being edited.

- [ ] Current campaign diagnostics cover all 15 heroes/classes, both sides using specials, realistic blended troops and actual route choices; record seeds/config, win counts, victory depths, duration/end reasons and timeout counts. Do not quote stale pre-change rates as release results.
- [ ] Compare existing field distance with a shorter candidate from a fixed tree using explicit constants overrides. Record engagement timing and decisiveness; choose deliberately, do not conflate perspective with simulation geometry.
- [ ] List each special's exact source, technical gate and game-scale visual verdict in art/reviews/fx.json: holy-rally, arrow-storm, shadow-mark, dragon-breath, tempest-dive, pack-howl, meteor-fall, hellfire-wave, sanctuary, inferno, guiding-light, judgement, plague-cloud, earthquake, overclock.
- [ ] Browser: hero → committed encounter → composition edit → fight → victory → wounded/XP/promotion → recruits → next battle; milestone, defeat, final win, same frozen battle reload and corrupt/incompatible save recovery. Preserve test seeds/saves in evidence, not player storage.
- [ ] Production preview smoke, repeated battle teardown, console/resource errors; real-GPU performance remains explicitly unverified unless measured on actual hardware.

## Phase 5 — review and publish (M)

- [ ] Exactly one independent spec and one quality review per implementation diff; resolve confirmed critical/important issues, rerun affected review. Use Codex CLI recovery if configured delegation provider is still exhausted; no concurrent writers in one worktree.
- [ ] Parent reruns npm run check/build and browser flows on the merged tree, not only worker branches.
- [ ] Update PROGRESS.md, docs/mainline-readiness.md, art/reviews/fx.json with implemented/reviewed/verified distinctions and outstanding limitations.
- [ ] Commit and push `mvp2`; verify exact remote SHA, LFS upload and clean tree.
- [ ] Review main...mvp2; prepare the correct mainline PR and deliberately supersede the stale MVP1 PR. No main merge without an explicit final instruction.

No overworld, extra classes, equipment, waypoint queues or individual-unit control in this pass.
