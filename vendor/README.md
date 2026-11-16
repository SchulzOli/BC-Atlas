# Vendored artifacts

## tree-sitter-al.wasm

`tree-sitter-al.wasm` is built and published by
[`SShadowS/tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al).

- Pinned version: `v3.0.1`
- License: MIT
- Update command: `npm run update:grammar -- vX.Y.Z`

The binary is vendored so users do not need a Rust/C++ compiler or a network
request at runtime. When updating it, run the full AST fixture test suite and
update the pinned version above.

## graph-viewer.js

The browser bundle of the 3D dependency explorer: 3d-force-graph together
with three.js and its bloom pass, so the explorer and the library share one
three.js. Built from the versions in `package.json` (`3d-force-graph`,
`three`, both MIT).

- Update command: `npm run update:graph-vendor` (after updating either package)

It is vendored so the explorer works offline in every exported HTML file
without a build step at install time.

## flow-canvas.js, flow-canvas.css

The canvas of the flow builder: [React Flow](https://reactflow.dev)
(`@xyflow/react`) with React and React DOM (all MIT), behind the small
interface of `scripts/flow-canvas-entry.js`. The view inlines both files, so
the builder works offline in VS Code and in every exported HTML file.

- Update command: `npm run update:flow-vendor` (after updating one of the
  packages or the entry)

## fonts/

Liberation Sans Regular and Bold (SIL Open Font License 1.1, see
`fonts/LICENSE-LiberationSans.txt`), which has the metrics of Arial and
Helvetica. PNG diagrams are rendered with it, and `src/diagram/metrics.js`
holds its glyph widths so SVG, PNG, and PDF diagrams size their boxes alike.

- Update command: `npm run update:font-metrics` (after replacing a font file)
