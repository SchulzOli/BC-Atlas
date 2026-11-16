#!/usr/bin/env node
// Builds vendor/flow-canvas.js and vendor/flow-canvas.css: React Flow (@xyflow/react) with
// React, behind the interface of scripts/flow-canvas-entry.js. The view of BC Atlas inlines
// both, so the builder works offline in every exported HTML file. Run after updating
// @xyflow/react, react, or react-dom:
//   npm run update:flow-vendor
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "scripts", "flow-canvas-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "eof",
  define: { "process.env.NODE_ENV": "\"production\"" },
  outfile: path.join(root, "vendor", "flow-canvas.js")
});
console.log("Wrote vendor/flow-canvas.js and vendor/flow-canvas.css");
