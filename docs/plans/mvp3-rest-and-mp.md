# MVP3 resting refills losses; MP carries across battles

Baseline `0329d5e`, 741 tests, branch `mvp3`. Ivy's feedback: resting gives almost nothing back
(each general got 6 troops from a weekly stock of 20 at a castle, 10 at a town); Dragon Force keeps
MP between battles; the hero's special seemed to charge slower than the enemy's.

The clarify timed out; these are the recommended defaults, easy to revise.

## Findings

- MP charge is symmetric in the sim (`rechargeMp`: `maxMp / special.rechargeS` per second for both
  sides). Specials differ per general: Shepherd 16 s, Warg/Assassin 19 s, Paladin/Deadeye 20 s,
  Archmage/Hierophant/Devil 22 s. The first rival met is often the Shepherd, the fastest in the
  game, so it does fire first. Not a glitch; carrying MP changes the feel more than any rate tweak.

## Decisions

- **Muster strength.** Each division records the troop count it musters (`Division.muster`). It
  starts at the opening army, rises with wild recruits, adoptions and generals joining, and drops
  when a general leaves to garrison (taking troops with it). Battle losses do not lower it.
- **Rest refills losses** up to the muster, as far as the generals' command and the node's weekly
  stock allow, at most `RESUPPLY_TROOPS_PER_REST` (now 60, per division per rest). Weekly stock:
  castles 60, towns 30. Rest still heals 25% HP.
- **MP carries over.** `GeneralRecord.mp` (absent in older saves = full). Generals start the war
  full, a battle starts with the stored MP, MP still charges in battle, and what is left at the end
  is stored. Resting refills MP. Wild pack leaders start empty as before.

## Tasks

1. Rest: muster field + bookkeeping, refill in `applyRest`, constants and data, tests.
2. MP: `SideSetup.startMp` in the sim, `generalMp` in the battle snapshot (perspective swap), store
   it in clash and wild results, refill on rest, tests.
3. UI: map sidebar shows troops against muster and each general's MP; gates, docs.
