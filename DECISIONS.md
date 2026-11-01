# Decisions

Provisional calls made during the MVP build where the docs were silent or ambiguous. Each one overrides
`docs/implementation.md` until Ivy revises it. Code that depends on one carries a `// DESIGN-TBD: Dn` comment.

| Id | Decision | Why / where |
| --- | --- | --- |
| D1 | Paladin and Dragon start with **identical** hp / mp / level / attack. The class+line asymmetry (Paladin→Dragon 1.05×, Dragon→Paladin 0.65×) is left in on purpose; Rally healing the Paladin in a duel (D3) may offset it. Measure with the headless runner before rebalancing. | Ivy: "maybe 1 and 2 will balance each other out. let's see." `data/generals.json` |
| D2 | **MP is a cooldown.** Firing a special needs a full meter, MP ≥ `mpCost`, and the special off cooldown. It spends `mpCost` MP and the full meter. After `special.cooldownS` the MP is restored to max. No other MP regen. | Ivy: "mp regen should be simply a cooldown, kiss". `SpecialDef.cooldownS` |
| D3 | In a duel, **Rally heals the Paladin himself** by `amount` (there are no troops left to heal, or they are not in the duel). Breath hits the opposing general. | Docs silent; Rally would otherwise be a no-op in duels. |
| D4 | Generals start each battle at full HP and MP. HP does not persist between battles. | MVP has no towns or healing. |
| D5 | General `level` is displayed but **not** used in combat math yet. Hook: `levelTerm()` in combat returns 0. | Formula in §2.4 has no level term. |
| D6 | Special `amount` is a **flat** value (heal or damage). It does not go through the class/line formula. | Simplest; placeholder specials. |
| D7 | Enemy troops are generated fresh each battle from AI loadout unit counts, with seeded names. Enemy casualties are shown on the result screen but not persisted. | AI loadouts cannot reference the player roster. |
| D8 | The builder requires every company troop to be in a squad (no auto-grouping). A troop in the roster but not in any squad is simply not in the company. | §2.6 "Simplest" option. |
| D9 | Mirror acceptance test (Human beats Beast) uses `mirror-human` vs `mirror-beast`: **same general (Paladin) and formation** on both sides, so only troop class differs. Test-only loadouts are marked `"test": true` and excluded from enemy commit. | Isolates the class counter from the general asymmetry (D1). |
| D10 | Player is side 0 (left, faces +x); enemy is side 1 (right, faces −x). | Convention. |
| D11 | During the duel, surviving troops (on timeout) freeze and take no part; they survive to the roster. | §2.10: "generals duel". |
| D12 | Stage-3 units (`paladin`, `dragon`) live in `units.json` for general stats (range, cooldown, speed, size) but can never be roster troops. | §2.3 |
