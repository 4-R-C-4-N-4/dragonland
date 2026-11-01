# Art pipeline (proposal)

Status: draft for review. Nothing here is built yet, except a one-sheet smoke test (below).

## Goal

Make all Dragonland art with Codex image generation, and keep every change cheap:

- changing the global look (palette, outline, era) is one edit plus a batch regeneration;
- changing size, team colours, palette or animation timing is one edit plus a reprocess that takes seconds and makes no generation calls;
- changing one unit is one edit plus regenerating that unit only;
- nothing generated is ever overwritten or lost, and any asset can roll back to an earlier pick.

The game already loads `assets/sprites/<unitId>.png + .json` (Aseprite format) with no code changes. The pipeline's output is exactly those files, so the game side needs no new work.

## Smoke test (done)

One Codex call with this prompt: "Soldier, 5 rows (idle/walk/attack/hit/death) × 4 frames, side view facing right, flat magenta background".

- It returned a 1122×1402 sheet. The 5×4 layout was clean, the character was consistent across all 20 frames, and the feet sat on a shared baseline.
- A 60-line slicer (magenta key, connected components, row grouping, common scale, bottom-aligned) found the 5×4 grid automatically and downscaled it to 24 px tall. The result still reads as a soldier, and the animations survive.
- Problems found:
  - magenta fringe pixels on the outline (needs de-spill);
  - frames centred one by one jitter horizontally (anchor each frame to its source cell instead);
  - the red tunic is baked in, so team colour needs a plan (see open questions).

Probe files are in `~/.hermes/cache/scratch/artprobe/`.

## Volume

| Asset | Count | Calls |
| --- | --- | --- |
| Troop/general lines: 5 classes × 3 lines × 3 stages | 45 units × 5 animations | 45 sheets (one call holds all 5 animations) |
| Battlefield terrains (grass, snow, forest, castle…) | ~5 | ~5 tiles + ~5 prop sheets |
| Special effects | ~1 per general type | ~15, start with 2 |
| Portraits (later) | per general | later |
| UI glyphs (dispositions, commands) | ~10 | 1 grid sheet |

At about 60 s per call, run one at a time, the full roster is ~45–60 min of unattended generation per full pass. Expect about 2 candidates per unit, so ~2 h for a first full roster.

## Layout

```
art/
  style.yaml            global style block: era, palette notes, outline, camera, background key colour
  sizes.yaml            on-screen height per stage / general, frames per animation, fps
  teams.yaml            team colour ramps
  units/<unitId>.yaml   per-asset spec: description, silhouette notes, reference unit, overrides
  terrain/<id>.yaml
  fx/<id>.yaml
  raw/<assetId>/<specHash>-<n>.png    every generation ever made (gitignored or LFS, never overwritten)
  picks.yaml            assetId -> chosen raw file (the only thing review changes)
tools/art/
  gen.ts     builds the prompt from style + spec (+ reference image), calls Codex, saves to raw/
  process.ts deterministic: raw pick -> assets/sprites/<id>.png/.json
  review.ts  writes art/review.html: every unit animated at game scale, both teams, on terrain, old vs new
```

Each stage only reruns when its inputs change:

- **gen** runs when the prompt hash (style.yaml + units/<id>.yaml + reference pick) changes. It never runs implicitly: `npm run art gen soldier` or `npm run art gen --stale`.
- **process** runs for every asset on any change to sizes, teams, palette or picks. It's local and takes seconds.
- **review** is always regenerated.

## Consistency across 45 units

- **One style block** is prefixed to every prompt, so a style change means editing one file and regenerating everything.
- **Reference images**: `codex exec -i` attaches images. Each unit is generated with:
  - an approved anchor sheet (for example the Soldier) attached for "match this exact style, scale and outline";
  - for stage 2 and 3, its own stage-1 sheet, so evolutions "keep the silhouette but add detail" (design.md).
- **Fixed scale per stage** comes from `sizes.yaml` in post-processing, not from the model. The model is never asked for exact pixel sizes or palettes.
- **Project palette**: quantize every sheet to one shared palette (or per-class sub-palettes) after generating. This removes most cross-sheet drift.

## Post-processing (process.ts)

1. Key out the background, then de-spill the magenta fringe.
2. Find the frame grid from connected components, grouped into rows. Validate the expected 5 rows × N frames; on a mismatch, reject the sheet with a clear message.
3. Anchor each frame to its source cell (no per-frame re-centring), so frames don't jitter.
4. Scale with one factor per sheet, chosen so the idle height matches `sizes.yaml` for its stage. Use a box-filter downscale, a hard alpha threshold and the palette quantize.
5. Team colour (see open questions).
6. Pack into a PNG and write Aseprite JSON with frame tags idle/walk/attack/hit/death and durations from `sizes.yaml`.
7. Facing: sprites are generated facing right. The renderer flips them for side 1, which costs nothing.

Tooling: Node + `sharp` for image work. That's one dependency, and it handles alpha, resize and quantize; it's dev-only. The alternative is Python + Pillow, which is installed system-wide, but there's no numpy and it would be a second language in the repo.

## Review loop

`art/review.html` is a static page served by Vite at `/art/review.html`. It shows:

- every asset playing all five animations at real game scale, on terrain, in both team colours;
- the current pick next to all candidates.

Clicking a candidate writes `picks.yaml` through a tiny dev endpoint, or prints the line to paste. Review becomes a page you skim, not files to open.

## Cost of typical edits

| Change | Edit | Runs | Time |
| --- | --- | --- | --- |
| Troops too small | `sizes.yaml` | process | seconds |
| Team colours | `teams.yaml` | process | seconds |
| Wolf looks like the Dog | `units/wolf.yaml` | gen wolf + process | ~1 min |
| Different art direction | `style.yaml` | gen --stale (all) + process | ~1 h unattended |
| Prefer candidate 2 | `picks.yaml` (or click) | process | seconds |

## Open questions (Ivy)

1. **Sprite size.** The docs say troops 16–24 px and generals 32–48 px. At 24 px the Soldier reads, but most of the generated detail is lost. Keep it, or go to ~32 px troops / ~64 px generals and let the camera zoom out?
2. **Team colour.** Options:
   - (a) reserve a tabard/banner colour in every prompt and palette-swap it per team. Strongest read, but the model must cooperate.
   - (b) keep neutral sprites and show team only through the existing coloured ground marker and outline. Simplest.
   - (c) post-process tint of an auto-detected cloth region. Fragile.
3. **Pixel-art look vs painterly.** The smoke test came back in a 16-bit SNES style. Is that the direction?
4. **Raw storage.** Generated originals are ~4 MB each, ~100+ for a full pass. Gitignore them (local only) or use Git LFS?
5. **Order.** Do the 12 MVP units + 2 generals first, then the other 3 classes' 27 units after you've designed their stats? Or all 45 now?
