// `bca export`: the BC Atlas view as one offline HTML file to share.
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { renderSnapshotHtml } from "../app/snapshot.js";
import { Workspace } from "../app/workspace.js";
import { displayPath } from "../output.js";
import { positiveInteger } from "../project.js";
import { UsageError } from "../cli/errors.js";

/** Writes the view as one offline HTML file; returns the files written. */
async function runExport(input, values = {}, { log = () => {} } = {}) {
  if (values.output === "-") throw new UsageError("bca export writes a file; -o - is not supported. For JSON on stdout, use bca view --format json");
  const output = path.resolve(values.output ?? "bc-atlas.html");
  const workspace = new Workspace(input, values, { live: false });
  const { html, snapshot } = await renderSnapshotHtml(workspace, { log, title: values.title });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  const { title, summary } = snapshot.atlas;
  log(`${title}: ${summary.objects} object(s), health ${summary.health.passed ? "passed" : "failed"}.`);
  return [output];
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
