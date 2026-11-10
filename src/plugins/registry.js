// Discovers, validates, and activates plugins for one project.
//
// Where plugins come from (later sources may replace a plugin with the same id):
//   1. built-in    plugins/<id> shipped with BC Atlas, enabled unless switched off
//   2. npm         dependencies of the project named bc-atlas-plugin-* or @scope/bc-atlas-plugin-*
//   3. .bca.json   "plugins": ["bc-atlas-plugin-x", { "path": "../my-plugin" }, { "id": "sync", "enabled": false }]
//                  or { "x": true, "sync": false, "my": { "path": "../my-plugin" } }
//   4. BCA_PLUGINS comma-separated package names or paths (development, pipelines)
//
// Manifests are read eagerly (cheap, no plugin code runs); a plugin is activated the first time
// one of its contributions is used, once per registry.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTIN_PLUGINS } from "./builtin.js";
import { createPluginContext } from "./context.js";
import { parseManifest, readManifest } from "./manifest.js";

/** The built-in tasks of bca run, in run order. Plugin tasks are placed by their before/after. */
export const CORE_TASK_ORDER = Object.freeze(["check", "simulate", "report", "diagrams", "docs", "codegraph", "handbook"]);

const NPM_PLUGIN = /^(@[^/]+\/)?bc-atlas-plugin-[a-z0-9-]+$/u;

function configEntries(config) {
  const plugins = config.plugins;
  if (plugins === undefined) return [];
  if (Array.isArray(plugins)) {
    return plugins.map((entry) => (typeof entry === "string"
      ? (/[\\/]/u.test(entry) || entry.startsWith(".") ? { path: entry } : { name: entry })
      : { ...entry }));
  }
  if (plugins && typeof plugins === "object") {
    return Object.entries(plugins).map(([key, value]) => {
      if (value === false) return { id: key, enabled: false };
      if (value === true) return { name: key, id: key };
      if (typeof value === "string") return { id: key, path: value };
      return { id: key, ...value };
    });
  }
  throw new Error(".bca.json plugins must be a list or an object");
}

function npmEntries(root) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
      .filter((name) => NPM_PLUGIN.test(name))
      .sort()
      .map((name) => ({ name, auto: true }));
  } catch {
    return [];
  }
}

function envEntries(env) {
  return String(env.BCA_PLUGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/[\\/]/u.test(item) || item.startsWith(".") ? { path: item } : { name: item }));
}

/** Folder of an installed plugin package: the project's node_modules first, then BC Atlas's. */
function packageDir(name, root) {
  for (const base of [path.join(root, "package.json"), new URL("../../package.json", import.meta.url)]) {
    const require = createRequire(base);
    for (const target of [`${name}/plugin.json`, `${name}/package.json`]) {
      try {
        return path.dirname(require.resolve(target));
      } catch {
        // exports may hide these files; fall back to node_modules below
      }
    }
  }
  for (let dir = root; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (existsSync(path.join(candidate, "plugin.json"))) return candidate;
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(`plugin "${name}" is not installed; run "npm install --save-dev ${name}" in the project, or set its "path" in .bca.json`);
}

export class PluginRegistry {
  constructor(root, config, plugins, warnings) {
    this.plugins = plugins;
    this.warnings = warnings;
    this.activated = new Map();
    this.session = { root, config, trigger: "manual", values: {}, log: () => {} };
  }

  /** Trigger, log, and shared CLI values for the plugins activated afterwards. */
  setSession(changes) {
    Object.assign(this.session, Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)));
    return this;
  }

  list() {
    return this.plugins;
  }

  enabled() {
    return this.plugins.filter(({ enabled }) => enabled);
  }

  get(id) {
    return this.plugins.find((plugin) => plugin.id === id);
  }

  /** Commands of enabled plugins: [{ plugin, command }]. */
  commands() {
    return this.enabled().flatMap((plugin) => plugin.manifest.contributes.commands.map((command) => ({ plugin, command })));
  }

  tasks() {
    return this.enabled().flatMap((plugin) => plugin.manifest.contributes.tasks.map((task) => ({ plugin, task })));
  }

  taskSummaries() {
    return Object.fromEntries(this.tasks().map(({ task }) => [task.id, task.summary]));
  }

  pluginForTask(taskId) {
    return this.tasks().find(({ task }) => task.id === taskId)?.plugin;
  }

  /** Core tasks plus plugin tasks, each plugin task placed before/after the tasks it names. */
  taskOrder(core = CORE_TASK_ORDER) {
    const order = [...core];
    for (const { task } of this.tasks()) {
      if (order.includes(task.id)) continue;
      const before = task.before.map((id) => order.indexOf(id)).filter((index) => index >= 0);
      const after = task.after.map((id) => order.indexOf(id)).filter((index) => index >= 0);
      if (before.length) order.splice(Math.min(...before), 0, task.id);
      else if (after.length) order.splice(Math.max(...after) + 1, 0, task.id);
      else order.push(task.id);
    }
    return order;
  }

  healthRules() {
    return this.enabled().flatMap((plugin) => plugin.manifest.contributes.healthRules.map((rule) => ({ plugin, rule })));
  }

  mcpTools() {
    return this.enabled().flatMap((plugin) => plugin.manifest.contributes.mcpTools.map((tool) => ({ plugin, tool })));
  }

  /** Runs the plugin's activate(context) once and returns its implementations. */
  async activate(id) {
    const plugin = this.get(id);
    if (!plugin) throw new Error(`unknown plugin "${id}"`);
    if (!plugin.enabled) throw new Error(`plugin "${id}" is disabled in .bca.json`);
    if (!this.activated.has(id)) {
      this.activated.set(id, (async () => {
        const exported = await plugin.load();
        const activate = exported.activate ?? exported.default?.activate;
        if (typeof activate !== "function") throw new Error(`plugin "${id}" does not export activate(context)`);
        return (await activate(createPluginContext(plugin, this))) ?? {};
      })());
    }
    return this.activated.get(id);
  }

  /** Calls the hook of every enabled plugin that subscribed to the event; returns their results. */
  async emit(event, payload) {
    const results = [];
    for (const plugin of this.enabled().filter(({ manifest }) => manifest.contributes.hooks.includes(event))) {
      const hook = (await this.activate(plugin.id)).hooks?.[event];
      if (typeof hook === "function") results.push({ plugin: plugin.id, result: await hook(payload) });
    }
    return results;
  }

  /** Contributions to an extension point from every enabled plugin that declares it extends it. */
  async extensions(pointId) {
    const owner = this.enabled().find(({ manifest }) => manifest.contributes.extensionPoints.some(({ id }) => id === pointId));
    if (!owner) throw new Error(`unknown extension point "${pointId}"`);
    const items = [];
    for (const plugin of this.enabled().filter(({ manifest }) => manifest.contributes.extends[pointId])) {
      const contributed = (await this.activate(plugin.id)).extensions?.[pointId] ?? [];
      for (const item of contributed) items.push({ ...item, plugin: plugin.id });
    }
    return items;
  }

  /** Paths a plugin task writes (for verify, stage, artifacts, pull requests). */
  async taskOutputs(taskId, config = this.session.config) {
    const plugin = this.pluginForTask(taskId);
    if (!plugin) return [];
    const outputs = (await this.activate(plugin.id)).tasks?.[taskId]?.outputs;
    return typeof outputs === "function" ? await outputs(config) : [];
  }
}

