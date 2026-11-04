# Quit battle verification

Implemented locally on mvp2; no commit, push or main merge.

## Behavior

- Quit battle button in the responsive HUD; Escape opens the same confirmation.
- Confirmation pauses simulation and MP recharge, blocks background battle shortcuts, and initially focuses Continue battle. Continue/Enter or Escape cancels and restores the previous pause state, including an already-paused battle.
- Campaign confirmation explicitly forfeits the run. Persisted terminal state is lost with `lastSummary.forfeited=true`, not a fabricated simulated general death. Actual deployed casualties remain lost, living/benched troops remain, and no XP, recovery, recruitment, evolution or class unlock is granted. Reload cannot resume the forfeited battle. New run is reachable.
- Sandbox confirmation returns to the builder and applies actual casualties once. This does not overwrite the separate campaign save.
- Failed persistence leaves the confirmation open and usable; the old saved battle remains intact.

## Gates and review corrections

Parent `npm run check`:475 tests across64 suites. Build and diff whitespace checks passed. Coverage includes forfeit identity/idempotence, legacy-save parsing/reload, pause/focus/input blocking, responsive HUD geometry, controller callback ownership, late async completion/rejection and ordinary result/quit/controller teardown.

Independent spec and quality re-reviews APPROVED the corrections (24 focused tests each; their read-only environment could not run asset-transforming controller tests). Parent ran the full suite including those controllers and reran the complete browser flow. Initial reviews found two valid edge cases; both were reproduced and fixed:

1. Sandbox's real store treated an empty validated roster as uninitialized, regenerating160 troops and restoring fallen IDs after a total loss. It now preserves[]; only missing/corrupt saves regenerate. Tests exercise actual createStore through quit, store recreation and sanitized saved loadouts—not only a mocked store. Explicit demo recruitment remains a separate feature.
2. Startup could reject after Pixi initialization before returning a view handle. Setup now registers resource cleanups as each resource is acquired, cleans in reverse order, attempts all cleanups even if one throws, handles partial initialization, preserves the original startup error and remains idempotent. Regression tests cover failed preload and synchronous setup failures, input/resize/RAF cleanup and canvas removal.

## Real browser

The final integrated dev-server flow was exercised through normal campaign and sandbox controls, not by injecting a result. Initial entropy was pinned to seed701 for the campaign only. Stored state was backed up before the QA flow, restored in finally, and read back unchanged afterward.

- Running cancel: unchanged saved run and frozen MP/tick while dialog open; S/W/F did not queue background commands or toggle speed.
- Keyboard: Escape opened the modal, Continue had focus, Enter continued; Escape cancelled an already-paused battle without unpausing it.
- Modal/button operation at800x600,1024x768,1280x800; modal fully contained in every viewport. Compact game-scale capture visually inspected.
- Simulated storage-write failure: no terminal state was persisted, modal stayed open, cancel/retry remained usable.
- Campaign forfeiture:60 roster troops became59 after one actual combat casualty; terminal forfeit persisted across reload; hero progress/depth/unlocks unchanged and no rewards. Old view's frame counter, tick and input queue stopped after exit.
- Sandbox: one actual casualty remained absent from the roster; builder returned; campaign save unchanged. Old view's frame counter, tick and input queue stopped after exit.
- Zero captured browser errors. No additional server was started; only the existing main dev server was used.

Evidence: `quit-battle-browser.json`, `quit-battle-800.png`, `quit-battle-forfeited.png`.

Automation notes: mode switching performs a document navigation, so prototype spies were reinstalled in the new realm. Raw CDP native Escape needs virtual-key27; native Enter activation also needs carriage-return text. Missing these caused harness-only failures before the corrected complete run. Space on the focused Continue button is normal native activation, not a background pause leak.

## Release scope

This also closes the sandbox caller-boundary battle cleanup issue. Depleted-company preparation recovery integration, semantic corrupt-save validation, the debug shortcut, refreshed post-pursuit balance diagnostics and final release/CI/commit/push gates remain separate. No mainline-ready claim.
