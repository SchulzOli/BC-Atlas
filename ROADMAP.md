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

Done so far: the browser test of the view runs in CI, an undeclared app
dependency is a finding, the same source gives the same output on Windows and
Linux, a test keeps what the command catalog and the MCP tools say true, and
the loose ends of the cut are tied.

Done when: 0.28.0 is published.

## Next: fast and small enough to trust

Done, measured on Microsoft's BCApps (System Application and Business
Foundation, 1,441 AL files):

- **The view follows the editor.** Resolution was never the cost (about
  60 ms); the work around it was. From a saved file to an updated view now
  takes under a second, where it took about two.
- **Performance is measured in CI.** Time and peak memory of `check`,
  `layers`, `export`, and a save, for a pull request and its base on the same
  machine; a regression fails the build.
- **Answers that fit an agent's context.** `bc_atlas_inspect` returns a page
  of the model, about 200 KB where the whole model is 54 MB, and every JSON
  document names its shape and version (`schemas/output.schema.json`).
- **Large files are split along their seams.** No module of the analyzer or
  the graph is longer than 600 lines.
- **The overview of a large app.** Every area leads on: a namespace to its
  objects, the rest to the Modules lens, other apps to the Apps lens. A
  namespace too large for areas opens to its objects, and a namespace of
  several apps is an area per app.

## Later: documentation from AL UI tests

Done: `bca docs` documents a business process, not only a test.

- **End-to-end journeys.** Scenarios with the same `[JOURNEY]` are one page,
  stage by stage, in the order of their `[REQUIRES]` and `[NEXT]` links.
- **Indexes by feature, role, page, and permission.** `[ROLE]` names who
  performs a scenario.
- **Coverage.** The UI tests without documentation, and the pages without a
  guide, in the index and in `bca docs validate`.
- **Support runbooks.** `[MONITOR]`, `[RECOVERY]`, and `[TROUBLESHOOT]` give a
  guide a support section and the documentation a `runbook.md`.

## Not planned

Removed on purpose, and not coming back without a new reason:

- A target architecture: proposals, components, layers, baselines.
- Running the AL compiler or its code analyzers.
- A history of the documentation by commit or release, and trend reports.
- Diagram views beside the lenses, and D2 or PDF output.
- The Markdown report and the knowledge graph (RDF, OWL): `bca layers`
  documents a repository.
