# MVP3 new-war setup surface

Baseline: fea853a, 618 tests. Target mvp3 only. Independent of interrupted-turn/replay work.

Owned: src/ui/world/start.ts, start.css, startLogic.ts; tests/ui/worldStart.test.ts. No main.ts/index.ts changes, dependencies, secrets, persistence or automatic campaign start.

Export mountWarStart(root, {data:GameData,worldData:BuiltWorldData,seed:number,onBegin:(war:War)=>void,onBack?:()=>void}):{destroy():void}. A real usable hero-selection/allocation surface using existing theme, not only an HTML string helper.

Choose one of15 actual heroes; enter a hero name; distribute exactly STARTING_TROOPS100 among hero andtwo generals, each <=STARTING_CAPACITY50. Default34/33/33, sourced from validated world constants. Three labeled native numeric inputs, remaining/overallocated amount, clear errors and disabled Begin until valid. No100-troop individual picker. Show class/profile information from actual catalog. No random reroll loops or free troops.

Begin uses actual createWar(worldData,{seed,heroId,heroName,split}) and emits that War exactly once per activation; no mutation of shared GameData/worldData. Prevent double submit while callback is running; preserve recovery if callback throws. Back does not create a War or modify saves. Selecting another hero preserves valid allocation and entered name. Escaping uses textContent/DOM, never interpolate player name into unescaped HTML. No Date/Math.random.

Native keyboard reachable, visible focus, responsive at800x600/1024x768/1280x800 with reachable Begin/errors and no horizontal overflow. destroy idempotent, remove DOM/listeners and no late callbacks. Keep existing modes untouched; parent later assembles mode/controller.

Pure validation helpers should independently test defaulttotal100, custom50/30/20, negative/NaN/fractional/overflow/incorrectsum/missing hero/blankname rejected, invalid input not silently rounded/clamped, input/catalog unmodified, HTML-safe name. Mounted behavior must get real-browser parent QA, not inferred from helper tests.

Use TDD, npm run check && npm run build; report exact gates and browser gaps. Independent spec/quality review before integration. Provisional surface, not full playable-war completion.
