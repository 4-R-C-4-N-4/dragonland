# Dragonland — Game Design Doc

Working title · Ivy · North star for the full game. For what to build first, see [`mvp-spec.md`](mvp-spec.md) and [`implementation.md`](implementation.md).

## Vision & pillars

Dragonland is a real-time army-vs-army strategy RPG with sprite-art battles, built around a hero whose HP is the player's life. It takes Dragon Force's overworld war and huge on-screen clashes, then layers in Fire Emblem's character-driven generals and Pokémon's collectible, evolving troop species.

**Pillars**

1. **The battle is the spectacle.** Up to 100 sprites per side, readable at a glance, with big cinematic special moves. Everything else exists to set up these fights.
2. **The hero is the run.** The hero leads from the front; if they fall, the campaign is lost. Every risk is weighed against that.
3. **Armies grow and blend.** You start mono-type and gradually mix in new troop species, building a signature army no one else has.
4. **Read and counter.** The enemy commits first; your edge is choosing the right general, troops and formation in response.
5. **War has logistics.** Healing, resupply and recruiting happen in towns and cost time on a living map.

**Inspirations:** Dragon Force (Saturn, 1996) and Dragon Force II for the core war loop; Fire Emblem for generals, bonds and stakes; Pokémon for species, types and evolution.

## Core loop

The game cycles between three modes: march on the overworld, fight when armies meet, and recover and grow in towns during the weekly admin phase.

1. **Overworld (real time, pausable).** Move generals' armies along routes between towns and castles. Enemy factions move at the same time.
2. **Battle.** When two armies meet, the game cuts to the battle scene. Generals fight skirmish by skirmish until one side's generals are all defeated or retreat.
3. **Aftermath.** Winners take the node. Defeated generals may be captured, injured or killed. Troops lost are gone until replenished.
4. **Towns & weekly admin.** Garrisoned armies heal and refill over time. Each in-game week, you award generals, recruit captives, catch or train new troop species, and save.

The tension: every day spent healing in town is a day the enemy marches.

## The Hero

The hero is a general who also serves as the player's life bar: if the hero hits 0 HP in any battle, the campaign ends (or rewinds to last save).

- **Leads an army like any general.** Has a home troop type and can field it in battle, so using the hero is powerful but risky.
- **Signature moves.** 3–4 hero-only specials, unlocked through the story. Each is a full-screen sprite set piece (a dragon summon, a meteor, a rallying cry that heals troops). They charge from the battle special meter.
- **Hero HP heals slowly.** Only in towns or castles, so a wounded hero changes your whole strategy.
- **Duels.** When time runs out or both armies are wiped out, the generals fight one-on-one (see Generals in battle). For the hero, it's the highest-stakes moment of any battle.
- **Choice of hero.** At the start, pick a hero of any class. The hero's class gives access to that class's base troops.

## Generals

Generals are named characters with portraits, personalities and their own HP and MP; they command troops and are the units you actually lose or win.

- **Class.** Every general is a max-evolution unit of one troop class (e.g. a Paladin or Archmage), which sets their stats and spells.
- **Command capacity.** Max troops per general (e.g. 20 → 100). Raised by weekly awards and level-ups, as in Dragon Force.
- **Promotion to general.** Generals come from the ranks: a max-evolution troop who completes the general track (see Troops) is promoted.
- **Bonds.** Generals who fight near each other build support ranks. Bonded pairs get combo specials and short story scenes. *(V2 — lots of mechanical possibility here; playable version first.)*
- **Capture & recruit.** A defeated enemy general may be captured. During weekly admin, you can persuade them to join; odds depend on their loyalty and your reputation.
- **Injury & death.** At 0 HP a general is captured, injured (out for N weeks) or, rarely, killed. Permadeath is the default; a casual toggle can disable it.

**Generals in battle (Dragon Force default, to revisit)**

