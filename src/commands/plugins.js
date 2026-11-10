// bca <plugin> <command> (any plugin command) and bca plugins list|show|doctor|new.
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { CORE_TASK_ORDER, loadPlugins } from "../plugins/registry.js";
import { PLUGIN_API_VERSION, PLUGIN_EVENTS } from "../plugins/manifest.js";

const pkg = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));

async function registryFor(root, configPath) {
  const config = (await loadConfig(root, configPath)).values;
  return { config, registry: await loadPlugins(root, config) };
}

function print(result, values) {
  if (values.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else for (const line of result?.lines ?? [typeof result === "string" ? result : JSON.stringify(result, null, 2)]) console.log(line);
  if (result && result.passed === false) process.exitCode = 1;
}

/** Runs the command `definition.id` (<plugin>.<command>) of a plugin. */
export async function runPluginCommand(definition, input, values) {
  const [pluginId, name] = [definition.plugin, definition.id.slice(definition.plugin.length + 1)];
  const root = path.resolve(input ?? ".");
  const { registry } = await registryFor(root, values.config);
  const log = values.format === "json" ? () => {} : (line) => console.error(line);
  registry.setSession({ trigger: values.trigger ?? "manual", log });
  const handler = (await registry.activate(pluginId)).commands?.[name];
  if (typeof handler !== "function") throw new Error(`plugin "${pluginId}" declares the command "${name}" but does not implement it`);
  const result = await handler({ root, input, values });
  print(result, values);
  return result;
}

function contributionCounts(manifest) {
  const contributes = manifest.contributes;
  return Object.fromEntries(["commands", "tasks", "healthRules", "mcpTools", "hooks", "extensionPoints"]
    .map((key) => [key, contributes[key].length])
    .concat([["extends", Object.keys(contributes.extends).length]]));
}

export async function pluginsListCommand(input, values) {
  const root = path.resolve(input ?? ".");
  const { config, registry } = await registryFor(root, values.config);
  const plugins = registry.list().map(({ id, manifest, source, enabled }) => ({
    id,
    name: manifest.name,
    version: manifest.version,
    source,
    enabled,
    configured: config[manifest.configKey] !== undefined,
    configKey: manifest.configKey,
    contributes: contributionCounts(manifest)
  }));
  const lines = plugins.map((plugin) => {
    const counts = Object.entries(plugin.contributes).filter(([, count]) => count).map(([key, count]) => `${count} ${key}`).join(", ");
    return `${plugin.enabled ? "+" : "-"} ${plugin.id.padEnd(14)} ${plugin.version.padEnd(8)} ${plugin.source.padEnd(12)} ${counts || "nothing"}${plugin.configured ? `  ("${plugin.configKey}" configured)` : ""}`;
  });
  if (!plugins.length) lines.push("No plugins.");
  for (const warning of registry.warnings) lines.push(`warning: ${warning}`);
  print({ schemaVersion: 1, apiVersion: PLUGIN_API_VERSION, plugins, warnings: registry.warnings, lines }, values);
}

export async function pluginsShowCommand(input, values) {
  const { registry } = await registryFor(path.resolve(values.projectRoot ?? "."), values.config);
  const plugin = registry.get(input);
  if (!plugin) throw new Error(`unknown plugin "${input}"; see "bca plugins list"`);
  const { manifest } = plugin;
  const lines = [`${manifest.name} (${manifest.id}) ${manifest.version} - ${plugin.source}${plugin.enabled ? "" : ", disabled"}`, manifest.description, ""];
  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`${title}:`, ...items.map((item) => `  ${item}`), "");
  };
  section("Commands", manifest.contributes.commands.map(({ name, purpose }) => `bca ${manifest.id} ${name} - ${purpose}`));
  section("Tasks (bca run)", manifest.contributes.tasks.map(({ id, summary, before, after }) => `${id} - ${summary}${before.length ? ` (before ${before.join(", ")})` : ""}${after.length ? ` (after ${after.join(", ")})` : ""}`));
  section("Health rules (bca check)", manifest.contributes.healthRules.map(({ id, severity, summary }) => `${id} [${severity}] - ${summary}`));
  section("MCP tools", manifest.contributes.mcpTools.map(({ name, description }) => `${name} - ${description}`));
  section("Hooks", manifest.contributes.hooks.map((event) => `${event} - ${PLUGIN_EVENTS[event]}`));
  section("Extension points", manifest.contributes.extensionPoints.map(({ id, summary }) => `${id} - ${summary}`));
  section("Extends", Object.entries(manifest.contributes.extends).map(([point, items]) => `${point}: ${items.join(", ")}`));
  lines.push(`Configuration: "${manifest.configKey}" in .bca.json`);
  print({ ...plugin, load: undefined, lines }, values);
}

