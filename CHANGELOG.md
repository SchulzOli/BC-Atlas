# Changelog

## 0.1.0 (unreleased)

- First version of bc-atlas-sync, the sync layer of BC Atlas (module API 1).
- Manifest (`sync` in `.bca.json`): sources (`fact-snapshots`, `atlas-model`), channels with what / when
  (BC Atlas triggers, conditions `always`, `changed`, `drift`) / how (formats `documents`, `facts`, `ui-tests`,
  `architecture`, `index`, `atlas-docs`).
- Engine: writes only changed files, removes files of processes that left the source, deterministic state file.
- Standalone CLI `bca-sync plan|run|status|describe`.
- Business Central side, formerly "TechSync Fact Snapshot", renamed to **BC Atlas Sync** (object prefix `BAS`):
  recorder, fact snapshots with phases, eight documentation types including the layered documentation and the
  BC Atlas UI test, demo data, AL tests with a self-test page, Playwright video run.
