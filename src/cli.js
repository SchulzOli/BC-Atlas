#!/usr/bin/env node

import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { createArchitectureModel, positiveInteger } from "./architecture.js";
import { createCapabilities } from "./capabilities.js";
import { generateCodeGraph } from "./codegraph.js";
import { renderD2 } from "./d2.js";
import { renderSvg } from "./svg.js";
import { docsMain } from "./docs/cli.js";
import { startDocsServer } from "./docs/server.js";

const HELP = `BC Atlas - generate architecture diagrams from AL source

Usage:
  bca [graph] [options] <file-or-directory>
  bca inspect [options] <file-or-directory>
  bca codegraph [options] <file-or-directory>
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
      --output-dir <path>   Code Graph directory (default: docs/codegraph)
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
      --object-inbound-depth <n>
                            Incoming depth for object focus (default: 1)
      --object-outbound-depth <n>
                            Outgoing depth for object focus (default: 1)
      --members <types>     fields,actions,triggers,events,procedures
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
      --root-procedure <sel> Call root procedure (repeatable)
      --call-depth <n>       Call traversal depth from each root (default: 3)
      --call-direction <dir> incoming, outgoing, or both (default: outgoing)
      --expand-procedures    Show procedures instead of owning-object aggregates
      --expand-framework-calls
                            Show individual framework/standard-library calls
      --max-edges <n>       Diagram edge density cap (default: 500)
      --direction <value>   right, down, left, or up
      --title <text>        Diagram title
      --source-url <tmpl>   Node link template with {file}, {line}, and {ref}
      --source-ref <ref>    Commit/branch for {ref} in source URLs
      --source-path-prefix <path>
                            Repository-relative prefix before {file}
      --no-legend           Hide edge and confidence legends
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
  "output-dir": { type: "string" },
  format: { type: "string", short: "f" },
  view: { type: "string" },
  entry: { type: "string", multiple: true },
  object: { type: "string" },
  "object-inbound-depth": { type: "string" },
  "object-outbound-depth": { type: "string" },
  members: { type: "string" },
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
  "root-procedure": { type: "string", multiple: true },
  "call-depth": { type: "string" },
  "call-direction": { type: "string" },
  "expand-procedures": { type: "boolean" },
  "expand-framework-calls": { type: "boolean" },
  "workflow-depth": { type: "string" },
  "workflow-max-nodes": { type: "string" },
  "workflow-edge-types": { type: "string" },
  "max-edges": { type: "string" },
  direction: { type: "string" },
  title: { type: "string" },
  "source-url": { type: "string" },
  "source-ref": { type: "string" },
  "source-path-prefix": { type: "string" },
  "no-legend": { type: "boolean" },
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

const ANALYSIS_OPTIONS = [
  "view", "entry", "object", "object-inbound-depth", "object-outbound-depth", "members",
  "scope", "focus", "project-root", "namespace", "type", "include", "exclude", "group-by",
  "module-depth", "folder-depth", "include-unresolved-calls", "root-procedure", "call-depth",
  "call-direction", "expand-procedures", "expand-framework-calls", "workflow-depth",
  "workflow-max-nodes", "workflow-edge-types", "max-edges", "direction", "title", "source-url",
  "source-ref", "source-path-prefix", "no-legend", "details", "no-external", "config", "strict"
];
const COMMAND_OPTIONS = {
  graph: [...ANALYSIS_OPTIONS, "output", "format"],
  inspect: [...ANALYSIS_OPTIONS, "output", "format"],
  codegraph: [
    "output-dir", "project-root", "namespace", "type", "include", "exclude", "config", "strict",
    "source-url", "source-ref", "source-path-prefix"
  ],
  watch: [...ANALYSIS_OPTIONS, "output", "format", "debounce"],
  serve: ["tests", "port"]
};

function validateChoice(value, name, choices) {
  if (value !== undefined && !choices.includes(String(value).toLowerCase())) {
    throw new Error(`unsupported ${name}: ${value}`);
  }
}

function validatePositive(value, name) {
  if (value !== undefined) positiveInteger(value, name);
}

function validateCommandOptions(command, values) {
  const allowed = COMMAND_OPTIONS[command];
  const unexpected = Object.keys(values).filter((name) =>
    !["help", "version"].includes(name) && values[name] !== undefined && !allowed.includes(name)
  );
  if (unexpected.length) throw new Error(`${command} does not support --${unexpected[0]}`);
  validateChoice(values.format, "format", ["d2", "json", "svg", "png", "pdf"]);
  if (command === "inspect" && values.format && values.format.toLowerCase() !== "json") {
    throw new Error("inspect supports only --format json");
  }
  validateChoice(values.view, "view", [
    "project", "module", "object", "data", "call", "boundary", "contracts", "events", "ui", "workflow"
  ]);
  validateChoice(values.direction, "direction", ["right", "down", "left", "up"]);
  validateChoice(values["group-by"], "group-by mode", ["namespace", "folder", "type", "role"]);
  validateChoice(values["call-direction"], "call direction", ["incoming", "outgoing", "both"]);
  for (const name of [
    "object-inbound-depth", "object-outbound-depth", "folder-depth", "call-depth", "workflow-depth",
    "workflow-max-nodes", "max-edges", "debounce"
  ]) validatePositive(values[name], name);
  if (values["module-depth"] !== undefined && values["module-depth"] !== "auto") {
    validatePositive(values["module-depth"], "module-depth");
  }
  const members = values.members?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const invalidMembers = members.filter((value) =>
    !["fields", "actions", "triggers", "events", "procedures"].includes(value)
  );
  if (invalidMembers.length) throw new Error(`unsupported member categories: ${invalidMembers.join(", ")}`);
  const edgeTypes = values["workflow-edge-types"]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const invalidEdgeTypes = edgeTypes.filter((value) => !["calls", "events", "writes", "reads"].includes(value));
  if (invalidEdgeTypes.length) throw new Error(`unsupported workflow edge types: ${invalidEdgeTypes.join(", ")}`);
  if (values.port !== undefined) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("--port must be an integer from 0 to 65535");
    }
  }
}

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
  if (requested && options.format && inferred !== format) {
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
  if (options.strict && seriousDiagnostics.length) {
    if (paths.format === "json" && !paths.finalOutput) {
      process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    }
    const details = seriousDiagnostics.map((diagnostic) => [
      diagnostic.file,
      diagnostic.location?.line,
      diagnostic.code,
      diagnostic.message
    ].filter((value) => value !== undefined).join(":"));
    const error = new Error(
      `${seriousDiagnostics.length} diagnostic(s) in strict mode:\n${details.join("\n")}`
    );
    error.exitCode = 1;
    throw error;
  }
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
    const log = paths.format === "json" ? console.error : console.log;
    log(
      `Analyzed ${model.files} file(s); ${model.objects.length} ${view} node(s), ${model.edges.length} edge(s)${warnings}.`
    );
    if (paths.finalOutput) log(`Wrote ${paths.finalOutput}`);
    if (paths.format !== "d2" && paths.format !== "json") {
      log(`Kept D2 source at ${paths.d2Output}`);
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
  const { browserUrl } = await startDocsServer(values.tests, { appRoot: input, port });
  console.log(`BC Atlas Control Center: ${browserUrl}`);
}

async function codegraph(input, values) {
  const result = await generateCodeGraph(input, values);
  console.log(`Generated ${result.objects} object document(s); ${result.unresolved} unresolved reference(s).`);
  console.log(`Wrote ${result.outputDirectory}`);
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

  const commands = new Set(["graph", "inspect", "codegraph", "watch", "serve"]);
  const command = commands.has(positionals[0]) ? positionals.shift() : "graph";
  if (positionals.length !== 1) {
    console.log(HELP);
    throw new Error("expected exactly one AL file or project directory");
  }
  validateCommandOptions(command, values);
  if (command === "watch") return operation(() => watch(positionals[0], values));
  if (command === "serve") return operation(() => serve(positionals[0], values));
  if (command === "codegraph") return operation(() => codegraph(positionals[0], values));
  return operation(() => build(positionals[0], command, values));
}

main().catch((error) => fail(error.message, error.exitCode ?? 2));
