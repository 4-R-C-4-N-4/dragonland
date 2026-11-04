# MP-only recharge and special peer balance

Refreshed on the corrected combat engine (hero anti-kiting pursuit and attack-on-arrival). These figures supersede the earlier pre-pursuit numbers.

## Implemented contract

MP is the sole special resource: it starts empty, fills linearly during combat, freezes with pause, and a cast spends the whole bar. Full MP alone enables the special. No hit charge, second meter, MP cost or separate cooldown state remains. Each special carries a positive `rechargeS`. Frozen v2 definitions normalize legacy `cooldownS` without rewriting saved spell effects or losing progress; existing frozen battles keep their own snapshots.

The HUD labels both MP bars numerically with state, and hero selection shows recharge time. Guiding Light renders at 90 units instead of 60 and plays for 0.96s instead of 0.48s; other effects are unchanged.

## Method

Working tree on base `3ccd37985fa32b7c7435948c919d55080fbd4747`; simulation/AI/runner fingerprint `6be724fd6994d8441b2300c1e422ed171467729e6fe915dc353985c6758544a6`, identical across all four reports. Each report embeds full definitions, options, content fingerprints and per-battle rows.

Before and after BOTH run the current MP-only engine. "Before" uses the preserved original effect values and 20s recharges from `tests/fixtures/legacy-generals.json`; it is not the removed combat-charge model. Seeds 701-712 are shared; every asymmetric pair plays both side orders and mirrors are counted separately. Each side fields the same 60 stage-1 troops spanning five classes and three lines in four Mixed squads, driven by the real browser AI policy. Normalized runs fix both generals to the same neutral-line Human/M profile and swap only specials; native runs keep real general profiles, so class/line effects are deliberately included.

| Dataset | Runs | Seeds/pair | Time-limit transitions | Casts | Mean combat seconds |
|---|---:|---:|---:|---:|---:|
| before | 564 | 12 | 0 | 3267 | 81.3 |
| after | 564 | 12 | 0 | 3591 | 84.8 |
| cross-family | 900 | 4 | 0 | 5393 | 84.1 |
| native | 188 | 4 | 0 | 1197 | 87.2 |

Total 2216 executed runs, zero unfinished. Suites overlap deliberately, so this is an execution count rather than that many distinct scenarios. `durationS` covers fight AND duel; `fightDurationS`/`duelDurationS` are recorded separately and cast timestamps continue through duels.

Every dataset now records **zero** time-limit transitions, down from 54-94 before the pursuit repair: battles are decided in combat instead of stalling into tie-breaks.

## Within-family results

Self-mirrors are excluded from these win counts, and denominators differ by family size. These are small paired deterministic ensembles - diagnostic observations, not population win rates.

| Hero | Before (old values) | After | Native profiles | Recharge |
|---|---:|---:|---:|---:|
| Paladin | 32/48 | 30/48 | 7/16 | 20s |
| Deadeye | 37/48 | 19/48 | 12/16 | 20s |
| Assassin | 17/48 | 37/48 | 9/16 | 19s |
| Dragon | 18/48 | 20/48 | 8/16 | 18s |
| Eagle | 18/48 | 16/48 | 3/16 | 18s |
| Warg | 6/24 | 14/24 | 4/8 | 19s |
| Archmage | 32/72 | 40/72 | 12/24 | 22s |
| Diabolist | 36/48 | 24/48 | 12/16 | 18s |
| Hierophant | 34/48 | 17/48 | 9/16 | 22s |
| Devil | 57/72 | 41/72 | 16/24 | 22s |
| Shepherd | 6/48 | 25/48 | 8/16 | 16s |
| Archangel | 18/48 | 28/48 | 4/16 | 18s |
| Servitor | 39/72 | 33/72 | 13/24 | 20s |
| Kyilkhor | 16/72 | 30/72 | 7/24 | 20s |
| Anima | 18/24 | 10/24 | 4/8 | 20s |

Shepherd rose from 6/48 to 25/48 among healers, the specific weakness reported. Deadeye, Hierophant and Anima fell as their peers gained; those families traded frequency, protection and coverage instead of keeping one dominant option.

## Final definitions and intended trade-offs

### Healing

