# Roadmap

Planned work, grouped by feature area. Items are candidates, not commitments;
open an issue to discuss priorities.

## Analyze

- Detect namespace/folder disagreement and surface it as a diagnostic.
- Health rules for unused interfaces, unreachable procedures, and excessive
  module coupling.
- Transaction-boundary risks: writes after explicit commits and partial
  processing paths.

- Battle test: follow interface calls to their implementations, check
  application areas and entitlements, and compare two runs (which role lost or
  gained a task).
- Battle test: hand each agent's tasks to an AI agent that performs them in a
  sandbox (page scripting), with the simulated result as the expectation.

## Visualize

- More dependency explorer lenses with the same timeline and filters: calls, data
  access, events, contracts, UI navigation, and permissions.
- Explorer: compare two commits side by side and blame an edge to the commit
  that introduced it.

- Configurable folder aliases and ignored structural folders such as
  `Contract`, `PageExt`, or `Substeps`.
- App-level grouping for multi-app workspaces.
- Stable module IDs when namespace depth changes.
- Automatic aggregation above a member or edge threshold.

## Document

- End-to-end journeys that combine several UI tests into one business process.
- Generated indexes by feature, role, page, and permission.
- A navigation diagram of guide prerequisites (`[REQUIRES]`, `[NEXT]`).
- `[MONITOR]`, `[RECOVERY]`, and `[TROUBLESHOOT]` tags for support runbooks.
- Coverage reporting: UI tests without documentation and pages without guides.
- Optional screenshots for guide steps. Capture must stay opt-in and consume the
  AL-derived contract without becoming a second authoritative test.

## Performance

- Re-resolve only the symbols a changed file affects (parsing is already
  incremental).
- Record peak memory in `scripts/benchmark.js`, and run it in CI to catch
  regressions.
- Snapshot tests for every grouping mode and deterministic stress tests with
  edge-density limits.
