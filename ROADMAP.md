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

The UI tests are read with the source, and what they document is part of the
one graph.

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
- **Loose ends of 0.28.0.** Open VSX receives the extension (the release step
  passed without publishing).

Done when: the warehouse example shows its guides on the Pages lens, and a
page without a guide is a finding.

## Next: proven on real projects

Measured on Microsoft's BCApps, as the performance is today.

- **Resolution you can trust.** The share of references BC Atlas resolves is
  measured in CI on BCApps, with a floor that fails the build; every kind of
  reference it misses is a known, tracked case.
- **Microsoft's UI tests as input.** The share of BCApps UI tests that become
  a guide is measured; the patterns that do not yet (handlers, helpers,
  libraries) are read.
- **A first draft of the tags.** `bca docs` proposes the tags of an untagged
  UI test (`[SCENARIO]`, `[WHEN]`, `[THEN]` from its steps), as a dry run to
  accept with `docs set`, so a team does not start from an empty page.

## Later: documentation people use

- The view in the browser for a whole team: the exported file opens at a
  guide or a journey, not only at a lens.

## Not planned

Removed on purpose, and not coming back without a new reason:

- A target architecture: proposals, components, layers, baselines.
- Running the AL compiler or its code analyzers.
- A history of the documentation by commit or release, and trend reports.
- Diagram views beside the lenses, and D2 or PDF output.
- The Markdown report and the knowledge graph (RDF, OWL): `bca layers`
  documents a repository.
