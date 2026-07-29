# Vendored parser artifact

`tree-sitter-al.wasm` is built and published by
[`SShadowS/tree-sitter-al`](https://github.com/SShadowS/tree-sitter-al).

- Pinned version: `v3.0.1`
- License: MIT
- Update command: `npm run update:grammar -- vX.Y.Z`

The binary is vendored so users do not need a Rust/C++ compiler or a network
request at runtime. When updating it, run the full AST fixture test suite and
update the pinned version above.
