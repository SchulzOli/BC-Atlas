// Bundles the staged extension with esbuild, so the .vsix holds a handful of
// JavaScript files instead of every module of the engine and its
// dependencies (zod and the MCP SDK alone are about 800 files):
//
//   dist/extension.js           the extension (CommonJS, `vscode` external)
//   bc-atlas/src/<entry>.js     each engine entry the extension starts, in place
//
// Engine modules read assets next to themselves (`new URL("./ui/app.css",
// import.meta.url)`). In a bundle, import.meta.url is the bundle's URL, so the
// plugin below points each of those URLs back at the module's original
// location; the assets stay where they are.
"use strict";

const { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

// Started by the extension (worker, page, CLI, MCP server) or by the engine (update check).
const ENGINE_ENTRIES = ["src/cli.js", "src/mcp.js", "src/app/worker.js", "src/app/page.js", "src/update-worker.js"];
// Browser scripts and styles the engine inlines into pages; they are read, not imported.
const ENGINE_ASSETS = ["src/app/ui/", "src/graph/viewer/", "src/ui/"];
// Load files relative to themselves (the wasm of resvg and tree-sitter), so
// they stay as they are. The 3D explorer's browser bundle and the diagram
// font are in vendor/.
const EXTERNAL = ["@resvg/resvg-wasm", "web-tree-sitter"];

const toPosix = (value) => value.split(path.sep).join("/");

/** `new URL(x, import.meta.url)` and `createRequire(import.meta.url)` in a module keep meaning "next to this module". */
function moduleUrls(outputDirectory) {
  return {
    name: "module-urls",
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`) && !args.path.includes(`${path.sep}bc-atlas${path.sep}`)) return undefined;
        const source = readFileSync(args.path, "utf8");
        if (!source.includes("import.meta.url")) return undefined;
        let relative = toPosix(path.relative(outputDirectory, args.path));
        if (!relative.startsWith(".")) relative = `./${relative}`;
        const original = `new URL(${JSON.stringify(relative)}, import.meta.url).href`;
        const contents = source
          .replace(/(new URL\([^()]*?,\s*)import\.meta\.url(\s*\))/gu, `$1${original}$2`)
          .replace(/createRequire\(\s*import\.meta\.url\s*\)/gu, `createRequire(${original})`);
        return { contents, loader: "js" };
      });
    }
  };
}

function walk(directory, visit) {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) walk(file, visit);
    else visit(file);
  }
}

/** Bundles the engine entries in place and removes the modules they now contain. */
async function bundleEngine(engine) {
  const outputs = [];
  for (const entry of ENGINE_ENTRIES) {
    const file = path.join(engine, entry);
    const outfile = `${file}.bundle`;
    await esbuild.build({
      entryPoints: [file],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      minify: true,
      legalComments: "eof",
      external: EXTERNAL,
      logLevel: "warning",
      // CommonJS dependencies (graphology, ...) call require.
      banner: { js: 'import{createRequire as __bcaRequire}from"node:module";const require=__bcaRequire(import.meta.url);' },
      plugins: [moduleUrls(path.dirname(file))]
    });
    outputs.push([outfile, file]);
  }
  for (const [outfile, file] of outputs) renameSync(outfile, file);

  const keep = new Set(ENGINE_ENTRIES.map((entry) => path.join(engine, entry)));
  walk(path.join(engine, "src"), (file) => {
    const relative = toPosix(path.relative(engine, file));
    if (file.endsWith(".js") && !keep.has(file) && !ENGINE_ASSETS.some((prefix) => relative.startsWith(prefix))) rmSync(file);
  });
}

function rewriteManifest(file, change) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, `${JSON.stringify(change(manifest), null, 2)}\n`);
}

/**
 * Removes the dependencies the bundles contain and keeps the external ones.
 * The manifests then list only what is left, so vsce's dependency detection
 * (npm list) packs exactly these packages.
 */
function pruneDependencies(modules) {
  for (const name of readdirSync(modules)) {
    if (name === ".bin" || name === ".package-lock.json") {
      rmSync(path.join(modules, name), { recursive: true, force: true });
      continue;
    }
    const scoped = name.startsWith("@") ? readdirSync(path.join(modules, name)).map((child) => `${name}/${child}`) : [name];
    for (const dependency of scoped) {
      if (dependency === "bc-atlas" || EXTERNAL.includes(dependency)) continue;
      rmSync(path.join(modules, dependency), { recursive: true, force: true });
    }
    if (name.startsWith("@") && existsSync(path.join(modules, name)) && !readdirSync(path.join(modules, name)).length) {
      rmSync(path.join(modules, name), { recursive: true, force: true });
    }
  }
  rewriteManifest(path.join(modules, "bc-atlas", "package.json"), (manifest) => ({
    ...manifest,
    dependencies: Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => EXTERNAL.includes(name)))
  }));
  // The external packages load their own prebuilt files; their dependencies are not needed.
  for (const name of EXTERNAL) {
    rewriteManifest(path.join(modules, name, "package.json"), ({ dependencies: _dependencies, peerDependencies: _peers, optionalDependencies: _optional, ...manifest }) => manifest);
  }
}

/** Bundles the extension into dist/extension.js; the engine stays a package it starts. */
async function bundleExtension(stage) {
  await esbuild.build({
    entryPoints: [path.join(stage, "src", "extension.js")],
    outfile: path.join(stage, "dist", "extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    minify: true,
    external: ["vscode", "bc-atlas"],
    logLevel: "warning"
  });
  rmSync(path.join(stage, "src"), { recursive: true, force: true });
}

async function bundle(stage) {
  const modules = path.join(stage, "node_modules");
  await bundleEngine(path.join(modules, "bc-atlas"));
  pruneDependencies(modules);
  await bundleExtension(stage);
}

module.exports = { bundle, ENGINE_ENTRIES, EXTERNAL };
