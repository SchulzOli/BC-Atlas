# BC Atlas Sync - Unit test mapping

Which test proves which claim, at which level, and what only a live tenant can prove.

| Level | Where | Runs on | Status |
|---|---|---|---|
| **Static** | `scripts/Build-AL.ps1` | this machine, real BC 26.5 symbols | ✅ app + tests compile, 0 errors, 0 warnings ([version snapshot](../build/version-snapshot.md)) |
| **Unit / integration** | `al/test/` (7 test codeunits, 36 tests) | BC sandbox: AL Test Tool, or **Atlas Sync Self-Test** page | ⏳ not run yet (needs a sandbox) |
| **BC Atlas compatibility** | BC Atlas CLI (checkout next to this repository) | Node | ✅ generated-shape UI test validates and renders (guide, use case, BPMN) |
| **Architecture format** | `src/formats/architecture.js` | Node 20+ | ✅ run against the real *Base Application* BC Atlas: all objects of the demo mapped, Sales (31) → Finance (20), no layer violations ([output](../examples/demo-architecture.md)) |
| **Sync engine** | `test/basics.test.js`, `test/engine.test.js`, `test/module.test.js` (21 tests) | Node 20+ | ✅ all pass: manifest validation, triggers, conditions `changed`/`drift`, dry run, determinism, cleanup, filters, host interface, CLI |
| **Module in BC Atlas** | `test/atlas-integration.test.js` + BC Atlas `test/modules.test.js` (9 tests) | Node, BC Atlas `feat/bc-atlas-sync` | ✅ real BC Atlas loads the module, analyzes an AL app for the model, renders the synced UI test; `bca run --tasks sync` reports the outputs; BC Atlas full suite 286 pass, 0 fail |
| **End to end + video** | `e2e/` (Playwright) | browser against a BC sandbox | ⏳ not run yet (dependencies installed; needs sign-in and the published apps) |

Run the AL tests without Microsoft's test framework apps: publish `build/*.app` (app first), assign **BAS TEST**, open **Atlas Sync Self-Test**, choose **Run All Tests**. Every test codeunit runs in its own transaction and is rolled back.

## Requirement → test

### R1 Record every click of a process

| Claim | Test | Level |
|---|---|---|
| A Page Scripting recording becomes one UI step per click, with page, part, control caption and value | `BAS Test Page Script Import` · `ImportsEveryClickWithCaptionsValuesAndParts` | unit |
| Captions shown to the user (`<caption>` tags) win over internal names; tags are stripped from descriptions | same | unit |
| Re-import replaces clicks instead of appending | `ReimportReplacesClicks` | unit |
| A file without steps is rejected | `FileWithoutStepsIsRejected` | unit |
| The clicks recorded in the real web client import correctly | `e2e/tests/atlas-sync-recording.spec.ts` step 7 (fixture `e2e/fixtures/sales-order-post.yml`) | E2E |

### R2 Record the whole line of call stacks over time

| Claim | Test | Level |
|---|---|---|
| Quoted, unquoted, parenthesised and extension object names parse; app and publisher are extracted | `BAS Test Call Stack Parser` · `ParsesQuotedTriggerLine`, `ParsesNamesWithParenthesesAndUnquotedNames` | unit |
| The recorder's own frames (Atlas Sync, GlobalTriggerManagement, system) are skipped; frame 1 = writer, last = origin | `SkipsRecorderFramesAndNumbersFromInnermost` | unit |
| Backslash-separated stacks are accepted | `AcceptsBackslashSeparatedStacks` | unit |
| Origin (trigger the user fired) and writer are annotated; client writes are "Page Autosave" | `AnnotatesOriginAndWriter`, `WriteWithoutAlCodeIsPageAutosave` | unit |
| Triggers are classified (Action, Field Validation, Lookup, Page Trigger, Codeunit Run, Code) | `ClassifiesTriggersAndSubjects` | unit |
| A live recording buffers writes with `SessionInformation.Callstack()` and persists them with frames on Stop; markers keep their place | `BAS Test Recorder` · `RecordsWritesWithCallStackAndMarkers` | integration |
| Own tables, system tables and the exclusion filter are not tracked (no recursion) | `OwnAndSystemTablesAreNotTracked` | unit |
| Recording refuses to start when the recorder is not armed | `StartFailsWhenRecorderIsNotEnabled` | unit |
| Temporary records are ignored; the event limit stops buffering and is flagged | `TemporaryRecordsAndLimitAreRespected` | unit |
| Sampling profiler output (.alcpuprofile) becomes a call tree with parents, depth and hits | `BAS Test Profiler Import` · `LoadsCallTreeWithParentsDepthAndHits`, `InvalidProfileIsRejected` | unit |
| Global database triggers fire for real writes in the recording session only | `e2e` steps 2-6 (posts a real sales order) | E2E |

