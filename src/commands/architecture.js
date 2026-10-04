import { watch as fsWatch } from "node:fs";
import path from "node:path";
import { createArchitectureModel, positiveInteger } from "../architecture.js";
import { displayPath, resolveOutput, writeArchitecture } from "../output.js";

function summary(architecture) {
  const { model, view, seriousDiagnostics } = architecture;
  const warnings = seriousDiagnostics.length ? `, ${seriousDiagnostics.length} diagnostic(s) - run "bca check" for details` : "";
  return `Analyzed ${model.files} file(s): ${model.objects.length} ${view} node(s), ${model.edges.length} edge(s)${warnings}.`;
}

async function build(input, values, { log = console.log } = {}) {
  const architecture = await createArchitectureModel(input, values);
  const target = resolveOutput({
    output: architecture.options.output,
    format: architecture.options.format
  });
  const { files } = await writeArchitecture(architecture, target);
  log(summary(architecture));
  for (const file of files) log(`Wrote ${displayPath(file)}`);
  return architecture;
}

export async function graphCommand(input, values) {
  await build(input, values);
}

export async function inspectCommand(input, values) {
  const architecture = await createArchitectureModel(input, values);
  const target = resolveOutput({ output: values.output, format: "json", toStdout: true });
  const { files } = await writeArchitecture(architecture, target);
  for (const file of files) console.error(`Wrote ${displayPath(file)}`);
}

export async function watchCommand(input, values) {
  const initial = await build(input, values);
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
      await build(input, values);
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
