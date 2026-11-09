# MVP3 class-mate generals, division troop pools and fight preparation

Baseline: `d0d868b`, 727 tests. Target `mvp3`. Supersedes the solo-hero part of `mvp3-solo-start.md` (adoption, hunt-star picker and defeat rule stay).

## Decided with Ivy

- **Start:** the hero plus the other two generals of the hero's class (Warg → Dragon and Eagle; Paladin → Deadeye and Assassin), one division. Generals never change class; adopted generals of any class join as themselves.
- **Troops belong to the division, not to a general.** Anybody can command any troops; what matters is who you have. The starting army is the Skirmish demo roster (hero class + partner, 60). It grows through wild recruits, resupply and adoption.
- **Preparation before every fight you take part in** (general clashes, castle assaults, wild packs): choose which troops this general takes from the pool, how they split into up to four squads, each squad's disposition, and the formation, with Auto-arrange, exactly like the Skirmish prepare screen. You see who you face where the rules allow it (the attacker sees the committed defender; the defender sees the attacking division's generals).
- Garrison generals share a pool at their castle the same way.

## Model

Troop records stay on `GeneralRecord.troops` (saves, upkeep, AI and validation unchanged), and the **pool** is the union over a division's generals (or a castle's garrison generals). Committing a fight with an army plan moves the chosen troops onto the fighting general and spreads its unchosen troops over the other pool members with room; anything left stays with the fighter as **benched** for this fight. Results keep benched troops and remove only the deployed dead. AI sides send no plan and fight with what each general holds, as now.

Player generals command up to `PLAYER_STARTING_CAPACITY` (100 = a full battle company). Starting troops are dealt round-robin across the three generals so each holds a mix; the player never has to see that.

## Tasks

1. `createWar`: hero + two class-mates, shared roster dealt round-robin; tests.
2. Pools and plans in `src/world`: `fightPool(war, generalId)`, `applyArmyPlan` (validate against pool, capacity, squad limits, formation; move troops), `commitDefender/commitAttacker(..., army?)` and `wildBattleSetup(..., army?)` building the side from the plan; result application keeps benched troops (general fights and wild fights). Tests with real sim results, including a benched troop surviving a lost fight.
3. Campaign UI: a preparation screen after choosing a general (both battle kinds), built on `src/ui/run/logic.ts` (autoPlan/planIssues/planToArmy/classEdge), capped at the general's command limit; Back returns to the choice. Map sidebar shows the division's troop pool by species instead of per-general troop counts.
4. Gates, browser QA (start a war as Warg: three beasts; reach a fight; prepare and launch), probe update (`tools/warOpening.ts`), PROGRESS/DECISIONS, review.
