# MVP3 next batch — sequencing and promotion

Integration target: mvp3, baseline cebedd2, 575 passing tests. Never merge main automatically.

Two isolated workers, maximum two implementers in this batch. Use GPT-6-Luna with low reasoning; Claude Sonnet is not authenticated. No new dependencies. Each worker writes a failing test first, verifies RED, implements, verifies GREEN, and runs npm run check and npm run build. Parent verifies gates and obtains independent spec and quality reviews before integration.

## A — Battle sequencing

Owned paths: src/world/sequence.ts, tests/world/sequence.test.ts. Do not modify existing world contracts or turn engine yet; report required integration seams explicitly.

Read actual BattleSetup/BattleResult and progression APIs before implementing. Provide an exported, typed sequencing API accepting a pending encounter and producing defender-first selections and existing battle setups. A field division commits at most five generals; an actual castle garrison can defend with seven. Apply real results once per skirmish id, preserve surviving troop identities and progression, retain general HP, perform seeded nonhero defeat outcomes, and decide continue/retreat/resolve. Hero death terminates war. Retreat uses the division's real previous-node/path behavior, never an invented nearest-friendly route. No retreat troop tax.

Tests: multi-general fight, defender-first selection enforcement, no duplicate generals, actual 7-vs-5 castle encounter, result idempotency, surviving troop identity, hero death, mid-sequence retreat, blocked fallback. Include one real simulation-produced result. Do not fabricate BattleResults in lieu of testing the engine bridge.

Turn lifecycle integration (resuming interrupted turn, multiple simultaneous encounters, replay through results) is a separate parent-owned follow-up; do not claim it complete in this slice.

## B — General track and promotion

Owned paths: src/progression/general.ts, src/progression/index.ts (exports only), tests/progression/general.test.ts. Avoid imports from world/index; use world/types only.

Read actual troop progression and general catalog APIs. Define explicit exported tuning for any proposed general-track threshold/capacity increments, label them provisional. Pure helpers for tracking XP above troop level cap 12, stage-3 promotion eligibility, identity-preserving conversion into GeneralRecord, removal from exactly one source roster, capacity growth with hard cap, captive-to-recruit conversion. Preserve original troop id/name/species and map to its real species' general profile. Reject ineligible, duplicate, enemy-owned or missing references without mutation. No free troops, revival or troop count duplication. No UI or persistence changes.

Tests: stage/level/XP boundaries; XP overflow beyond existing troop cap; unique id/name/species retained; exact source removal; duplicate promotion rejected; valid actual catalog profile mapping; capacity cap; captive recruitment removes captive exactly once and respects ownership. Unsupported profile mappings must reject rather than invent a profile.

## Integration gates

Read worker diffs, run gates independently in their worktrees; exactly one independent spec reviewer and one quality reviewer per completed slice, fix confirmed findings then narrow re-review. Integrate onto mvp3 only after green gates, update PROGRESS.md with actual commits/counts and remaining integration limitations. Next: turn continuation/result replay, biome search, then playable map UI and save assembly. Existing Skirmish Campaign and Sandbox must remain intact.
