// BC Atlas modules: separately installed packages that add tasks and commands while BC Atlas
// stays independent of them. A project opts in through .bca.json:
//
//   "modules": ["bc-atlas-sync"]                                  resolved from the project's node_modules
//   "modules": [{ "name": "bc-atlas-sync", "path": "../bc-atlas-sync" }]   a local checkout
//
// BCA_MODULES (comma-separated names or paths) adds modules for development and pipelines.
// A module exports `bcaModule` (or a default export) with module API version 1:
//
//   { apiVersion: 1, name, version, configKey,
//     tasks: { <task>: { summary, run(host) -> { ok, summary } } },
//     commands: { <sub>: (host, values) -> result with optional `lines` },
//     outputs(projectConfig) -> paths it writes }
//
// and receives a host (createModuleHost) instead of importing BC Atlas internals.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MODULE_API_VERSION = 1;

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function entriesOf(config, env) {
  const configured = (config.modules ?? []).map((entry) => (typeof entry === "string" ? { name: entry } : { ...entry }));
  const extra = String(env.BCA_MODULES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[\\/]/u.test(item) || item.startsWith(".") ? { path: item } : { name: item }));
  return [...configured, ...extra];
}

function resolveEntry(entry, root) {
  const fromProject = createRequire(path.join(root, "package.json"));
  if (entry.path) {
    const target = path.resolve(root, entry.path);
    if (!existsSync(target)) throw new Error(`module path ${entry.path} does not exist`);
    return fromProject.resolve(target);
  }
  if (!entry.name) throw new Error("every entry in \"modules\" needs a name or a path");
  try {
    return fromProject.resolve(entry.name);
  } catch {
    // Installed next to BC Atlas (global installation, or a dependency of the BC Atlas checkout).
    try {
      return createRequire(import.meta.url).resolve(entry.name);
    } catch {
      throw new Error(`module "${entry.name}" is not installed; run "npm install --save-dev ${entry.name}" in the project, or set its "path" in .bca.json`);
    }
  }
}

/** Loads the modules a project declares; each is validated against the module API. */
export async function loadModules(root, config = {}, { env = process.env } = {}) {
  const modules = [];
  for (const entry of entriesOf(config, env)) {
    const file = resolveEntry(entry, path.resolve(root));
    const exported = await import(pathToFileURL(file).href);
    const module = exported.bcaModule ?? exported.default;
    const label = entry.name ?? entry.path;
    if (!module || typeof module !== "object") throw new Error(`module "${label}" does not export bcaModule`);
    if (module.apiVersion !== MODULE_API_VERSION) {
      throw new Error(`module "${label}" uses module API ${module.apiVersion}; this BC Atlas (${pkg.version}) supports ${MODULE_API_VERSION}`);
    }
    if (modules.some(({ name }) => name === module.name)) continue;
    modules.push(Object.assign(Object.create(null), { name: module.name, version: module.version, file, module }));
  }
  return modules;
}

/** The module that provides a task (e.g. "sync"), or undefined. */
export function moduleForTask(modules, task) {
  return modules.find(({ module }) => typeof module.tasks?.[task]?.run === "function");
}

/** The module that owns a command family (e.g. "sync" for "bca sync ..."). */
export function moduleForCommand(modules, family) {
  return modules.find(({ module }) => module.configKey === family || module.name === `bc-atlas-${family}`);
}

/**
 * What BC Atlas gives a module: the project, the trigger, a log, and the parts of BC Atlas a
 * module may use without importing its internals.
 */
export function createModuleHost({ root, config = {}, trigger = "manual", values = {}, log = () => {} }) {
  const projectRoot = path.resolve(root);
  return {
    name: pkg.name,
    version: pkg.version,
    apiVersion: MODULE_API_VERSION,
    root: projectRoot,
    config,
    trigger,
    log,
    /** The architecture model of the project: objects with their component, components with their layer. */
    async atlasModel() {
      const { Workspace } = await import("./app/workspace.js");
      const workspace = new Workspace(projectRoot, values, { live: false });
      const [overview, architecture, index] = await Promise.all([workspace.overview(), workspace.architecture(), workspace.objectIndex()]);
      return { overview: { title: overview.title }, architecture, objects: index.list };
    },
    /** Renders AL UI tests with the BC Atlas docs pipeline (guides, test cases, DITA, BPMN, ...). */
    async renderDocs({ testsDir, outputDir, formats = ["markdown"], mode = "guide", language, title }) {
      const [{ loadCorpus }, { exportDocumentation }] = await Promise.all([import("./docs/model.js"), import("./docs/export.js")]);
      const corpus = await loadCorpus(testsDir);
      const result = await exportDocumentation(corpus, {
        formats,
        mode,
        language,
        title,
        appRoot: path.resolve(projectRoot, config.docs?.app ?? "."),
        outputDirectory: outputDir
      });
      return { warnings: result.warnings ?? [], scenarios: result.catalog?.tasks?.length ?? 0 };
    }
  };
}
