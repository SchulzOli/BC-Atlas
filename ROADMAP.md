# Roadmap

BC Atlas does two things: it **shows** the architecture of an AL project in
one view, and it **writes** the documentation of the repository, in sync with
the source. `bca check` guards it in CI. The roadmap is about making that
small core dependable before it grows again.

It is written for two readers: **AL developers**, who use the view in VS Code
and read the generated pages, and **AI agents**, which read a project through
the MCP tools and `bca view`.

Items are candidates, not commitments; open an issue to discuss priorities.

## Now: make what is left dependable

No new features. Each item closes a gap that is known today.

- **Release 0.28.0.** The cut is a breaking change: publish it as one release
  with the changelog as the migration note.
- **The view is tested in a browser, in CI.** The test that opens the exported
  view, every menu, and every lens exists, but skips where Playwright is not
  installed. Install Chromium in one CI job so a broken page fails the build.
- **Undeclared app dependencies are a finding.** An app that uses another
  without naming it in `app.json` shows in the Apps lens, but `bca check`
  passes. Add a health rule for it, and one for references that are in no app
  and no symbol package.
- **The same source gives the same output on every system.** Paths are made
  uniform in one place, where the model is read, and a test compares the
  pages of `bca layers` between Windows and Linux.
- **What agents are told is true.** A test checks that the descriptions of the
  MCP tools and the command catalog name only lenses, stories, and options
  that exist, so they cannot go stale again.
- **Loose ends of the cut.** The row "unresolved (unresolved)" in the apps
  table of `bca layers`; `types` in `.bca.json`, which is read but not in the
  schema; `bca export -o -`, which writes a file named `-`.

Done when: 0.28.0 is published, CI runs the browser test, and none of the
items above is open.

## Next: fast and small enough to trust

- **Re-resolve only what a changed file affects.** Parsing is incremental
  already; resolution is not. On a workspace the size of the Base
  Application this is what makes the view follow the editor.
- **Performance is measured in CI.** `scripts/benchmark.js` records time and
  peak memory, and a regression fails the build.
- **Answers that fit an agent's context.** `bc_atlas_inspect` returns the
  whole model; give it a limit and a way to ask for a part. A published
  schema for what `bca view --format json` returns, with a version.
- **Large files are split along their seams.** `src/analyzer.js` (1,600
  lines) and `src/app/ui/graph.js` (1,500 lines) are the two files a
  contributor cannot read in one sitting.
- **The overview of a large app.** Above 48 objects it shows areas; check that
  they are the right ones on real projects, and that every area leads on.

## Later: documentation from AL UI tests

`bca docs` stays as it is until the core is done. Then:

- End-to-end journeys that combine several UI tests into one business process.
- Indexes by feature, role, page, and permission.
- Coverage: UI tests without documentation, and pages without a guide.
- `[MONITOR]`, `[RECOVERY]`, and `[TROUBLESHOOT]` tags for support runbooks.

## Not planned

Removed on purpose, and not coming back without a new reason:

- A target architecture: proposals, components, layers, baselines.
- Running the AL compiler or its code analyzers.
- A history of the documentation by commit or release, and trend reports.
- Diagram views beside the lenses, and D2 or PDF output.
