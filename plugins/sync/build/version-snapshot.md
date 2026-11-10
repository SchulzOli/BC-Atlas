# BC Atlas Sync - version build snapshot

Built 2026-11-10T20:01:15.3472891Z with AL compiler 18.1.43.24897 against Business Central symbols 26.5 (platform 26.0).

| App | Version | Result | Errors | Warnings | Info | Source fingerprint | .app SHA-256 |
|---|---|---|---:|---:|---:|---|---|
| BC Atlas Sync | 1.0.0.0 | compiled | 0 | 0 | 52 | `d888b5a81ce25ccc` (48 files) | `1ca673056f222360` |
| BC Atlas Sync Tests | 1.0.0.0 | compiled | 0 | 0 | 14 | `fb84636aea7eae1d` (15 files) | `29241b351d70ac7f` |

## Symbol packages

| File | Bytes | SHA-256 |
|---|---:|---|
| Microsoft_Application_26.5.38752.40541.app | 1815 | `f6728ff0d4abb5f8` |
| Microsoft_Base Application_26.5.38752.40541.app | 6390434 | `9a4ed00b702348ac` |
| Microsoft_Business Foundation_26.5.38752.40541.app | 26664 | `bfadb3bfe59796b8` |
| Microsoft_System Application_26.5.38752.40541.app | 314450 | `b1c6dff65775ab27` |
| System.app | 47044 | `f7dffeb265c8d8bd` |

## Analyzer diagnostics by rule

- **BC Atlas Sync:** AA0247 x47, AW0006 x5
- **BC Atlas Sync Tests:** AA0247 x14

## Documentation types in this build

- JSON Facts
- Technical Markdown
- User Guide Markdown
- Mermaid Sequence
- Object Inventory CSV
- Page Script YAML
- AL Test Codeunit
- Layered Markdown

## Recreate this build and session

1. `pwsh ./scripts/Build-AL.ps1 -SymbolVersion 26.5 -PlatformVersion 26.0`
2. `Publish build/*.app to a sandbox (app first, then tests); Atlas Sync Recordings > Create Demo Data`
3. `Atlas Sync Self-Test > Run All Tests`
4. `cd e2e; npm install; npx playwright install chromium; npm run login; npm run video`
