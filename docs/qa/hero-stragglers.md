# Hero retaliation / straggler repair

## Confirmed fault

A normal Shepherd versus a ranged Imp on Hold reproduced zero hero hits in30 simulated seconds, while receiving11 hits. The pair drifted around the field at roughly71 units apart, outside Shepherd's24-unit reach. Collision radii were not the cause.

Two independent mechanics contributed:

1. `runGeneral()` used the60% return-home walking speed for active pursuit too. The Imp could kite at45 units/s while Shepherd pursued at32.4.
2. A general checked its attack only BEFORE moving. With faster pursuit alone, Shepherd followed at exactly24 units but still did not swing: the troop moved first on each subsequent tick. The first hit could be delayed until the enemy reached the field edge (23.85s in the isolated probe).

## Repair

- Active pursuit is separate from return-home movement. Its cap is `max(native hero move speed, target effective move speed) * generalPursuitSpeedMult * own speed modifier`, default multiplier1.25. The target speed uses the same movement-cap helper as ordinary troops, including disposition/group/effect modifiers. Own slows/haste still apply.
- Returning home retains the existing `generalLeashSpeedFrac=0.6`.
- A general that reaches attack range now checks and lands its blow in that same tick. The already-in-range path returns immediately, and cooldown checks prevent double attacks.
- Hero HP, damage, attack range and attack cooldowns were NOT increased. Aggro memory, unprovoked acquisition limits and stable home anchors remain intact.

## Verification

- New end-to-end regressions went red with incoming ranged hits and zero retaliation on both sides, then green after the repairs.
- All15 heroes, both sides, Hold and Fall Back:60 actual simulation fixtures. Every hero landed a normal hit within4.35 simulated seconds and cleared its ranged survivor. Fall Back fixtures begin inside its configured acquisition radius; distant, non-attacking troops are not retaliation cases.
- Shepherd versus10 wounded ranged survivors (50 HP each), mirrored:20 normal attacks, all10 defeated in35.05s,780/1500 hero HP remaining, no special activation. This does not claim every hero defeats any10 full-health elite troops.
- Dedicated checks cover attack-on-arrival, no duplicate attack, original slow return speed, movement debuffs, existing aggro expiry/home return and deterministic pause behavior.
- `npm run check`:492 tests passed (final integrated gate). `npm run build` and `git diff --check` passed.
- Independent read-only review:APPROVED, with86 focused tests/typecheck reported; parent reran the full suite.
- Real battle-view browser fixture: first normal hit2.85s;20 normal hits;10 defeated;780 HP; zero specials or captured errors. The browser pauses immediately after the last death, before the next fight-end check, at35.00s; the headless fixture includes that next tick (35.05s). View destroyed and campaign storage read back unchanged.

Evidence: `hero-stragglers.json`, `hero-stragglers-browser.json`, `hero-stragglers-browser.png`.

## Balance scope

The hero movement/attack correction changes combat outcomes, so the full calibration was regenerated on the corrected engine: see `mp-special-balance.md` and the refreshed `special-balance-*.json` reports, whose source fingerprints match this engine. `hero-pursuit-peer-smoke.json` was the interim exploratory two-seed smoke taken before that regeneration and is superseded by it. No unverified mainline readiness or merge claim is made.