- Paladin - Holy Rally, 20s: `[{"type":"heal","fraction":0.35},{"type":"buff","durationS":10,"damageMult":1,"speedMult":1,"defenseMult":0.8}]`
- Hierophant - Sanctuary, 22s: `[{"type":"heal","fraction":0.3},{"type":"buff","durationS":10,"damageMult":1,"speedMult":1,"defenseMult":0.7}]`
- Shepherd - Guiding Light, 16s: `[{"type":"heal","fraction":0.35},{"type":"buff","durationS":10,"damageMult":1,"speedMult":1.3,"defenseMult":1}]`

### Buffs

- Warg - Pack Howl, 19s: `[{"type":"buff","durationS":10,"damageMult":1.35,"speedMult":1.25,"defenseMult":1}]`
- Anima - Overclock, 20s: `[{"type":"buff","durationS":10,"damageMult":1.25,"speedMult":1.2,"defenseMult":0.85}]`

### Waves

- Dragon - Dragon Breath, 18s: `[{"type":"damage","area":"wave","amount":60,"includeGeneral":true,"width":110}]`
- Diabolist - Hellfire Wave, 18s: `[{"type":"damage","area":"wave","amount":45,"includeGeneral":true,"width":140}]`
- Archangel - Judgement, 18s: `[{"type":"damage","area":"wave","amount":85,"includeGeneral":true,"width":90}]`

### Targeted

- Deadeye - Arrow Storm, 20s: `[{"type":"damage","area":"random","amount":40,"includeGeneral":false,"targets":30}]`
- Assassin - Shadow Mark, 19s: `[{"type":"damage","area":"general","amount":300,"includeGeneral":false},{"type":"damage","area":"random","amount":35,"includeGeneral":false,"targets":16}]`
- Eagle - Tempest Dive, 18s: `[{"type":"damage","area":"random","amount":35,"includeGeneral":false,"targets":25},{"type":"debuff","durationS":6,"damageMult":1,"speedMult":0.7,"dotPerS":0}]`

### Field

- Archmage - Meteor Fall, 22s: `[{"type":"damage","area":"field","amount":30,"includeGeneral":true}]`
- Devil - Inferno, 22s: `[{"type":"damage","area":"field","amount":18,"includeGeneral":true},{"type":"debuff","durationS":6,"damageMult":1,"speedMult":1,"dotPerS":3}]`
- Servitor - Plague Cloud, 20s: `[{"type":"debuff","durationS":8,"damageMult":0.85,"speedMult":1,"dotPerS":4}]`
- Kyilkhor - Earthquake, 20s: `[{"type":"damage","area":"field","amount":25,"includeGeneral":false},{"type":"debuff","durationS":6,"damageMult":1,"speedMult":0.6,"dotPerS":0}]`

Healers trade throughput against protection: Shepherd heals 35% every 16s plus movement, Paladin 35% every 20s with 20% protection, Hierophant 30% every 22s with 30% protection. Warg favours offence and frequency; Anima trades both for defence. Waves trade damage against band width. Targeted strikes trade army coverage against general pressure or control. Field effects trade burst, delayed damage and movement control. Healing stays capped and never revives the dead; movement bonuses never speed up attacks. Direct spell damage still uses class/line/protection, and troop-only damage-over-time still bypasses them as before.

## Limits

This is a first tuning pass, not a claim of universal parity. Cross-family matchups, native profiles, deployment geometry, veteran armies and human cast timing are separate questions. Percentage heals scale with troop HP while flat damage and capped target counts do not. The AI is the existing real policy, not optimal per-spell play. No attack cadence or field size was shortened to flatter these numbers.

Parent gates: `npm run check` (490 tests), `npm run build`, `git diff --check`. Live browser verification of MP behaviour and Shepherd readability: `mp-special-browser.json`, `shepherd-mp.png`. Independent spec and quality reviews approved the mechanics and diagnostics after fixing MP bar colour invalidation and missing duel time.

## Reproduce

```sh
node_modules/.bin/tsx tools/specialBalance.ts --scope peers --seeds 12 --generals tests/fixtures/legacy-generals.json --out docs/qa/special-balance-before.json
node_modules/.bin/tsx tools/specialBalance.ts --scope peers --seeds 12 --out docs/qa/special-balance-after.json
node_modules/.bin/tsx tools/specialBalance.ts --scope all --seeds 4 --out docs/qa/special-balance-cross-family.json
node_modules/.bin/tsx tools/specialBalance.ts --scope peers --seeds 4 --profiles native --out docs/qa/special-balance-native.json
```
