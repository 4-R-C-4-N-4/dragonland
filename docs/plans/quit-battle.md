# Quit battle

Approved request: an in-battle way out when the outcome is clear. Implement a visible Quit battle control, not a silent save reset or fabricated simulated result.

- Campaign: confirmed quitting forfeits the run. Persist a real terminal transition with no XP, recruitment, wounded recovery, unlocks or victory rewards. Preserve bench/living roster and permanently record actual casualties already suffered. Mark the ending as forfeited so the UI does not claim the living general died. Legacy saves still load. Reload cannot resume the abandoned battle; duplicate/late callbacks cannot overwrite this ending.
- Sandbox: confirmed quitting returns to the builder, recording actual casualties already suffered once, with no rewards.
- Confirmation pauses the simulation. Continue/Escape restores the prior pause state; cancel never changes the run/store. Controls behind the modal must not issue commands, alter speed or toggle pause. Focus initially favors continuing; keyboard and pointer access work.
- Place the control in the existing responsive HUD without overlap at800x600,1024x768,1280x800. No new framework/dependency or dev server.
- Both modes must destroy the battle view, including result transitions, controller destruction and a view whose asynchronous startup resolves after its owner has gone. Guard quit/result callbacks with the exact battle/container identity.
- TDD: pure run forfeiture and persisted reload/idempotence, sandbox reducer and lifecycle/controller boundary, modal pause restoration/input blocking, HUD layout. Parent check/build plus real-browser campaign cancel/confirm/reload and sandbox return/cleanup. Preserve existing uncommitted MP and pursuit work. No commits/push/main merge.
