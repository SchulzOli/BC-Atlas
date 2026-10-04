# Roadmap

Planned work, grouped by feature area. Items are candidates, not commitments;
open an issue to discuss priorities.

## Analyze

- Detect namespace/folder disagreement and surface it as a diagnostic.
- Health rules for unused interfaces, unreachable procedures, and excessive
  module coupling.
- Trend reporting: compare `bca check --format json` results between commits.
- Transaction-boundary risks: writes after explicit commits and partial
  processing paths.

## Visualize

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

- Cache parsed files by content hash for `watch`.
- Reparse only changed files and re-resolve affected symbols.
- Benchmark a 300+ file app and record peak memory of the AL and D2 workers.
- Snapshot tests for every grouping mode and deterministic stress tests with
  edge-density limits.
