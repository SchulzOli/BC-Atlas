// `bca export`: the BC Atlas view as one offline HTML file to share.
import { watch as fsWatch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { renderSnapshotHtml } from "../app/snapshot.js";
import { Workspace } from "../app/workspace.js";
import { displayPath } from "../output.js";
import { positiveInteger } from "../project.js";
import { UsageError } from "../cli/errors.js";

/**
 * Where the file opens: a lens, a story (a journey of the user guides is
 * one), or a user guide, by its id; as the address of the view.
 */
export function startOf(atlas, what) {
  const id = String(what).trim();
  if (atlas.lenses.some((lens) => lens.id === id)) return `lens=${encodeURIComponent(id)}`;
  if (atlas.stories.some((story) => story.id === id)) return `story=${encodeURIComponent(id)}`;
  const guide = atlas.nodes.find((node) => node.kind === "guide" && (node.document === id || node.id === id));
  if (guide) return new URLSearchParams({ lens: "pages", sel: guide.id }).toString();
  const known = [
    ...atlas.lenses.map((lens) => lens.id),
    ...atlas.stories.map((story) => story.id),
    ...atlas.nodes.filter((node) => node.kind === "guide").map((node) => node.document)
  ];
  throw new UsageError(`--open ${id} is no lens, story, or user guide of this project; use one of: ${[...new Set(known)].join(", ")}`);
}

/** Writes the view as one offline HTML file; returns the files written. */
async function runExport(input, values = {}, { log = () => {} } = {}) {
  if (values.output === "-") throw new UsageError("bca export writes a file; -o - is not supported. For JSON on stdout, use bca view --format json");
  const output = path.resolve(values.output ?? "bc-atlas.html");
  const workspace = new Workspace(input, values, { live: false });
  const start = values.open ? startOf(await workspace.atlas(), values.open) : undefined;
  const { html, snapshot } = await renderSnapshotHtml(workspace, { log, title: values.title, start });
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
