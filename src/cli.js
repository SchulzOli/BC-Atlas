#!/usr/bin/env node

import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { analyze } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { renderD2 } from "./d2.js";
import { addInsights } from "./insights.js";
import { resolveModel } from "./resolver.js";
import { renderSvg } from "./svg.js";
import { createView, filterModel } from "./views.js";

const HELP = `ald2tree - generate architecture diagrams from AL source

Usage:
  ald2tree [graph] [options] <file-or-directory>
  ald2tree inspect [options] <file-or-directory>
  ald2tree watch [options] <directory>

Views:
  project (default)   AL objects grouped by namespace
  module              Aggregated namespace dependencies
  object              One object plus incoming/outgoing neighbors
  data                Tables and table-oriented dependencies
  call                Procedure and trigger call graph
  boundary            Dependencies crossing a selected scope
  contracts           Interfaces and direct/enum implementations
  events              Event publishers and subscribers
  ui                  Pages, source tables, parts, actions, and navigation

Options:
  -o, --output <path>       Output path (default: al-architecture.d2)
  -f, --format <format>     d2, json, svg, png, or pdf
      --view <view>         project, module, object, data, call, boundary,
                            contracts, events, or ui
      --object <selector>   Object selector, e.g. codeunit:50100
      --scope <selector>    Boundary scope: namespace:, folder:, app:, or
                            object: (repeatable)
      --focus <text>        Focus contracts, events, or UI on a matching name
      --namespace <glob>    Namespace filter (repeatable)
      --type <types>        Object type filter, comma-separated/repeatable
      --include <glob>      Include file/object glob (repeatable)
      --exclude <glob>      Exclude file/object glob (repeatable)
      --group-by <mode>     namespace, folder, type, or role
      --module-depth <n>    Namespace segments, or auto (default: auto)
      --folder-depth <n>    Folder segments in module view (default: 1)
      --include-unresolved-calls
                            Include unresolved calls and isolated procedures
      --max-edges <n>       Diagram edge density cap (default: 500)
      --direction <value>   right, down, left, or up
      --title <text>        Diagram title
      --source-url <tmpl>   Node link template with {file} and {line}
      --details             Show member counts in nodes
      --no-external         Hide unresolved/external dependencies
      --config <path>       Configuration file (default: .ald2tree.json)
      --strict              Fail on parse or resolution diagnostics
      --debounce <ms>       Watch rebuild debounce (default: 250)
  -h, --help                Show help
  -V, --version             Show version

SVG is rendered by the bundled D2 WebAssembly package.
PNG and PDF rendering require the d2 executable on PATH.
`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  view: { type: "string" },
  object: { type: "string" },
  scope: { type: "string", multiple: true },
  focus: { type: "string" },
  namespace: { type: "string", multiple: true },
  type: { type: "string", multiple: true },
  include: { type: "string", multiple: true },
  exclude: { type: "string", multiple: true },
  "group-by": { type: "string" },
  "module-depth": { type: "string" },
  "folder-depth": { type: "string" },
  "include-unresolved-calls": { type: "boolean" },
  "max-edges": { type: "string" },
  direction: { type: "string" },
  title: { type: "string" },
  "source-url": { type: "string" },
  details: { type: "boolean" },
  "no-external": { type: "boolean" },
  config: { type: "string" },
  strict: { type: "boolean" },
  debounce: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" }
};

function fail(message, code = 1) {
  console.error(`ald2tree: ${message}`);
  process.exitCode = code;
}

function positiveInteger(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function mergeOptions(config, values) {
  return {
    ...config,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    namespaces: values.namespace ?? config.namespaces ?? [],
    types: values.type ?? config.types ?? [],
    include: values.include ?? config.include ?? [],
    exclude: values.exclude ?? config.exclude ?? [],
    scope: values.scope ?? config.scope ?? []
  };
}

function runD2(source, output, options) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (options.layout) args.push("--layout", options.layout);
    if (options.theme !== undefined) args.push("--theme", String(options.theme));
    args.push(source, output);
    const child = spawn("d2", args, { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      reject(
        error.code === "ENOENT"
          ? new Error("D2 is not installed or is not on PATH; use --format d2 or install D2")
          : error
      );
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`D2 renderer exited with code ${code}`));
    });
  });
}

function outputPaths(options, command) {
  const requested = options.output ? path.resolve(options.output) : undefined;
  const inferred = requested ? path.extname(requested).slice(1).toLowerCase() : "";
  const format = (
    options.format ?? (inferred || (command === "inspect" ? "json" : "d2"))
  ).toLowerCase();
  if (!["d2", "json", "svg", "png", "pdf"].includes(format)) {
    throw new Error(`unsupported format: ${format}`);
  }
  let finalOutput = requested ?? (
    command === "inspect" && !options.output
      ? undefined
      : path.resolve(`al-architecture.${format}`)
  );
  if (finalOutput && options.format && inferred !== format) {
    finalOutput = inferred
      ? finalOutput.slice(0, -path.extname(finalOutput).length) + `.${format}`
      : `${finalOutput}.${format}`;
  }
  const d2Output = format === "d2"
    ? finalOutput
    : finalOutput?.replace(/\.[^.]+$/u, "") + ".d2";
  return { format, finalOutput, d2Output };
}

