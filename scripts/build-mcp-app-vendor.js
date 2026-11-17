#!/usr/bin/env node
// Builds vendor/mcp-app.js: the MCP Apps SDK (@modelcontextprotocol/ext-apps) behind the
// interface of scripts/mcp-app-entry.js, so that the BC Atlas view runs as an MCP App in a
// chat client. The MCP server inlines it into the page it serves. Run after updating the SDK:
//   npm run update:mcp-app-vendor
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [path.join(root, "scripts", "mcp-app-entry.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "eof",
  define: { "process.env.NODE_ENV": "\"production\"" },
  outfile: path.join(root, "vendor", "mcp-app.js")
});
console.log("Wrote vendor/mcp-app.js");
