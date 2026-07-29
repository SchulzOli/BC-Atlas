#!/usr/bin/env node

import fs from "node:fs/promises";

const tag = process.argv[2] ?? "v3.0.1";
if (!/^v\d+\.\d+\.\d+$/u.test(tag)) {
  console.error("Usage: npm run update:grammar -- vX.Y.Z");
  process.exit(2);
}

const url =
  `https://raw.githubusercontent.com/SShadowS/tree-sitter-al/${tag}/tree-sitter-al.wasm`;
const destination = new URL("../vendor/tree-sitter-al.wasm", import.meta.url);
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
await fs.mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
await fs.writeFile(destination, bytes);
console.log(`Updated vendor/tree-sitter-al.wasm from ${tag} (${bytes.length} bytes)`);