async function build(input, command, cliValues, quiet = false) {
  const config = await loadConfig(input, cliValues.config);
  const options = mergeOptions(config.values, cliValues);
  const direction = options.direction ?? "right";
  const view = options.view ?? "project";
  const groupBy = options["group-by"] ?? options.groupBy ?? (
    view === "project" ? "role" : "namespace"
  );
  if (!["right", "down", "left", "up"].includes(direction)) {
    throw new Error(`unsupported direction: ${direction}`);
  }
  if (!["namespace", "folder", "type", "role"].includes(groupBy)) {
    throw new Error(`unsupported group-by mode: ${groupBy}`);
  }
  if (view === "module" && !["namespace", "folder"].includes(groupBy)) {
    throw new Error("module view supports --group-by namespace or folder");
  }
  const requestedModuleDepth = options["module-depth"] ?? options.moduleDepth ?? "auto";
  const moduleDepth = requestedModuleDepth === "auto"
    ? "auto"
    : positiveInteger(requestedModuleDepth, "module-depth");

  let model = resolveModel(await analyze(input));
  model = filterModel(model, options);
  model = addInsights(model, options.forbiddenDependencies ?? []);
  model = createView(model, view, {
    object: options.object,
    groupBy,
    moduleDepth,
    folderDepth: positiveInteger(
      options["folder-depth"] ?? options.folderDepth,
      "folder-depth",
      1
    ),
    includeUnresolvedCalls:
      options["include-unresolved-calls"] ?? options.includeUnresolvedCalls ?? false,
    scope: options.scope,
    focus: options.focus
  });
  model = addInsights(model);
  if (!model.objects.length && !model.emptyMessage) {
    throw new Error("no AL objects matched");
  }

  const seriousDiagnostics = model.diagnostics.filter(
    ({ severity }) => severity === "error" || severity === "warning"
  );
  if (options.strict && seriousDiagnostics.length) {
    throw new Error(
      `${seriousDiagnostics.length} diagnostic(s) in strict mode; run inspect for details`
    );
  }

  const paths = outputPaths(options, command);
  if (paths.format === "json") {
    const json = JSON.stringify(model, null, 2) + "\n";
    if (paths.finalOutput) {
      await fs.mkdir(path.dirname(paths.finalOutput), { recursive: true });
      await fs.writeFile(paths.finalOutput, json);
    } else {
      process.stdout.write(json);
    }
  } else {
    const source = renderD2(model, {
      direction,
      title: options.title ?? `AL ${view} architecture`,
      includeExternal: !(options["no-external"] ?? options.noExternal ?? false),
      details: options.details ?? false,
      memberNames: view === "object",
      groupBy: view === "module" ? "namespace" : groupBy,
      sourceUrlTemplate: options["source-url"] ?? options.sourceUrl,
      maxEdges: positiveInteger(options["max-edges"] ?? options.maxEdges, "max-edges", 500)
    });
    await fs.mkdir(path.dirname(paths.d2Output), { recursive: true });
    await fs.writeFile(paths.d2Output, source);
    if (paths.format === "svg") {
      const svg = await renderSvg(source, options);
      await fs.mkdir(path.dirname(paths.finalOutput), { recursive: true });
      await fs.writeFile(paths.finalOutput, svg);
    } else if (paths.format !== "d2") {
      await fs.mkdir(path.dirname(paths.finalOutput), { recursive: true });
      await runD2(paths.d2Output, paths.finalOutput, options);
    }
  }

  if (!quiet && command !== "inspect") {
    const warnings = seriousDiagnostics.length
      ? `, ${seriousDiagnostics.length} diagnostic(s)`
      : "";
    console.log(
      `Analyzed ${model.files} file(s); ${model.objects.length} ${view} node(s), ${model.edges.length} edge(s)${warnings}.`
    );
    if (paths.finalOutput) console.log(`Wrote ${paths.finalOutput}`);
    if (paths.format !== "d2" && paths.format !== "json") {
      console.log(`Kept D2 source at ${paths.d2Output}`);
    }
  }
  return { model, paths, options };
}

async function watch(input, values) {
  const initial = await build(input, "graph", values);
  const debounce = positiveInteger(values.debounce ?? initial.options.debounce, "debounce", 250);
  let timer;
  let building = false;
  let pending = false;

  const rebuild = async () => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    try {
      await build(input, "graph", values);
    } catch (error) {
      console.error(`ald2tree: rebuild failed: ${error.message}`);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };

  const watcher = fsWatch(path.resolve(input), { recursive: true }, (_event, filename) => {
    if (filename && !filename.toLowerCase().endsWith(".al") &&
        path.basename(filename) !== "app.json" &&
        path.basename(filename) !== ".ald2tree.json") return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, debounce);
  });
  watcher.on("error", (error) => console.error(`ald2tree: watcher error: ${error.message}`));
  console.log("Watching for AL changes. Press Ctrl+C to stop.");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: OPTIONS
  });
  if (values.help) return console.log(HELP);
  if (values.version) {
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
    return console.log(pkg.version);
  }

  const commands = new Set(["graph", "inspect", "watch"]);
  const command = commands.has(positionals[0]) ? positionals.shift() : "graph";
  if (positionals.length !== 1) {
    console.log(HELP);
    throw new Error("expected exactly one AL file or project directory");
  }
  if (command === "watch") return watch(positionals[0], values);
  return build(positionals[0], command, values);
}

main().catch((error) => fail(error.message, 2));
