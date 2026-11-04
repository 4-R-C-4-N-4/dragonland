# MVP3 strategic-order policy slice

Baseline: mvp3 after promotion helpers, 582 tests. Integration target mvp3 only.

Goal: deterministic, read-only AI order planning over existing divisions; no army restructuring or admin spending yet. This bounded slice can proceed independently of battle sequencing.

Owned: src/ai/strategy.ts, tests/ai/strategy.test.ts. Public APIs visibleNodes(war,factionId): Set<string> and planFactionOrders(war,factionId): WorldOrder[]. No other files.

Visibility is owned/occupied nodes plus adjacent nodes. Node ownership/map topology is public; only division information is fogged. Decisions must not read enemy division/general strength outside visibility. Toggling an invisible enemy's position/strength within still-invisible territory must not affect orders. Own generals and troops may be inspected.

Return exactly one legal march/rest/hold order per nonempty owned division, stable id order. No commands during battle/admin/terminal phases. No mutation (including internal RNG, pending orders or events). Deterministic seed/turn/faction-salted tie breaks from shared sim PRNG; no Math.random/Date/browser imports. Pass returned orders through existing issueOrder to commit; planner does not resolve turns.

Aggressive: advance toward hostile castles along shortest graph routes. Defensive: prioritize visibly threatened friendly castles; otherwise consolidate and advance. Opportunist: prefer accessible undefended visible economic nodes, avoid visibly superior hostile divisions, otherwise advance toward objectives. Injured/depleted forces rest at friendly supply nodes when meaningful, otherwise seek friendly supply. Every march is one adjacent edge, never teleport. No free recruits or HP. Exact thresholds live in an exported, explicitly provisional tuning object.

TDD then full gates: npm run check && npm run build. Tests independently cover each personality, legal adjacency, exactly one order, insertion-order invariance, same seed determinism, no mutation, invisible enemy invariance, visible danger response, friendly-rest versus neutral-node behavior and phase blocking. Use real createWar fixtures; no fabricated engine outputs. Review spec and quality before integration. Explicit deferrals: division composition, garrison transfers, captive recruitment/admin economy, end-to-end autonomous war victory.
