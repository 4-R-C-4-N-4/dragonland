# Release diagnostics — current mixed-army policies

Source: `f2fac7a7c4e8e6016765d695992cd209c90ba4a3`. Full reproducible options, content/config fingerprints, all 15 hero rows, campaign seeds/depths and individual battle timings/end reasons/cast counts are in `release-diagnostics.json`.

All variants ran from the same committed simulation inputs. Both sides used the actual AI controller and specials. The bot used campaign auto-arrange, best class-edge encounter selection, first fitting recruitment offer and vitality milestones. These results measure that policy, not optimal human play or statistical balance certification.

| Variant | Campaigns won | Battles | Blocked | Timeout-to-duel | Mean battle seconds | Mean first normal hit seconds | Special casts, player/enemy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Existing 1600 width, seeds 701–702 per hero | 12/30 | 198 | 0 | 1 | 49.29 | 6.23 | 315/267 |
| Candidate 1400 width, same seeds | 18/30 | 210 | 0 | 1 | 43.43 | 4.53 | 322/282 |
| Existing width, whole-army Far Flank, seed 701 per hero | 4/15 | 80 | 0 | 1 | 56.94 | 6.78 | 132/116 |
| Existing width, whole-army Near Flank, same seed | 0/15 | 100 | 0 | 0 | 51.12 | 9.42 | 151/142 |

Verified totals: four variants, 90 campaigns, 588 completed battles. Each variant enumerates all 15 heroes. No safety-tick abort or blocked deployment in the completed sweep. `firstHitS` records a normal hit event, not necessarily the earliest special damage. A reported timeout means the skirmish reached 180 seconds and then resolved through the game's duel backstop, not an unresolved process hang. The exact hero/seed/battle rows are retained in JSON.

Decision: retain the 1600-wide simulation field. The 1400 candidate shortens the planning window and changes outcomes; it is not merely a visual improvement. Ship the shared perspective presentation independently rather than silently changing combat geometry during a UI pass. Whole-army flanking is not equivalent to selective squad manoeuvres: the near-only bot in particular performs poorly in this ensemble. No blanket claim that the routes or heroes are equally strong is warranted.

The broader baseline initially exposed a real planner defect: attrition could leave a singleton line in its own illegal squad. This was reproduced by regression tests, fixed in `f2fac7a`, then both geometry sweeps were rerun from the same fixed commit. The failed pre-fix 1600 sweep is not counted as a campaign loss or release result. A genuinely too-small total roster is now reported explicitly as blocked rather than crashing the diagnostic or being counted as defeat.

Reproduce from this commit:

    npx tsx tools/releaseDiagnostics.ts --runs-per-hero 2 --seed 701
    npx tsx tools/releaseDiagnostics.ts --runs-per-hero 2 --seed 701 --field-width 1400
    npx tsx tools/releaseDiagnostics.ts --runs-per-hero 1 --seed 701 --approach farFlank
    npx tsx tools/releaseDiagnostics.ts --runs-per-hero 1 --seed 701 --approach nearFlank

The tool refuses uncommitted simulation/data/planner inputs. Later presentation-only commits can have a different Git SHA while retaining the recorded simulation fingerprint. Browser gameplay/FX review, final production smoke and real-GPU performance are separate checks.
