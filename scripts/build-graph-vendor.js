#!/usr/bin/env node
// Builds vendor/graph-viewer.js: the 3d-force-graph browser bundle together
// with the parts of three.js the explorer uses directly (bloom), so
// both share one three.js. Run after updating 3d-force-graph or three:
//   npm run update:graph-vendor
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = `
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
window.ForceGraph3D = ForceGraph3D;
window.BCA_THREE = { ...THREE, UnrealBloomPass, ShaderPass };
`;

await build({
  stdin: { contents: entry, resolveDir: root, loader: "js" },
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  legalComments: "eof",
  outfile: path.join(root, "vendor", "graph-viewer.js")
});
console.log("Wrote vendor/graph-viewer.js");
