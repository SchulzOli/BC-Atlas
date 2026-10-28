// `bca export`: writes what the app shows as files. One command for the
// offline app, the Markdown report, single diagrams, the 3D explorer, the
// object catalog, and the resolved model as JSON.
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createArchitectureModel, positiveInteger } from "../architecture.js";
import { VIEWS } from "../capabilities.js";
import { generateCodeGraph } from "../codegraph.js";
import { renderSnapshotHtml } from "../app/snapshot.js";
import { Workspace } from "../app/workspace.js";
import { healthResultLine } from "../health.js";
import { displayPath, resolveOutput, writeArchitecture } from "../output.js";
import { UsageError } from "../cli/errors.js";
import { writeExplorer } from "./explore.js";
import { generateReport } from "./report.js";

const DIAGRAM_VIEWS = new Set(VIEWS.map(([id]) => id));

// Formats each kind of export accepts; the first one is the default.
const FORMATS = {
  app: ["html"],
  explorer: ["html", "json"],
  report: ["svg", "d2"],
  catalog: ["md"],
  diagram: ["svg", "d2", "json", "png", "pdf"]
};

const kindOf = (view) => (DIAGRAM_VIEWS.has(view) ? "diagram" : view);

function checkFormat(view, format) {
  const kind = kindOf(view);
  if (!FORMATS[kind]) throw new UsageError(`unknown view "${view}"; use app, report, explorer, catalog, or one of ${[...DIAGRAM_VIEWS].join(", ")}`);
  if (format && !FORMATS[kind].includes(format)) {
    throw new UsageError(`--view ${view} writes ${FORMATS[kind].join(" or ")}, not ${format}`);
  }
}

async function exportApp(input, values, log) {
  const output = path.resolve(values.output ?? "bc-atlas.html");
  const workspace = new Workspace(input, values, { live: false });
  const { html, snapshot } = await renderSnapshotHtml(workspace, { log, history: values.history, title: values.title });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  const { summary, health, architecture } = snapshot.overview;
  log(`${snapshot.overview.title}: ${summary.objects} object(s), health ${health.passed ? "passed" : "failed"}, ${architecture.violations} wrong-way dependency(ies).`);
  return [output];
}

async function exportExplorer(input, values, log) {
  const started = Date.now();
  const { document, file } = await writeExplorer(input, values, {
    onFrame: (frame, index, total) => log(
      `Frame ${index + 1}/${total}: ${frame.id} ${frame.date.slice(0, 10)} (${Math.round((Date.now() - started) / 1000)} s)`
    )
  });
  const objects = document.levels.object;
  const crossApp = objects.edges.filter(({ scope }) => scope === "inter-app").length;
  const undeclared = document.levels.app.edges.filter(({ dependency }) => dependency === "undeclared").length;
  const frames = document.timeline.frames.length;
  log(
    `${document.lens.title}: ${objects.nodes.length} object(s), ${objects.edges.length} dependency edge(s), ` +
    `${crossApp} across apps, ${document.levels.app.nodes.length} app(s)` +
    `${undeclared ? `, ${undeclared} undeclared app dependency(ies)` : ""}` +
    `${frames > 1 ? `; ${frames} frame(s) from ${document.timeline.commits} commit(s)` : ""}.`
  );
  return [file];
}

async function exportReport(input, values, log) {
  const result = await generateReport(input, { ...values, outputDir: values.output }, { log });
  const rendered = result.diagrams.filter(({ skipped }) => !skipped).length;
  log(healthResultLine(result.health));
  log(`${rendered} diagram(s) in the report`);
  return [result.readme];
}

async function exportCatalog(input, values, log) {
  const result = await generateCodeGraph(input, { ...values, outputDir: values.output ?? "docs/codegraph" });
  log(`${result.objects} object page(s); ${result.unresolved} unresolved reference(s).`);
  return [path.join(result.outputDirectory, "index.md")];
}

async function exportDiagram(input, values, log) {
  const architecture = await createArchitectureModel(input, values);
  const toStdout = values.output === "-" || (!values.output && values.format === "json");
  const target = resolveOutput({
    output: toStdout ? undefined : values.output ?? `bc-atlas-${architecture.view}.${values.format ?? "svg"}`,
    format: toStdout ? "json" : values.format,
    fallbackFormat: "svg",
    toStdout
  });
  const { files } = await writeArchitecture(architecture, target);
  const { model, view, seriousDiagnostics } = architecture;
  const warnings = seriousDiagnostics.length ? `, ${seriousDiagnostics.length} diagnostic(s) - run "bca check" for details` : "";
  log(`Analyzed ${model.files} file(s): ${model.objects.length} ${view} node(s), ${model.edges.length} edge(s)${warnings}.`);
  return files;
}

const EXPORTERS = { app: exportApp, explorer: exportExplorer, report: exportReport, catalog: exportCatalog, diagram: exportDiagram };

/** Writes one export; returns the files written. */
export async function runExport(input, values = {}, { log = () => {} } = {}) {
  const view = values.view ?? "app";
  checkFormat(view, values.format);
  if (values.output === "-" && (kindOf(view) !== "diagram" || (values.format ?? "json") !== "json")) {
    throw new UsageError("-o - (stdout) is only for a diagram view with --format json");
  }
  return EXPORTERS[kindOf(view)](input, { ...values, view }, log);
}

async function watchExport(input, values, build) {
  const debounce = positiveInteger(values.debounce, "debounce", 250);
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
      await build();
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
  const root = path.resolve(values.projectRoot ?? input);
  const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
    if (filename) {
      const name = path.basename(filename);
      if (!filename.toLowerCase().endsWith(".al") && name !== "app.json" && name !== ".bca.json") return;
    }
    clearTimeout(timer);
    timer = setTimeout(rebuild, debounce);
  });
  watcher.on("error", (error) => console.error(`bca: watcher error: ${error.message}`));
  const stop = () => {
    watcher.close();
    clearTimeout(timer);
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`Watching ${displayPath(root)} for AL changes. Press Ctrl+C to stop.`);
}

export async function exportCommand(input, values) {
  // JSON on stdout stays clean; progress goes to stderr.
  const toStdout = values.output === "-" || (!values.output && values.format === "json" && DIAGRAM_VIEWS.has(values.view));
  const log = (message) => (toStdout ? console.error(message) : console.log(message));
  const build = async () => {
    const files = await runExport(input, values, { log });
    for (const file of files) log(`Wrote ${displayPath(file)}`);
  };
  await build();
  if (values.watch) await watchExport(input, values, build);
}