/**
 * Discovers the plugins of a project.
 * @param root project root (where .bca.json lives)
 * @param config parsed .bca.json
 */
export async function loadPlugins(root, config = {}, { env = process.env, builtin = BUILTIN_PLUGINS } = {}) {
  root = path.resolve(root);
  const plugins = [];
  const warnings = [];
  const add = (plugin) => {
    const index = plugins.findIndex(({ id }) => id === plugin.id);
    if (index >= 0) {
      warnings.push(`plugin "${plugin.id}" from ${plugin.source} replaces the one from ${plugins[index].source}`);
      plugins.splice(index, 1, plugin);
    } else {
      plugins.push(plugin);
    }
  };

  for (const entry of builtin) {
    const manifest = parseManifest(entry.manifest, `built-in plugin ${entry.manifest?.id}`);
    add({ id: manifest.id, manifest, dir: entry.dir, source: "built-in", enabled: true, load: entry.load });
  }

  const entries = [...npmEntries(root), ...configEntries(config), ...envEntries(env)];
  const switches = [];
  for (const entry of entries) {
    if (!entry.name && !entry.path) {
      if (entry.id) switches.push(entry);
      else throw new Error("every entry in \"plugins\" needs a name, a path, or an id");
      continue;
    }
    let dir;
    try {
      dir = entry.path ? path.resolve(root, entry.path) : packageDir(entry.name, root);
    } catch (error) {
      // A package named bc-atlas-plugin-* in package.json that is not installed yet is only a warning.
      if (entry.auto) {
        warnings.push(error.message);
        continue;
      }
      throw error;
    }
    const manifest = await readManifest(dir);
    if (entry.id && entry.id !== manifest.id) throw new Error(`plugin at ${dir} has id "${manifest.id}", not "${entry.id}"`);
    const main = path.join(dir, manifest.main);
    add({
      id: manifest.id,
      manifest,
      dir,
      source: entry.path ? `path ${entry.path}` : `npm ${entry.name}`,
      enabled: entry.enabled !== false,
      load: () => import(pathToFileURL(main).href)
    });
    if (entry.enabled === false) switches.push({ id: manifest.id, enabled: false });
  }
  for (const { id, enabled } of switches) {
    const plugin = plugins.find((item) => item.id === id);
    if (!plugin) throw new Error(`.bca.json plugins: no plugin with id "${id}"`);
    plugin.enabled = enabled !== false;
  }

  // Commands, tasks, and config keys must not collide with each other or with BC Atlas.
  const taken = new Map();
  for (const plugin of plugins.filter(({ enabled }) => enabled)) {
    for (const [kind, key] of [
      ["config key", plugin.manifest.configKey],
      ...plugin.manifest.contributes.tasks.map(({ id }) => ["task", id]),
      ...plugin.manifest.contributes.mcpTools.map(({ name }) => ["MCP tool", name])
    ]) {
      const name = `${kind} ${key}`;
      if (taken.has(name)) throw new Error(`plugins "${taken.get(name)}" and "${plugin.id}" both contribute ${name}`);
      if (kind === "task" && CORE_TASK_ORDER.includes(key)) throw new Error(`plugin "${plugin.id}" contributes task "${key}", which BC Atlas already has`);
      taken.set(name, plugin.id);
    }
  }
  return new PluginRegistry(root, config, plugins, warnings);
}