- **Levels.** Generals keep leveling after promotion. Level raises HP, MP and stats, and weighs on retreat odds and duels.
- **Specials.** Each general has class-based spells that cost MP and fire when the special meter fills. The hero adds signature moves on top.
- **No disposition.** Like Dragon Force, generals hold their position and fight off attackers while their troops maneuver; they don't roam the field.
- **Duel.** One-on-one when time runs out or both armies are wiped. Generals fight on HP, stats and level, and can still use specials.

## Troops

Every troop has a **class**, which sets its matchups, and a **line** within that class, which sets its combat role. Lines evolve through up to three stages; v1 only needs two.

**Lines (role split within each class)**

- **A** — deals more damage, but takes more damage
- **M** — middle ground, no modifier
- **Z** — takes less damage, but deals less damage

**Classes and evolution lines**

| Class | A (damage) | M (balanced) | Z (durable) |
| --- | --- | --- | --- |
| Beast | Raven → Hawk → Eagle | Wyrm → Drake → Dragon | Dog → Wolf → Warg |
| Ethereal | Imp → Demon → Devil | Sprite → Spirit → Shepherd | Cherub → Angel → Archangel |
| Human | Archer → Ranger → Deadeye | Spy → Rogue → Assassin | Soldier → Knight → Paladin |
| Mage | Witch → Necromancer → Diabolist | Adept → Wizard → Archmage | Monk → Cleric → Hierophant |
| Construct | Zombie → Skeleton → Servitor | Golem → Elemental → Kyilkhor | Automata → Machine → Anima |

**Damage cycle**

```
Beast > Mage > Ethereal > Construct > Human > Beast
```

Each class is strong against one class, weak against one, and neutral against the other two, so no class dominates the way Dragon Force's dragons did.

- **Ethereal > Construct:** human-made constructs are easily bested by true magical beings.
- **Mage > Ethereal:** this world's mages are trained to fight magical creatures.

**Damage model**

Damage uses fixed reference constants, tuned through playtesting.

- **Troop HP:** 100 for every troop.
- **Class modifier:** ± a fixed constant for a strong or weak class matchup.
- **Line modifier:** ± a fixed constant for A (deals and takes more) and Z (deals and takes less). Line modifiers stack additively on the class modifier, in both directions (formula in the MVP spec).
- **Skirmish length:** no more than about 3 minutes. A game-speed setting lets players speed battles up.
- **Timeout:** when time runs out, the two generals duel one-on-one.

**Individual troops & progression**

Every troop is an individual with a random name who gains XP, levels up and evolves on their own. Losing one is a real loss.