/** Loads, activates, and checks every contribution of every plugin. */
export async function pluginsDoctorCommand(input, values) {
  const root = path.resolve(input ?? ".");
  let config;
  let registry;
  try {
    ({ config, registry } = await registryFor(root, values.config));
  } catch (error) {
    print({ passed: false, plugins: [], lines: [`plugins could not be loaded: ${error.message}`] }, values);
    return;
  }
  const schema = JSON.parse(await fs.readFile(new URL("../../schemas/bca.schema.json", import.meta.url), "utf8"));
  const coreKeys = new Set(Object.keys(schema.properties ?? {}));
  const points = new Set(registry.enabled().flatMap(({ manifest }) => manifest.contributes.extensionPoints.map(({ id }) => id)));
  const results = [];
  for (const plugin of registry.list()) {
    const problems = [];
    const warnings = [];
    const { manifest } = plugin;
    if (coreKeys.has(manifest.configKey)) problems.push(`config key "${manifest.configKey}" is already a BC Atlas setting`);
    for (const task of manifest.contributes.tasks) {
      for (const target of [...task.before, ...task.after]) {
        if (!CORE_TASK_ORDER.includes(target) && !registry.pluginForTask(target)) warnings.push(`task ${task.id}: unknown task "${target}" in before/after`);
      }
    }
    for (const point of Object.keys(manifest.contributes.extends)) {
      if (!points.has(point)) warnings.push(`extends "${point}", but no enabled plugin defines it`);
    }
    if (plugin.enabled) {
      try {
        const implementation = await registry.activate(plugin.id);
        const missing = (kind, names, table) => {
          for (const name of names) if (!table?.[name]) problems.push(`${kind} "${name}" is declared but not implemented`);
        };
        missing("command", manifest.contributes.commands.map(({ name }) => name), implementation.commands);
        missing("task", manifest.contributes.tasks.map(({ id }) => id), implementation.tasks);
        missing("health rule", manifest.contributes.healthRules.map(({ id }) => id), implementation.healthRules);
        missing("MCP tool", manifest.contributes.mcpTools.map(({ name }) => name), implementation.mcpTools);
        missing("hook", manifest.contributes.hooks, implementation.hooks);
        missing("extension", Object.keys(manifest.contributes.extends), implementation.extensions);
        if (config[manifest.configKey] !== undefined && typeof implementation.validateConfig === "function") {
          try {
            await implementation.validateConfig(config[manifest.configKey]);
          } catch (error) {
            problems.push(`"${manifest.configKey}" in .bca.json: ${error.message}`);
          }
        }
      } catch (error) {
        problems.push(`activation failed: ${error.message}`);
      }
    }
    results.push({ id: plugin.id, source: plugin.source, enabled: plugin.enabled, ok: problems.length === 0, problems, warnings });
  }
  const lines = results.flatMap(({ id, enabled, ok, problems, warnings }) => [
    `${ok ? "ok  " : "FAIL"} ${id}${enabled ? "" : " (disabled)"}`,
    ...problems.map((problem) => `     ${problem}`),
    ...warnings.map((warning) => `     warning: ${warning}`)
  ]);
  for (const warning of registry.warnings) lines.push(`warning: ${warning}`);
  print({ passed: results.every(({ ok }) => ok), plugins: results, warnings: registry.warnings, lines }, values);
}

// ------------------------------------------------------------------ template

