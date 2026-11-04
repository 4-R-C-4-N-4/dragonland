# MVP3 interactive map surface slice

Baseline: 2654bb4, 615 tests. Target mvp3 only. Map widget is not mode/campaign assembly.

Owned files: src/render/worldMap.ts; src/ui/world/index.ts; src/ui/world/world.css; src/ui/world/presentation.ts if useful; tests/ui/worldMap.test.ts. No main.ts changes, runtime dependencies, save writes or simulation mutations.

Implement a real mounted Pixi v8 node/route map and plain DOM controls using existing project palette/style. Public mountWorldMap(root, { war, factionId, onOrder, onEndTurn }): Promise<{ update(war):void; destroy():void }>. Callbacks emit intents only; parent controller owns state/order commitment. Async startup and teardown must be exception-safe, idempotent and remove canvas, DOM, listeners, resize observer and ticker. Do not create an autonomous clock.

Display all authored nodes/routes, distinct castle/town/village/lair/biome labels and ownership, own division banners and only visible enemy banners (reuse visibleNodes from ai/strategy). Node selection shows panel; owned-division selection shows generals, HP and troop counts. Native keyboard-accessible buttons/selects duplicate canvas hit targets so canvas is not the only input path. March target limited to adjacent nodes; Search/Rest/Hold apply selected own division; End turn emits once per activation. Disable order controls outside orders phase or without a legal selection, avoid leaking hidden army details. No fake result or automatic refill.

Responsive controls and scrollable panels at 800x600, 1024x768, 1280x800. Native focus visible, selection survives update when ids still valid, stale selection clears. Show turn/week/phase and clearly label this provisional map art. No claim UI is playable campaign until parent connects turn/battle/admin/save flow.

Tests: meaningful helper/DOM mocks following existing test conventions without adding jsdom; focus on selection/adjacency/visibility, callback routing, phase blocking and lifecycle ownership. Write a reproducible browser-smoke script or clear fixture invocation using real createWar + mountWorldMap, so parent can run real keyboard/click/update/destroy checks. Do not claim browser success unless actually executed; mock/string tests alone are not visual QA.

Use RED-first tests then npm run check && npm run build. Parent runs actual browser in permitted environment, reviews screenshots and obtains spec/quality review before integration. Preserve working Skirmish Campaign and Sandbox.
