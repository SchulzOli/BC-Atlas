# Roadmap

BC Atlas does two things: it **shows** the architecture of an AL project in
one view, and it **writes** its documentation, in sync with the source:
`bca layers` from the code, `bca docs` from the AL UI tests. `bca check`
guards both in CI. 0.28.0 cut it down to that core and made it dependable.

The two halves do not know each other yet. A page in the view does not know
the guides that use it, and a guide does not know the objects behind its
steps. The next releases join them into one atlas, then prove it on real
projects.

It is written for two readers: **AL developers**, who use the view in VS Code
and read the generated pages, and **AI agents**, which read a project through
the MCP tools and `bca view`.

Items are candidates, not commitments; open an issue to discuss priorities.

## Now: one atlas (0.29)

Done: the UI tests are read with the source, and what they document is part
of the one graph.

- **Guides in the graph.** Every documented scenario is a node, linked to the
  pages and actions its steps use. The Pages lens shows which pages have a
  guide, the inspector of a page lists its guides, and a story walks through
  a journey on the graph.
- **Coverage is a finding.** An opt-in health rule reports pages without a
  guide and UI tests without documentation, in `bca check`, SARIF, the
  Problems panel, and Check in the view.
- **The pages link to each other.** The object page of `bca layers` lists the
  guides of a page; a guide links to the layer page of each page it uses.
- **Agents get the same.** `bc_atlas_inspect` and `bc_atlas_view` return the
  scenarios of an object, so an agent can answer "how does a user do this?"
  from the source.
- **Loose ends of 0.28.0.** The release warns when Open VSX is skipped, and
  the Open VSX workflow publishes a release there once `OVSX_PAT` is set.

Done when: the warehouse example shows its guides on the Pages lens, and a
page without a guide is a finding.

## Next: proven on real projects

Done, measured in CI on Microsoft's BCApps (System Application, Business
Foundation, and the Test Framework, at a pinned commit; `scripts/bcapps.js`):

- **Resolution you can trust.** 75.5 % of the references resolve, with a
  floor that fails the build. Every reference to an object in the source
  resolves; what does not points at the platform's System app, whose symbols
  are not in the repository, and the job names it.
- **Microsoft's UI tests as input.** 69 of 333 UI tests become a guide, with
  a floor. The others have no `[SCENARIO]`; BC Atlas reads their steps.
  Tests of different codeunits with the same name made the corpus invalid on
  BCApps, so no guide could be generated; they are told apart now.
- **A first draft of the tags.** `bca docs suggest` drafts a `[SCENARIO]` and
  a `[WHEN]` of an untagged UI test from its steps; `--write` makes it a
  guide, to refine with `docs set`.

## Later: documentation people use

Done:

- **The exported view for a whole team.** `bca export --open` makes the file
  open at a journey or a user guide, not only at a lens.

What comes after is open: open an issue with what you need.

## Not planned

Removed on purpose, and not coming back without a new reason:

- A target architecture: proposals, components, layers, baselines.
- Running the AL compiler or its code analyzers.
- A history of the documentation by commit or release, and trend reports.
- Diagram views beside the lenses, and D2 or PDF output.
- The Markdown report and the knowledge graph (RDF, OWL): `bca layers`
  documents a repository.