export function pluginTemplate(id) {
  const name = id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  const manifest = {
    id,
    name: `BC Atlas ${name}`,
    version: "0.1.0",
    description: `TODO: what ${name} brings into BC Atlas.`,
    apiVersion: PLUGIN_API_VERSION,
    main: "src/index.js",
    area: "integrate",
    configKey: id.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()),
    contributes: {
      commands: [{ name: "hello", purpose: `Say hello from ${name}.`, options: { format: { description: "Output mode.", enum: ["text", "json"], default: "text" } }, examples: [`bca ${id} hello`] }],
      tasks: [{ id, summary: `TODO: what the ${id} task does in bca run`, before: ["docs"] }],
      healthRules: [{ id: `${id}-example`, severity: "info", summary: "TODO: what this rule reports." }],
      mcpTools: [],
      hooks: ["run:after"],
      extensionPoints: [],
      extends: {}
    }
  };
  const index = `// ${manifest.name}: a BC Atlas plugin (plugin API ${PLUGIN_API_VERSION}).
// BC Atlas reads plugin.json without running this file. activate(context) runs the first time
// one of the contributions is used and returns their implementations, keyed like plugin.json.

/** @param context { root, config, settings, trigger, log, services, extensions, plugins } */
export function activate(context) {
  return {
    commands: {
      // bca ${id} hello
      async hello({ values }) {
        const settings = context.settings ?? {};
        return { passed: true, plugin: "${id}", settings, lines: [\`Hello from ${name} in \${context.root}\`] };
      }
    },
    tasks: {
      ${JSON.stringify(id)}: {
        // bca run --tasks ${id}; outputs are the folders verify, stage, artifacts, and pull requests use.
        async run({ trigger }) {
          context.log(\`${id}: ran on \${trigger}\`);
          return { ok: true, summary: "nothing to do yet" };
        },
        outputs: (config) => (config.${manifest.configKey}?.outputDir ? [config.${manifest.configKey}.outputDir] : [])
      }
    },
    healthRules: {
      // Findings for bca check: [{ message, object?, file?, line? }]; the severity comes from plugin.json.
      ${JSON.stringify(`${id}-example`)}: async ({ model }) => []
    },
    hooks: {
      "run:after": async ({ trigger, results }) => {}
    },
    // Optional: checked by "bca plugins doctor" when .bca.json has a "${manifest.configKey}" section.
    validateConfig(settings) {
      if (typeof settings !== "object") throw new Error("must be an object");
    }
  };
}
`;
  const test = `import assert from "node:assert/strict";
import test from "node:test";
import { activate } from "../src/index.js";

const context = { root: ".", config: {}, settings: {}, trigger: "manual", log: () => {}, services: {}, extensions: { get: async () => [] }, plugins: { list: () => [] } };

test("hello answers", async () => {
  const result = await activate(context).commands.hello({ values: {} });
  assert.equal(result.passed, true);
});

test("the task runs", async () => {
  const outcome = await activate(context).tasks[${JSON.stringify(id)}].run({ trigger: "ci" });
  assert.equal(outcome.ok, true);
});
`;
  const readme = `# ${manifest.name}

A [BC Atlas](https://github.com/SchulzOli/BC-Atlas) plugin.

| Contributes | |
|---|---|
| Command | \`bca ${id} hello\` |
| Task | \`${id}\` for \`bca run\` (before \`docs\`) |
| Health rule | \`${id}-example\` in \`bca check\` |
| Hook | \`run:after\` |

Use it in a project:

\`\`\`json
{ "plugins": [{ "path": "../bc-atlas-plugin-${id}" }], "${manifest.configKey}": {} }
\`\`\`

Published as \`bc-atlas-plugin-${id}\`, BC Atlas finds it in the project's dependencies without configuration.
Check it with \`bca plugins doctor\`; test it with \`node --test\`.
`;
  const packageJson = {
    name: `bc-atlas-plugin-${id}`,
    version: manifest.version,
    description: manifest.description,
    type: "module",
    main: "src/index.js",
    files: ["plugin.json", "src/", "README.md"],
    keywords: ["bc-atlas", "bc-atlas-plugin", "business-central", "al"],
    peerDependencies: { "bc-atlas": `>=${pkg.version}` },
    scripts: { test: "node --test" }
  };
  return [
    ["plugin.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["package.json", `${JSON.stringify(packageJson, null, 2)}\n`],
    ["src/index.js", index],
    ["test/plugin.test.js", test],
    ["README.md", readme]
  ];
}

export async function pluginsNewCommand(input, values) {
  if (!/^[a-z][a-z0-9-]*$/u.test(input ?? "")) throw new Error("plugin id must be lowercase letters, digits, and hyphens, starting with a letter");
  const target = path.resolve(values.output && values.output !== "plugins/<plugin-id>" ? values.output : path.join("plugins", input));
  const existing = await fs.readdir(target).catch(() => []);
  if (existing.length) throw new Error(`${target} is not empty`);
  const files = pluginTemplate(input);
  for (const [file, content] of files) {
    if (values.dryRun) {
      console.log(`would write ${path.join(target, file)}`);
      continue;
    }
    await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await fs.writeFile(path.join(target, file), content);
    console.log(`wrote ${path.join(target, file)}`);
  }
  if (!values.dryRun) console.log(`\nAdd it to .bca.json: "plugins": [{ "path": "${path.relative(process.cwd(), target).replaceAll("\\", "/")}" }], then run "bca plugins doctor".`);
}
