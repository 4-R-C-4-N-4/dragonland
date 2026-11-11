# UI redesign verification

## Scope and direction

See `docs/DESIGN.md`. This is a production UI change, not a standalone mockup.
Campaign, shared navigation, Skirmish and Sandbox use the same theme. Simulation,
starting troop balance and saved-war schema are unchanged.

## Executed checks

- `npm run check`: 769 passing tests across 99 files, including TypeScript.
- `npm run build`: passes. Existing >500 kB chunk advisory remains.
- `git diff --check`: passes.
- Browser: Chromium with Vulkan, against a production build on localhost:5180.
- 1280x800: title, hero setup, map, queued march, undefended-castle confirmation,
  leaving/rejoining views, turn report, menu, battle choice, preparation, loading,
  live battle, paused battle, aftermath, next general, wild choice, muster,
  prisoners, saved-war title, won/lost screens, Skirmish and Sandbox.
- Real tactical fight from a staged two-enemy encounter: start with one wounded
  companion, choose it, fight to completion, inspect aftermath, Continue to the
  second choice, reload and assert localStorage is unchanged. This is fixture QA,
  not an end-to-end campaign victory.
- 800x600: map, general choice, preparation, real tactical completion and aftermath.
- 390x844: campaign and secondary-mode screens fit the page without horizontal
  document overflow. Skirmish choice/preparation and populated Sandbox tested.
- All recorded browser reports have empty page-error and failure lists.

## Visual findings addressed

- Title wordmark overflow: reduced responsive type scale, widened title container.
- Global `.dl-bar` / `.dl-dim` collisions with legacy builder styling: namespaced
  shared primitives as `.dl-meter` / `.dl-muted`.
- Primary action hover became dark fill with dark text: preserve ember hover fill.
- Wrapped map status was flex-shrunk at small desktop heights: make it nonshrinking.
- Suggested-army hover lost its label contrast: explicitly retain dark text.
- Canvas appeared before the tactical view finished loading: wait for the loading
  overlay to disappear before taking HUD screenshots.

## Known limits

The tactical viewport contract remains >=800x600. At 390px in portrait, the canvas
itself fits but internal HUD controls overlap. Do not describe this as a complete
phone/touch battle port. Desktop/landscape is the supported battle layout.

Short preparation windows can scroll vertically; troop tables also have their
own scroll area. Fight stays in a sticky footer. Staged terminal-war screens
verify layout, not genuine victory conditions. No fresh full-war win is claimed
for this UI pass by automation; Ivy won a war by hand on the local build before it was published.

## Reproduce

`tools/ui-shots.mjs` is the retained screenshot/regression driver. Playwright is
an optional external QA dependency; no runtime dependency was added. Build and
serve `dist` first, then run:

```
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
URL=http://localhost:5180/ node tools/ui-shots.mjs /absolute/output/directory
```

`W` / `H` select viewport size; `STEPS` filters scenario names; `WAR_ONLY=1`
skips Skirmish/Sandbox. Each output directory contains screenshots and report.json.
The script exits nonzero for scenario failures, console errors or page overflow.
Fixtures only modify the browser context's localStorage, not real user saves.

Local review evidence:

- `/home/ivy/.hermes/cache/scratch/pw/final-desktop/`
- `/home/ivy/.hermes/cache/scratch/pw/final-small/`
- `/home/ivy/.hermes/cache/scratch/pw/final-phone/`
- `/home/ivy/.hermes/cache/scratch/pw/final-modes/`
- `/home/ivy/.hermes/cache/scratch/pw/final-phone-battle/`