- **Mentorship.** Troops gain XP faster when fighting alongside a higher-evolution troop of their own line (e.g. a Ranger speeds up Archers' growth).
- **Rising to general.** A max-evolution troop must climb a further set of levels, the general track, before it can be promoted to general. This keeps plenty of max-evolution veterans fighting in the ranks.

## Army composition & blending

Each general starts commanding a single troop type and unlocks extra blend slots over the campaign, up to three types in one company. Dragon Force II already allowed two types per army (such as ground plus air), which shows the idea works.

- **Slots.** 1 type at start; a 2nd slot via promotion or a mid-game award; a 3rd at a late promotion. Troop capacity is shared across slots.
- **Ratios.** You set the split (e.g. 60/40). Each sub-group fights by its own matchups.
- **Synergies.** Certain pairings unlock bonuses; the pairings come from the type system.
- **Formations by blend.** Some formations only open with the right mix.
- **Trade-off.** Blended companies are flexible, but each sub-group is smaller, so a mono-type army still wins a pure counter matchup.

### Squads & disposition

In the army builder, any group of 2+ troops can be labeled a squad, and each squad gets a disposition that shapes how it fights all battle long.

- **Squads.** Up to 4 squads per general. Squads can blend classes freely.
- **Disposition.** Assigned per squad in the army builder and locked for the duration of a fight.
  - **Fierce:** charges in at the enemy.
  - **Mixed:** supports its squad and stays together as one unit (moves at its slowest member's pace — intended).
  - **Guard:** covers the general on the field.
- **Spacing.** Mixed squads hold together; Fierce and Guard squads can disperse as needed.

**How the layers stack**

Formation, command and disposition each control something different, so none overrides the others.

| Layer | When it's set | What it controls |
| --- | --- | --- |
| Formation | Pre-battle | Starting shape and positions |
| Command | Mid-battle, temporary | What the squad is doing: advance, hold, fall back |
| Disposition | Army builder, locked in battle | How the squad does it: target priority, spacing, aggression |

For example, under an Advance command a Fierce squad charges enemy troops, a Mixed squad advances as one unit, and a Guard squad advances while staying around its general.

Disposition crosses the A/M/Z line axis, so combinations like Fierce + Z (a charging tank) or Guard + A (protected damage) give each squad a distinct build.

## Battle system

A battle is a series of one-general-vs-one-general skirmishes, fought in real time with sprites, until one side has no generals left.

**Pre-battle**

1. Choose **Attack, Parley or Retreat.** Retreat loses some troops and moves your army off the route. Parley tries to make the enemy withdraw or defect; refusal costs you.
2. **Enemy commits first:** they pick a general, troop mix and formation.
3. You pick your general, see the matchup preview, then choose a formation.

**Formations (starting set)**

| Formation | Effect |
| --- | --- |
| Line | Even spread; balanced attack and defense |
| Wedge | Charge the enemy general; high damage, exposed flanks |
| Spread | Wide arc; good vs area magic, weak vs charges |
| Guard | Troops hold near the general; defense up |
| Skirmish | Ranged troops keep distance and kite |

**During the skirmish**

- **Commands:** Advance, Hold, Fall Back (plus Retreat for the general). Squads can be commanded separately. *(Managing each squad will need a good menu — worth figuring out. Callback to Dragon Force's pause-and-plan gameplay.)*
- **Special meter:** fills over time and as troops fight. Spend it on the general's spells or the hero's signature moves.
- **Terrain:** forest, hills, river, snow and castle walls change hit and dodge per troop type.

**Ending a skirmish**

- A general at 0 HP is defeated; their remaining troops scatter.
- If time runs out, or both armies are wiped out and neither general retreats, the generals **duel** one-on-one.
- Survivors keep their losses: dead troops stay dead.
- Retreating to save troops instead of losing them to a wipeout is a lever to tune later.

## Overworld

The overworld is a node-and-route map that runs in real time and pauses whenever a menu is open, as in Dragon Force.

- **Nodes.** Castles (faction seats, strong defenses), towns (heal, recruit, shop), lairs and ruins (wild troop species, items), and villages (income).
- **Routes.** Armies move only along fixed routes. Speed depends on the slowest troop type in the company and on terrain.
- **Encounters.** Two hostile armies on the same route or node trigger a battle. Generals travel in groups and can also be sent out solo (see reference below).
- **Healing and resupply.** A general garrisoned in a friendly town or castle regains HP and troops each day. Towns cap how many troops they can supply per week, so where you rest matters.
- **Weekly admin.** Every in-game week the map pauses for: awards (capacity, items), recruiting captured generals, training or evolving troops, fortifying castles, and story scenes.
- **Victory.** Take all enemy castles, or meet a story objective for the chosen hero.

**Reference: how Dragon Force handled divisions and encounters**

This documents the inspiration's format; Dragonland may change any of it.

- **Divisions.** Generals leave a castle via Deploy and travel as one group of 1–5 generals. A solo general is a division of one.
- **Triggers.** Battle starts when you invade an enemy castle, an enemy division meets you in the field, or the enemy invades your castle.
- **Castle capacity.** A castle holds up to 10 generals against an attacking division's 5, which favors defenders.
- **Battle order.** Generals fight one at a time. Each skirmish lasts about 90 seconds and ends when a general falls, retreats or time runs out; rounds repeat until one side has no generals left.
- **Retreat.** A retreating general is out for the rest of the battle; the winner can fight another round. Retreat success depends on troops left on both sides and the level gap between generals.
- **Capture.** Once every general in a defeated group or castle is beaten, the victor usually captures them for persuading later.
- **Type balance.** Dragon Force's troop types were notably unbalanced: dragons had a single counter, and archers were nearly useless outside one matchup. Dragonland's 5-class cycle is designed against this.

## Enemy AI

Enemy factions run two AI layers: a strategic layer that plays the overworld and a tactical layer that picks generals and formations.

- **Strategic.** Each rival faction has a personality (aggressive, defensive, opportunist) that sets how it expands, when it retreats to heal and which castles it targets.
- **Tactical.** Because the enemy commits first, it needs to choose well, not cheat. It weighs matchups against your likely responses rather than reading your pick.
- **Adaptive layer.** Rivals track what you field over the campaign and shift their recruiting and troop mixes to counter your signature army.
- **Rival generals.** Named recurring enemies with their own grudges, so a captured general can come back angrier if released.

## Art & presentation

The battle scene is the showcase: a side-on field with a slight tilt, pixel sprites, two armies charging from opposite edges, generals marked and specials filling the screen.

- **Sprite scale.** Troops small (about 16–24 px) so 100 per side fit and read as a crowd; generals larger (about 32–48 px) with a banner so you always find them.
- **Readability.** Each troop type has a strong silhouette and team color. Evolutions keep the silhouette but add detail, so a matchup reads at a glance.
- **Animation budget per troop:** idle, walk, attack, hit, death. Specials get bespoke full-screen effects.
- **Battle HUD.** Two general portraits with HP and MP, troop counts per squad, special meter and command buttons.
- **Overworld.** A painted or pixel map with army banners on routes and small node icons.
- **Portraits.** Anime-style busts for generals in dialogue and admin screens, in the spirit of Dragon Force's character art.

## Tech & scope

A browser game in TypeScript with a WebGL sprite renderer (PixiJS), which handles 200+ animated sprites easily.

- **Battle sim.** Fixed-timestep simulation, separate from rendering, so battles are deterministic and replayable. Troops use simple steering plus a spatial grid for targeting.
- **Data-driven content.** Classes, lines, units and formations live in JSON so balancing needs no code changes.
- **Save system.** Local saves first; cloud saves later if needed.

**Roadmap**

1. **MVP:** one battle — see [`mvp-spec.md`](mvp-spec.md).
2. Full troop roster in battle with its matchups, plus blending.
3. Small overworld: 6–8 nodes, one rival faction, healing in towns.
4. Weekly admin: awards, capture and recruit, troop evolution.
5. First campaign with one hero, then more heroes and factions.

## Decisions & open questions

- [x] Battle camera: side-on with a slight tilt (helps sprite work).
- [x] Permadeath for generals: on by default.
- [x] Type, role and disposition system: drafted (Troops; Squads & disposition).
- [x] A/M/Z affects matchups: stacks additively on the class modifier.
- [ ] Duel: action minigame or stat-driven exchange long-term? (MVP: stat-driven.)
- [ ] How many heroes and factions at launch?
- [ ] Setting and tone: classic high fantasy, or something more distinct?
- [ ] Platform: browser only, or desktop builds too?

## Sources

- [Dragon Force – Wikipedia](https://en.wikipedia.org/wiki/Dragon_Force)
- [Shacknews thread on Dragon Force](https://www.shacknews.com/article/48965/game-reviews)
- [RPGamer review](https://rpgamer.com/review/dragon-force-review/)
- [Infinity Retro review](https://infinityretro.com/dragon-force-review/)
- [GameFAQs board](https://gamefaqs.gamespot.com/boards/197149-dragon-force/50397313) · [GameFAQs review](https://gamefaqs.gamespot.com/saturn/197149-dragon-force/reviews/8439) · [Sega Saturn Shiro](https://www.segasaturnshiro.com/2024/09/25/dragon-force-the-soul-of-the-sega-saturn/) · [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/DragonForceSega)
