#!/usr/bin/env node
// Packages the extension as a .vsix with the BC Atlas engine inside:
//   1. npm pack the bc-atlas package (the repository root),
//   2. stage the extension with that tarball as its dependency,
//   3. install production dependencies and run vsce package.
// Usage: node scripts/package.js [--out <file.vsix>]
"use strict";

const { execFileSync } = require("node:child_process");
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const extension = path.resolve(__dirname, "..");
const repository = path.resolve(extension, "..");
const stage = path.join(extension, ".build");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

const manifest = JSON.parse(readFileSync(path.join(extension, "package.json"), "utf8"));
const engine = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
const outIndex = process.argv.indexOf("--out");
const out = path.resolve(outIndex > 0 ? process.argv[outIndex + 1] : path.join(extension, `${manifest.name}-${manifest.version}.vsix`));

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 1. The engine, exactly as it is published to npm.
run(npm, ["pack", "--ignore-scripts", "--pack-destination", stage], repository);
const tarball = readdirSync(stage).find((name) => name.endsWith(".tgz"));

// 2. The extension, depending on that tarball.
for (const item of ["src", "media", "README.md", "CHANGELOG.md"]) {
  if (existsSync(path.join(extension, item))) cpSync(path.join(extension, item), path.join(stage, item), { recursive: true });
}
cpSync(path.join(repository, "LICENSE"), path.join(stage, "LICENSE"));
cpSync(path.join(repository, "THIRD_PARTY_NOTICES.md"), path.join(stage, "THIRD_PARTY_NOTICES.md"));
const { devDependencies: _dev, scripts: _scripts, ...staged } = manifest;
writeFileSync(path.join(stage, "package.json"), `${JSON.stringify({ ...staged, dependencies: { "bc-atlas": `file:${tarball}` } }, null, 2)}\n`);

// 3. Production dependencies, without what the engine never loads: the
// explorer inlines 3d-force-graph's prebuilt browser bundle, so that
// library's own dependencies stay out, and D2 needs only its Node ESM build.
run(npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], stage);
const modules = path.join(stage, "node_modules");
const dependenciesOf = (name, seen = new Set()) => {
  const file = path.join(modules, name, "package.json");
  if (seen.has(name) || !existsSync(file)) return seen;
  seen.add(name);
  for (const dependency of Object.keys(JSON.parse(readFileSync(file, "utf8")).dependencies ?? {})) dependenciesOf(dependency, seen);
  return seen;
};
const needed = new Set();
for (const dependency of Object.keys(engine.dependencies)) {
  if (dependency !== "3d-force-graph") dependenciesOf(dependency, needed);
}
const browserOnly = [...dependenciesOf("3d-force-graph")].filter((name) => name !== "3d-force-graph" && !needed.has(name));
writeFileSync(path.join(stage, ".vscodeignore"), [
  tarball,
  "package-lock.json",
  "**/*.map",
  "**/*.d.ts",
  ...browserOnly.map((name) => `node_modules/${name}/**`),
  "node_modules/3d-force-graph/example/**",
  "node_modules/3d-force-graph/dist/3d-force-graph.js",
  "node_modules/@terrastruct/d2/dist/browser/**",
  "node_modules/@terrastruct/d2/dist/node-cjs/**"
].join("\n") + "\n");

// 4. The .vsix.
const vsce = path.join(extension, "node_modules", ".bin", process.platform === "win32" ? "vsce.cmd" : "vsce");
run(vsce, ["package", "--out", out], stage);
console.log(`Packaged ${path.relative(process.cwd(), out)} with bc-atlas ${engine.version}`);
