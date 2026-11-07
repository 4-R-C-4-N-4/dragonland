# MVP3 overworld UX pass

Baseline: `bf6b035`, 670 tests. Target `mvp3` only. No new dependencies, no rule changes in `src/world` beyond a read-only order view and order cancellation.

## Why

Hands-on play at 1280×800 (turns 1–2 of a fresh war) found the overworld hard to read and slow to command:

1. Node colour encodes kind, not owner. Westmere (yours) and Eastgate (enemy) are both green; ownership is a 3px outline.
2. Ordering takes three disconnected steps: click a node, press `Select division division-8fe40ce04ab26361` (raw id) below the map, pick a destination in a sidebar `<select>`. Clicking a neighbouring node on the map does nothing useful.
3. Queued orders are invisible. Nothing on the map or panel changes after March/Search/Rest/Hold; there is no way to see or cancel them.
4. End turn has no report. The enemy took Highpass on turn 1 silently. The map remounts every turn and drops the selection.
5. Marching out of Dawnkeep leaves it empty with no warning — the fastest way to lose.
6. Disabled order buttons give no reason.
7. Sidebar is a 12-button list duplicating the map with internal words (`settled`); turn/week shown twice.
8. Info panel sits under the canvas, so the map resizes/jumps as content changes and the page scrolls.
9. No legend for kinds or own/enemy markers.

## Decisions

- **Colour = owner, shape = kind.** Own nodes green (`--dl-good`), enemy red (`--dl-bad`), unclaimed tan. Castle: large square; town: diamond; village: circle; lair: triangle. A DOM legend overlays the map's lower-left corner and carries the provisional-art note.
- **Division-first ordering.** The player's first division (the hero's, if any) is selected by default. With a division selected, its neighbours are highlighted; clicking a highlighted node queues a march there. Clicking a node holding your division selects that division. Clicking any other node shows that node's details and clears the division selection. Clicking your division's banner selects it.
- **Orders are visible and reversible.** Queued marches draw an arrow on the map; the banner shows the queued action; the sidebar division row and panel show `Marching to Reedhaven` / `Searching` / `Resting` / `Holding (default)`, with Cancel. Re-issuing replaces the order (engine already does this).
- **Keyboard parity.** Everything the map does is also a sidebar button: division rows, one `March to <node>` button per neighbour (with kind/owner/biome/income summary), Search/Rest/Hold each with a one-line explanation, Cancel, End turn.
- **Undefended-castle guard.** A castle you own is undefended after this turn when no own garrison general stands there and no own division will remain there (not marching away). The sidebar shows a standing warning; End turn first asks for confirmation inline (`End turn anyway` / `Keep orders`). Towns are not guarded: losing a town does not lose the war.
- **Turn report.** After a turn resolves, the sidebar lists what happened from `war.events`: your moves, searches that found nothing, retreats, healing/resupply, captures (ownership is public on the map), a new week, and enemy movements **only where an endpoint is currently visible** (destination hidden ⇒ "left X"). Nothing hidden by fog is revealed. Report is in-memory only; a reloaded save shows no report.
- **Layout.** Map left at a fixed height (only viewport size changes it), sidebar right scrolls independently: turn header + End turn, warnings, your divisions and garrisons, selection panel, last-turn report. The widget no longer prints turn/week; the campaign status bar is the single source.
- **Selection survives turns.** `mountWorldMap` accepts an initial selection and reports changes; the campaign keeps it across remounts.

## Engine surface (pure)

`src/world/engine.ts`, exported from `src/world/index.ts`:
- `queuedOrders(war): WorldOrder[]` — copies of the pending orders; mutating the result never changes the war.
- `cancelOrder(war, divisionId): void` — removes that division's pending order; no-op outside the orders phase or while a turn frame is active, mirroring `issueOrder`.

## Presentation helpers (pure, unit-tested)

`src/ui/world/presentation.ts`:
- `nodeTone(node, factionId)` → `'own' | 'enemy' | 'neutral'`.
- `divisionName(war, division)` → `"<lead general>'s division"`.
- `orderLabel(war, order | undefined)` → `Marching to X` / `Searching` / `Resting` / `Holding` / `Holding (default)`.
- `nodeSummary(war, node, factionId)` → e.g. `village · swamp · unclaimed · +3 gold/turn · wild troops`.
- `undefendedCastles(war, factionId, orders)` → castles that will stand empty.
- `turnReport(war, factionId)` → report lines with the visibility rule above.
- `defaultDivision(war, factionId)` → hero's division, else first live own division.

## Tasks

1. Engine: `queuedOrders`, `cancelOrder` + tests (copy isolation, cancel, phase/frame no-op, replace semantics unchanged).
2. Presentation helpers + tests (including a visibility test: a hidden enemy move produces no line; a move into hidden territory names only the origin).
3. Map renderer: owner colours, kind shapes, selection ring, highlighted march targets, queued-march arrows, clickable banners with order suffix.
4. Widget: new layout, division-first interaction, sidebar sections, cancel, undefended confirm, report, selection in/out options; remove the node button list.
5. Campaign: keep selection across remounts, wire cancel, drop duplicate status.
6. Gates: `npm run check`, `npm run build`, `git diff --check`. Real-browser QA at 1280×800, 1024×768, 800×600: default selection, map-click march, arrow + label, cancel, keyboard march, undefended confirm, report after End turn, selection persists, no page scroll at 1280×800.
7. Independent spec + quality review; fix confirmed findings; update PROGRESS.md.

## Out of scope

Hover tooltips, fog dimming of unseen nodes, animated turn playback, income lines in the report, muster actions (promotion/captives), art changes.
