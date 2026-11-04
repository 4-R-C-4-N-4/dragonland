# Dragonland

A Dragon Force-inspired browser army battler with a finite roguelike campaign. Lead a general and a company of named troops through eight battles: survivors gain XP and evolve, losses deplete the roster, and limited recruitment lets you rebuild.

Built with TypeScript, PixiJS, Vite and a deterministic fixed-step simulation. No game server is required.

## Run locally

Requires Node.js 22 or newer and npm. Git LFS is required to download editable raw art sources; runtime sprites are ordinary tracked assets.

```sh
git lfs install
git lfs pull
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite. Campaign is the default; use the Sandbox mode link to try unlimited demo recruitment without changing campaign progress.

```sh
npm run check       # TypeScript + Vitest
npm run typecheck   # TypeScript only
npm test            # Vitest
npm run build       # production static site in dist/
npm run preview -- --host 127.0.0.1
```

Deploy the contents of `dist/` to a static host. Raw art generation is not part of the build and does not need API credentials in CI or production.

## Campaign

- Pick one of 15 heroes. Each starts with 60 stage-1 troops from its class and one fixed neutral partner class.
- Inspect committed enemy armies, then deploy up to 100 troops across four squads. Composition-first controls avoid selecting every troop individually; named veteran lists show who is deployed or benched, with highest-level troops chosen first.
- Win to earn troop/hero XP and unlock the defeated general's class for future recruitment.
- Some casualties recover as wounded after victory; the rest are permanent losses. Defeat grants no recovery or rewards, and your general falling ends the run.
- Ordinary troops evolve through three stages without becoming generals. Hero milestone upgrades improve vitality, might or special mastery.
- Campaign recruitment is finite. Sandbox autofill can recruit fresh demo troops; campaign autofill cannot.

Class cycle: Beast > Mage > Ethereal > Construct > Human > Beast; other pairings are neutral. A/M/Z are line categories used by the combat matchup system; inspect the in-game help and content data for details.

## Battle controls

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| 1–4 | Select a squad |
| A | Select all squads |
| Q / W / E | Advance / Hold / Fall Back |
| R / T / Y | Direct / Far Flank / Near Flank |
| S | Fire your hero's special when ready |
| F or Tab | Toggle 1× / 2× speed |
| Mouse drag / wheel | Pan / zoom battlefield |
| Backtick | Debug overlay |

The HUD provides the same tactical actions. Disposition (Fierce / Mixed / Guard) is fixed at deployment. Order and approach can change during battle or while paused. During pause the HUD shows queued intentions immediately; movement/combat stay frozen until resume. A multi-selection can contain different orders or approaches.

## Saves and reloads

Campaign and sandbox have separate localStorage saves in your browser; clearing browser storage removes them. Current campaign schema version is 2. Older/incompatible or corrupt campaign saves show a recovery/new-run screen instead of silently granting a fresh roster.

Reloading an in-progress campaign battle restarts that same committed battle from its original frozen setup/seed. It is not a mid-tick battlefield save. Reward processing is idempotent: loading the same result does not grant XP/recruits twice.

## Simulation and content

- `src/sim/`: pure seeded fixed-step battle engine; no DOM/Pixi imports.
- `src/run/`, `src/progression/`: campaign state machine and XP/stat derivation.
- `src/ui/run/`, `src/ui/builder/`: campaign and sandbox screens.
- `src/render/`, `src/battle/`: Pixi presentation, controls, camera and lifecycle.
- `data/`: validated content and tuning JSON.
- `assets/sprites/`, `assets/fx/`: generated runtime art.

Headless diagnostics:

```sh
npm run sim -- --help
npm run runsim -- --runs 30
```

See the tools' actual CLI help/source before adding flags. Balance results depend on the exact commit, seed set, hero, mixed composition and policies; historical percentages are not current balance guarantees.

## Editable art and status

The 45 unit species and 15 special-effect sources are preserved. Art is a provisional first pass, not final animation polish. Raw PNGs live in `art/raw/` through Git LFS; direction specs and selections are tracked under `art/`. Generated runtime sprites can be rebuilt from those selections.

See [art pipeline](docs/art-pipeline.md) for generation, picking and non-destructive manual cleanup. Copy an edited source to a new candidate and select it; edits made only to runtime PNGs are overwritten by reprocessing. Do not overwrite immutable generated originals.

Current roadmap and verification:

- [MVP2 contract](docs/mvp2.md)
- [Decisions](DECISIONS.md)
- [Progress](PROGRESS.md)
- [Mainline readiness audit](docs/mainline-readiness.md)
- [UI/UX execution checklist](docs/plans/mainline-ux.md)

`mvp2` is the integration branch. Mainline release is gated on the readiness checklist, real browser flows and visual FX checks, not only a successful build.
