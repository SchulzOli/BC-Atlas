// `bca export`: writes what the app shows as files. One command for the
// view as one offline file, the Markdown report, and the knowledge graph.
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { renderSnapshotHtml } from "../app/snapshot.js";
import { Workspace } from "../app/workspace.js";
import { healthResultLine } from "../health.js";
import { displayPath } from "../output.js";
import { positiveInteger } from "../project.js";
import { UsageError } from "../cli/errors.js";
import { writeKnowledgeGraph } from "../knowledge/index.js";
import { generateReport } from "./report.js";

// Formats each kind of export accepts; the first one is the default.
const FORMATS = {
  app: ["html"],
  report: ["md"],
  "knowledge-graph": ["ttl", "rdf", "owl", "nt", "jsonld"]
};

function checkFormat(view, format) {
  if (!FORMATS[view]) throw new UsageError(`unknown view "${view}"; use ${Object.keys(FORMATS).join(", ")}. A picture of a lens: bca view --lens <id> -o <file>.svg`);
  if (format && !FORMATS[view].includes(format)) {
    throw new UsageError(`--view ${view} writes ${FORMATS[view].join(" or ")}, not ${format}`);
  }
}

async function exportApp(input, values, log) {
  const output = path.resolve(values.output ?? "bc-atlas.html");
  const workspace = new Workspace(input, values, { live: false });
  const { html, snapshot } = await renderSnapshotHtml(workspace, { log, title: values.title });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  const { title, summary } = snapshot.atlas;
  log(`${title}: ${summary.objects} object(s), health ${summary.health.passed ? "passed" : "failed"}.`);
  return [output];
}

async function exportReport(input, values, log) {
  const result = await generateReport(input, { ...values, outputDir: values.output }, { log });
  log(healthResultLine(result.health));
  log(`${result.pictures.length} picture(s) in the report`);
  return [result.readme];
}

async function exportKnowledgeGraph(input, values, log) {
  const result = await writeKnowledgeGraph(input, values);
  log(`Knowledge graph: ${result.objects} object(s), ${result.relations} relation(s), ${result.triples} triple(s) as ${result.format}.`);
  return [result.file];
}

const EXPORTERS = { app: exportApp, report: exportReport, "knowledge-graph": exportKnowledgeGraph };

/** Writes one export; returns the files written. */
export async function runExport(input, values = {}, { log = () => {} } = {}) {
  const view = values.view ?? "app";
  checkFormat(view, values.format);
  return EXPORTERS[view](input, { ...values, view }, log);
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
  const log = (message) => console.log(message);
  const build = async () => {
    const files = await runExport(input, values, { log });
    for (const file of files) log(`Wrote ${displayPath(file)}`);
  };
  await build();
  if (values.watch) await watchExport(input, values, build);
}
