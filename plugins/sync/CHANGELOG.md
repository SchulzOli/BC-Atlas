# Changelog

## 0.2.0 (unreleased)

- Built into BC Atlas as the plugin `sync` (plugin API 1, `plugins/sync`), imported with the history of the
  former bc-atlas-sync repository. No installation or `modules` entry needed.
- `activate(context)` replaces the module object; services come from the plugin context.
- New: health rule `sync-outdated` (bca check), MCP tool `bc_atlas_sync_status`, command `bca sync describe`.
- New extension points `sync.sources` and `sync.formats`: other plugins add source types (what) and formats (how).
- Removed: the standalone CLI `bca-sync`; use `bca sync`.

## 0.1.0

- First version of bc-atlas-sync, the sync layer of BC Atlas (module API 1).
- Manifest (`sync` in `.bca.json`): sources (`fact-snapshots`, `atlas-model`), channels with what / when
  (BC Atlas triggers, conditions `always`, `changed`, `drift`) / how (formats `documents`, `facts`, `ui-tests`,
  `architecture`, `index`, `atlas-docs`).
- Engine: writes only changed files, removes files of processes that left the source, deterministic state file.
- Standalone CLI `bca-sync plan|run|status|describe`.
- Business Central side, formerly "TechSync Fact Snapshot", renamed to **BC Atlas Sync** (object prefix `BAS`):
  recorder, fact snapshots with phases, eight documentation types including the layered documentation and the
  BC Atlas UI test, demo data, AL tests with a self-test page, Playwright video run.