### R3 Create an Atlas Sync Fact Snapshot

| Claim | Test | Level |
|---|---|---|
| Consecutive writes of one trigger form one technical step with call path and data footprint | `BAS Test Snapshot Builder` · `GroupsWritesIntoTechnicalStepsByTrigger` | integration |
| Each click is linked to the step it triggered (caption → AL control/action name) | `LinksEachClickToTheStepItTriggered` | integration |
| Steps are grouped into business phases (data entry vs. action; markers when present) | `GroupsStepsIntoBusinessPhases`, `MarkersDefinePhasesWhenPresent` | integration |
| Same process → same fingerprint, compared with the previous snapshot, no drift | `SameProcessGivesSameFingerprintAndNoDrift` | integration |
| A new extension subscriber and table are reported as drift (added, nothing removed) | `ExtensionSubscriberIsReportedAsDrift` | integration |
| The fingerprint depends on kinds of writes, not record counts | `FingerprintIgnoresRecordCounts` | integration |
| A running recording cannot be snapshotted | `RecordingStillRunningCannotBeSnapshotted` | unit |

### R4 Documentation in all types, in layers down to the clicks

| Claim | Test | Level |
|---|---|---|
| Every value of the extensible enum `BAS Doc Type` produces a document | `BAS Test Doc Generation` · `EveryDocumentationTypeIsGenerated` | integration |
| Layered document L0 use case → L1 map → L2 phases → L3 steps → L4 clicks → L5 code → L6 data, cross-linked | `LayeredDocumentGoesFromUseCaseDownToClicks` | integration |
| BC Atlas UI test: `[FEATURE]`, `[DOC-ID]`, `[SCENARIO]`, one `[WHEN]` per phase, `[THEN]` results, TestPage calls with exact names | `BcAtlasUiTestFollowsTheTagConvention` | integration |
| JSON fact sheet is valid and complete (phases, clicks, call stacks, feature) | `JsonFactSheetIsValidAndComplete` | integration |
| Sequence diagram, CSV inventory, Page Script, user guide, technical doc have their structure | `OtherFormatsHaveTheirStructure` | integration |
| `bca docs generate` accepts the generated UI test | ✅ BC Atlas CLI on [examples/BASUITestDemoPostSalesOrder.Codeunit.al](../examples/BASUITestDemoPostSalesOrder.Codeunit.al) (hand-written in the generator's exact shape): `docs validate` → valid, `docs generate --export markdown,bpmn` → [guide, use case, BPMN](../examples/atlas-docs/) with both phases as steps, every click as a sub-step and the phase result | tool |
| Architecture layer above L0: components, layers, layer-rule check | `src/formats/architecture.js` on `examples/demo-facts.json` | tool |
| Download All (ZIP) works in the browser | `e2e` step 8 | E2E |

### R5 Recreate this session

| Claim | Test | Level |
|---|---|---|
| Demo data recreates two versions, snapshots and all documents | every `BAS Test Snapshot Builder` / `Doc Generation` test uses `BAS Demo Data` | integration |
| The build is reproducible: compiler, symbol and source fingerprints recorded | `scripts/Build-AL.ps1` → `build/version-snapshot.json` | static |

## Text helpers (supporting)

`BAS Test Text Helper`: `KebabIdIsLowercaseHyphenated`, `IdentifierIsPascalCaseAndStartsWithLetter`, `FileSafeReplacesSpecialCharacters`, `MarkdownAndCsvEscaping`, `UnquoteAndTags`, `SplitLinesHandlesAllLineEndings`, `TruncateAddsEllipsis`.

## Only a live tenant can prove

- The exact text format of `SessionInformation.Callstack()` in your BC version (the parser tests use the documented format; `RecordsWritesWithCallStackAndMarkers` checks it live).
- That the platform asks `OnAfterGetDatabaseTableTriggerSetup` once per session (sign out/in after enabling).
- Caption → name resolution against real page metadata (`BAS UI Name Resolver`), and that BC Atlas accepts the quoted control names.
- The BC web client DOM the Playwright test relies on (see `e2e/README.md`).
