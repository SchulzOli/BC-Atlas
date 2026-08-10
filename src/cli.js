#!/usr/bin/env node

import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { createArchitectureModel, positiveInteger } from "./architecture.js";
import { createCapabilities } from "./capabilities.js";
import { renderD2 } from "./d2.js";
import { renderSvg } from "./svg.js";
import { docsMain } from "./docs/cli.js";
import { startDocsServer } from "./docs/server.js";

const HELP = `BC Atlas - generate architecture diagrams from AL source

Usage:
  bca [graph] [options] <file-or-directory>
  bca inspect [options] <file-or-directory>
  bca watch [options] <directory>
  bca serve [options] <app-directory>
  bca capabilities
  bca docs <command> [options] <file-or-directory>

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
  workflow            Trace calls, events, and data mutations from entry points

Options:
  -o, --output <path>       Output path (default: bc-atlas.d2)
  -f, --format <format>     d2, json, svg, png, or pdf
      --view <view>         project, module, object, data, call, boundary,
                            contracts, events, ui, or workflow
      --entry <selector>    Workflow entry procedure, trigger, action, or event
                            (repeatable)
      --workflow-depth <n>  Workflow traversal depth (default: 8)
      --workflow-max-nodes <n>
                            Workflow node cap (default: 100)
      --workflow-edge-types <types>
                            calls,events,writes,reads (default: calls,events,writes)
      --object <selector>   Object selector, e.g. codeunit:50100
      --scope <selector>    Boundary scope: namespace:, folder:, app:, or
                            object: (repeatable)
      --focus <text>        Focus contracts, events, or UI on a matching name
      --project-root <path> Analyze this app/workspace root; use the positional
                            path only as the rendered folder focus
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
      --config <path>       Configuration file (default: .bca.json)
      --strict              Fail on parse or resolution diagnostics
      --debounce <ms>       Watch rebuild debounce (default: 250)
        --tests <directory>   AL UI-test root for the combined Control Center
        --port <number>       Control Center port (default: available port)
  -h, --help                Show help
  -V, --version             Show version

SVG is rendered by the bundled D2 WebAssembly package.
PNG and PDF rendering require the d2 executable on PATH.
`;

const OPTIONS = {
  output: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  view: { type: "string" },
  entry: { type: "string", multiple: true },
  object: { type: "string" },
  scope: { type: "string", multiple: true },
  focus: { type: "string" },
  "project-root": { type: "string" },
  namespace: { type: "string", multiple: true },
  type: { type: "string", multiple: true },
  include: { type: "string", multiple: true },
  exclude: { type: "string", multiple: true },
  "group-by": { type: "string" },
  "module-depth": { type: "string" },
  "folder-depth": { type: "string" },
  "include-unresolved-calls": { type: "boolean" },
  "workflow-depth": { type: "string" },
  "workflow-max-nodes": { type: "string" },
  "workflow-edge-types": { type: "string" },
  "max-edges": { type: "string" },
  direction: { type: "string" },
  title: { type: "string" },
  "source-url": { type: "string" },
  details: { type: "boolean" },
  "no-external": { type: "boolean" },
  config: { type: "string" },
  strict: { type: "boolean" },
  debounce: { type: "string" },
  tests: { type: "string" },
  port: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" }
};

function fail(message, code = 1) {
  console.error(`bca: ${message}`);
  process.exitCode = code;
}

async function operation(action) {
  try {
    return await action();
  } catch (error) {
    error.exitCode ??= 1;
    throw error;
  }
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
      : path.resolve(`bc-atlas.${format}`)
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
  const architecture = await createArchitectureModel(input, cliValues);
  const { model, options, view, seriousDiagnostics, renderOptions } = architecture;

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
    const source = renderD2(model, renderOptions);
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
      console.error(`bca: rebuild failed: ${error.message}`);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };

  const watcher = fsWatch(path.resolve(values["project-root"] ?? input), { recursive: true }, (_event, filename) => {
    if (filename && !filename.toLowerCase().endsWith(".al") &&
        path.basename(filename) !== "app.json" &&
        path.basename(filename) !== ".bca.json") return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, debounce);
  });
  watcher.on("error", (error) => console.error(`bca: watcher error: ${error.message}`));
  console.log("Watching for AL changes. Press Ctrl+C to stop.");
}

async function serve(input, values) {
  if (!values.tests) {
    const error = new Error("--tests is required for the combined Control Center");
    error.exitCode = 2;
    throw error;
  }
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    const error = new Error("--port must be an integer from 0 to 65535");
    error.exitCode = 2;
    throw error;
  }
  const { url } = await startDocsServer(values.tests, { appRoot: input, port });
  console.log(`BC Atlas Control Center: ${url}`);
}

async function main() {
  if (process.argv[2] === "docs") return docsMain(process.argv.slice(3));
  if (process.argv[2] === "capabilities") {
    if (process.argv.length !== 3) throw new Error("capabilities accepts no arguments");
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
    return process.stdout.write(`${JSON.stringify(createCapabilities(pkg.version), null, 2)}\n`);
  }
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

  const commands = new Set(["graph", "inspect", "watch", "serve"]);
  const command = commands.has(positionals[0]) ? positionals.shift() : "graph";
  if (positionals.length !== 1) {
    console.log(HELP);
    throw new Error("expected exactly one AL file or project directory");
  }
  if (command === "watch") return operation(() => watch(positionals[0], values));
  if (command === "serve") return operation(() => serve(positionals[0], values));
  return operation(() => build(positionals[0], command, values));
}

main().catch((error) => fail(error.message, error.exitCode ?? 2));
