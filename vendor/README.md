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

## mcp-app.js

The adapter that lets the BC Atlas view run as an
[MCP App](https://github.com/modelcontextprotocol/ext-apps) in a chat
client: the MCP Apps SDK (`@modelcontextprotocol/ext-apps`, with the parts of
the MCP SDK and zod it needs) behind the interface of
`scripts/mcp-app-entry.js`. The MCP server inlines it into the page it serves
as `ui://bc-atlas/view.html`.

- Update command: `npm run update:mcp-app-vendor` (after updating the SDK or
  the entry)

## fonts/

Liberation Sans Regular and Bold (SIL Open Font License 1.1, see
`fonts/LICENSE-LiberationSans.txt`), which has the metrics of Arial and
Helvetica. PNG diagrams are rendered with it, and `src/diagram/metrics.js`
holds its glyph widths so SVG and PNG pictures size their boxes alike.

- Update command: `npm run update:font-metrics` (after replacing a font file)
