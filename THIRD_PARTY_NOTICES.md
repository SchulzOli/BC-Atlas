# Third-party notices

## tree-sitter-al

Copyright Torben Leth and contributors. Licensed under the MIT License.
Source: <https://github.com/SShadowS/tree-sitter-al>

The compiled `vendor/tree-sitter-al.wasm` artifact is redistributed by this
project.

## web-tree-sitter

Copyright Tree-sitter contributors. Licensed under the MIT License.
Source: <https://github.com/tree-sitter/tree-sitter>

## ELK (elkjs)

Copyright Kiel University and others. Licensed under the Eclipse Public License
2.0 (or, at your option, GPL-3.0-or-later). Source: <https://github.com/kieler/elkjs>

`elkjs` lays out the diagram views (layered layout, routes, and labels).

## resvg (@resvg/resvg-wasm)

Copyright the resvg authors. Licensed under the Mozilla Public License 2.0.
Source: <https://github.com/yisibl/resvg-js>

The resvg WebAssembly package is an npm dependency that turns diagrams into
PNG files.

## Liberation Sans

Digitized data copyright (c) 2010 Google Corporation; copyright (c) 2012 Red
Hat, Inc. Licensed under the SIL Open Font License 1.1. Source:
<https://github.com/liberationfonts/liberation-fonts>

`vendor/fonts/LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf` are
redistributed (license in `vendor/fonts/LICENSE-LiberationSans.txt`): PNG files
are rendered with them, and their glyph widths size the boxes of every
diagram.

## 3d-force-graph and three.js

3d-force-graph: Copyright Vasco Asturiano. three.js: Copyright three.js
authors. Both licensed under the MIT License. Sources:
<https://github.com/vasturiano/3d-force-graph>, <https://github.com/mrdoob/three.js>

A browser bundle of 3d-force-graph and three.js (including its bloom pass),
`vendor/graph-viewer.js`, is embedded in the explorer HTML files written by
`bca export` and shown by the VS Code extension.

## React Flow, React, and zustand

React Flow (`@xyflow/react`, `@xyflow/system`): Copyright webkid GmbH. React
and React DOM: Copyright Meta Platforms, Inc. and affiliates. zustand:
Copyright Paul Henschel. d3-drag, d3-zoom, d3-selection, and the d3 modules
they use: Copyright Mike Bostock (ISC License). The others are licensed under
the MIT License. Sources: <https://github.com/xyflow/xyflow>,
<https://github.com/facebook/react>, <https://github.com/pmndrs/zustand>,
<https://github.com/d3>

A browser bundle of them, `vendor/flow-canvas.js` with `vendor/flow-canvas.css`,
is the canvas of the flow builder: it is embedded in the BC Atlas view shown
by the VS Code extension and in the HTML files written by `bca export --view app`.

## graphology

Copyright Guillaume Plique (Yomguithereal). Licensed under the MIT License.
Source: <https://github.com/graphology/graphology>

`graphology`, `graphology-metrics`, and `graphology-communities-louvain` build
the graph model of the dependency explorer and compute its metrics.
