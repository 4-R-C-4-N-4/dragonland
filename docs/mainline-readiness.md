# MVP2 → mainline readiness and UI/UX pass

Status: **draft PR [#2](https://github.com/4-R-C-4-N-4/dragonland/pull/2), `mvp2` → `main`; final integration gates remain open**.

The findings below preserve the original audit, not the current implementation state. Current evidence: `PROGRESS.md`, `docs/qa/browser-smoke.md`, `docs/qa/release-diagnostics.json`, `docs/qa/perspective-verification.json` and `art/reviews/fx.json`. The integrated parent gate is 322 tests/build; the corrected perspective candidate passes 344 tests/build and spec re-review, with quality re-review pending.

Baseline: `1e6cafd` (retaliation + pause planning) and `02c1c70` (provisional FX sources/runtime assets). Gate: `npm run check` = **247 tests passing**, `npm run build` passes. No new gameplay systems are recommended for this pass.

The actual release proposal is draft PR #2 from `mvp2` to `main`. The older MVP1-only PR #1 was explicitly closed as superseded; its `mvp` branch was preserved. No mainline merge has been performed.

## What is integrated

- Finite campaign, named troops, XP/evolution, wounded recovery and limited recruiting.
- All 45 species and 15 selectable generals; hero-derived starting pairs and class unlocks.
- Field-wide special simulation and generated FX sources/assets (visuals remain provisional).
- General retaliation beyond the old home leash and return to the original position when clear.
- Orders and approaches preview immediately while paused; disposition stays fixed.
- Direct / Far Flank / Near Flank, independently of Advance / Hold / Fall Back.

## Audit scope and evidence

Browser exercised at `http://localhost:5180/` and `/battle.html` in an isolated test browser session; no player saves were cleared. Checked hero selection → encounter offers → preparation at 1280×800, then paused battle controls at 800×600. Earlier planning smoke covered keyboard and mouse changes at 1024-wide layout. This is a focused audit, not a complete campaign playthrough or accessibility certification.

Local screenshots (not required build assets):

- `/home/ivy/.hermes/cache/scratch/mainline-ux-audit/01-hero-picker-1280.png`
- `/home/ivy/.hermes/cache/scratch/mainline-ux-audit/02-encounters-1280.png`
- `/home/ivy/.hermes/cache/scratch/mainline-ux-audit/03-preparation-1280.png`
- `/home/ivy/.hermes/cache/scratch/mainline-ux-audit/04-battle-800.png`

Effort: **S** = bounded change; **M** = several connected components plus tests; **L** = cross-cutting rendering work. These are relative estimates, not time promises.

## Recommended sequence

### 1. Battle HUD and pause planning — M, release priority

**UX-01 — High, observed:** fixed-position HUD controls overlap and clip on a compact viewport. At 800×600, Pause/Special overlap the command column; Advance/Fall Back and flank controls extend beyond the right edge. No browser horizontal overflow is reported because the clipped content is inside the canvas.

Evidence: `04-battle-800.png`; `src/render/hud.ts` `layout()` uses fixed squad widths/command offsets while positioning Pause/Special relative to viewport width. `src/battle/view.ts` reserves a fixed 172px lower band.

Recommended work:

- Responsive arrangement for squad cards, order group, approach group, and battle controls.
- Keep current squad information visible; show a larger detail panel for the selected squad instead of giving every card equal space at every size.
- Label Order and Approach explicitly; preserve locked disposition as read-only information.
- Add a clear pending-on-resume cue instead of relying only on `*`.
- For mixed selections show “Mixed orders/approaches,” with no misleading active button.
- Test mouse and keyboard parity; no pointer hit-area overlap.

Acceptance: all controls remain visible and clickable at 1280×800, 1024×768 and 800×600; resize and browser zoom do not hide commands; pause freezes simulation while choices update immediately. Phone support is a separate decision, not assumed achieved by this pass.

### 2. Special FX correctness and presentation — M, release priority

These are code-inspection findings, **not independently browser-reproduced FX verdicts**:

- **FX-01 — First-cast asset use:** `getFxFrames()` starts an async load and returns `null`; `spawnFxInstance()` renders the placeholder rather than replaying the real effect when loading completes. Unit preloading does not preload FX. Preload the two participating heroes' FX (or schedule ready playback) so the first special uses its actual art.
- **FX-02 — Buff-only specials:** `src/sim/specials.ts` pushes an active buff/debuff without adding affected entity IDs, while aura playback iterates only `ev.affected`. Pack Howl/Overclock can therefore miss their custom animation. Define correct ally/enemy targeting per visual area, including mixed-effect specials; do not use one union of affected entities indiscriminately for healing and hostile impacts.
- **FX-03 — Size/placement:** processed frame canvases retain the source height (724px), and `spawnFxInstance()` does not set an explicit game-scale size. Set sensible content bounds, shared anchors and runtime sizes; inspect at battle scale rather than accepting nonempty frames as visual approval.
- **FX-04 — Travelling waves:** the current wave path creates simultaneous stationary instances. Implement an actual timed crossing effect, rather than calling a static band a travelling wave.

Acceptance: all 15 specials visibly work on their first cast, affect the correct sides/positions, do not obscure the whole battle unintentionally, and clean up after completion or battle teardown. Record exact source picks and per-FX visual verdicts in `art/reviews/fx.json`. Its current status deliberately remains provisional.

### 3. Campaign UI hierarchy and information — M, UX priority

**UX-02 — Medium, observed:** hero/special/class metadata is small and muted; encounter and preparation screens rely on dense text and red/green matchup labels. Preparations have no species portraits, despite assets being available.

**UX-03 — Medium, observed:** the hero screen requires scrolling beyond the initial 1280×800 viewport to reach the primary start action. The preparation Fight action is also below the initial fold.

**UX-04 — Medium, observed:** class/line identifiers (A/M/Z), doctrine and matchup summaries are exposed without nearby explanations. The distinction between fixed disposition, mutable order and mutable approach needs a short visible explanation.

**UX-05 — Low, observed:** campaign introduction says “the fallen are gone,” without explaining post-victory wounded recovery. The economy should be clear before a player interprets recovered troops as a bug.

Recommended work:

- Stronger primary action placement and selected-hero summary; consider class tabs or a compact hero grid rather than 15 equally verbose cards.
- Troop portraits and clear deployed/benched counts; retain composition-first editing and optional named veterans.
- Minimum readable metadata sizing, stronger contrast and text/icons in addition to matchup colour.
- Compact class-cycle/line-role help, special tooltip, and explanations for doctrine and unlock rewards.
- Results should separately show survived, recovered wounded, permanent losses, promotions, hero upgrade and new class access. This results redesign is proposed, not yet re-audited in this session.

Acceptance: a new player can select a hero, understand its starting army, auto-arrange, make one adjustment and start a battle without deciphering internal IDs or hunting for the primary action. Verify keyboard focus and selection states.

### 4. Field shape and shallow perspective — L, approved direction still unimplemented

The field remains 1600×600 with `Y_SQUASH = 0.65`; no perspective transformation was added with approach controls.

- Prototype shorter left-to-right battle distance separately from rendering perspective, so balance changes can be measured independently.
- One shared forward/inverse projection for ground, unit feet, selection rings, projectiles, FX, camera and any future pointer commands.
- Upright side-view sprites with restrained depth scaling; no shearing the sprite artwork.
- Far/near flank cues and a temporary selected-route preview, not permanent flag clutter.

Acceptance: transformed ground and every attached effect agree spatially; inverse projection round-trips; near/far routes are readable; initial fit/pan/zoom work at target viewport sizes. Decide whether this lands before mainline or is explicitly deferred; do not present the existing vertical squash as finished perspective.

### 5. Stability, balance and release hygiene — M, release gate

- **Lifecycle review:** `src/battle/view.ts` installs anonymous pointermove/pointerup handlers on `window` without removing them in `destroy()`. FX uses independent rAF callbacks and lazy texture-load continuations; verify they stop or safely ignore destroyed battle objects. Repeated campaign battles must not retain old views or throw on exit.
- Re-measure campaign outcomes after hero specials, unlock restrictions, roaming generals and selectable approaches. Previous percentages are not a current release claim. Include all hero classes, actual specials on both sides, end reasons and timeouts; do not tune only to one bot's win percentage.
- Full browser campaign checks: victory → wounded/XP/evolution → recruit → next battle; milestone claims; defeat lockout; final win; frozen battle reload; incompatible/corrupt save recovery. Existing tests/history are useful, but this audit did not repeat that entire sequence.
- Add release CI for Node 22 `npm ci`, `npm run check`, `npm run build`; no workflow is currently tracked under `.github`. Test the production build, not only Vite dev.
- Add a concise README with run/build/play controls, save compatibility notes and provisional-art status.
- Review the full `main...mvp2` diff, resolve the stale MVP1 PR deliberately, and open the actual mainline PR only against the intended branch. Preserve raw assets in LFS and verify upload.

## Merge-to-main gate

- [x] HUD controls visible/clickable at supported widths; order/approach/locked-disposition semantics clear. Integrated `0c10d49` + dynamic view reservations; parent browser checked 1280/1024/800, keyboard and mouse paused edits and mixed selections. Final production smoke remains below.
- [ ] First-cast, buff-only and travelling-wave FX fixed; all 15 effects visually reviewed at game scale.
- [x] View teardown and repeated-battle lifecycle checked: three actual views destroyed during real queued FX and dragging; tracked handlers/frame callbacks returned to zero with no late callbacks/errors.
- [x] Current mixed-army campaign/hero diagnostics recorded; no known ranged-survivor stalls. Four variants, 90 campaigns/588 completed battles; time-limit duels and weak bot policies remain explicit, not hidden.
- [ ] Full browser run/save/reward/loss smoke plus production-build smoke completed.
- [x] Node 22 npm-ci/check/build CI and player/developer README present. Clean-install local gate and earlier remote CI passed; final integrated-head CI is still required before completing release review.
- [ ] Perspective either implemented and verified, or explicitly deferred with Ivy's agreement.
- [ ] Final review of `mvp2` against `main`; no automatic mainline merge from this audit.

Keep overworld, equipment, more troop classes, waypoint queues, individual-unit micro and additional progression systems out of this pass.
