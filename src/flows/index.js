// Runs flows (config.js) and changes them in .bca.json.
import fs from "node:fs/promises";
import path from "node:path";
import { automationConfig, syncModesFor, SYNC_MODES, TRIGGERS } from "../automation/config.js";
import { loadPlugins } from "../plugins/registry.js";
import { ARTIFACTS, makeArtifact, stepOutputs } from "./artifacts.js";
import { applyFlowOperations, FLOW_SCHEMA, flowsConfig, stepJson } from "./config.js";

export { ARTIFACTS } from "./artifacts.js";
export { exportFlow, FLOW_EXPORT_TARGETS } from "./export.js";
export { applyFlowOperations, FLOW_SCHEMA, flowId, flowOutputs, flowsConfig, flowsFor, flowsText, stepJson } from "./config.js";

/**
 * Runs flows, step by step. A step that fails does not stop the others: a
 * run says everything that is wrong at once.
 * @param flows normalized flows (flowsConfig)
 * @param context { root, config, values, log, appPath, plugins, runPluginTask(task) }
 * @returns [{ flow, title, ok, steps: [{ what, to?, ok, summary, outputs }] }]
 */
export async function runFlows(flows, context) {
  const log = context.log ?? (() => {});
  const results = [];
  for (const flow of flows) {
    log(`flow ${flow.id}: ${flow.steps.length} step(s)`);
    const steps = [];
    for (const step of flow.steps) {
      let result;
      try {
        result = step.plugin
          ? await context.runPluginTask(step.what)
          : await makeArtifact(step, { ...context, flow: flow.id, steps: flow.steps });
      } catch (error) {
        result = { ok: false, summary: error.message };
      }
      const outputs = step.plugin ? await context.plugins.taskOutputs(step.what, context.config) : stepOutputs(step);
      steps.push({ what: step.what, ...(step.to ? { to: step.to } : {}), ok: result.ok !== false, summary: result.summary, outputs });
      log(`  ${result.ok === false ? "failed" : "ok"}  ${step.what}${step.to ? ` -> ${step.to}` : ""}: ${result.summary}`);
    }
    results.push({ flow: flow.id, title: flow.title, ok: steps.every(({ ok }) => ok), steps });
  }
  return results;
}

/** The catalog a builder shows: what a step can make, with its options. */
export function artifactCatalog(pluginTasks = {}) {
  return [
    ...Object.entries(ARTIFACTS).map(([id, artifact]) => ({
      id,
      title: artifact.title,
      summary: artifact.summary,
      target: artifact.target,
      ...(artifact.to ? { to: artifact.to } : {}),
      ...(artifact.extensions ? { extensions: artifact.extensions } : {}),
      ...(artifact.optional ? { optional: true } : {}),
      ...(artifact.gate ? { gate: true } : {}),
      ...(artifact.open ? { open: true } : {}),
      ...(artifact.stable === false ? { stable: false } : {}),
      options: Object.entries(artifact.options).map(([name, option]) => ({ name, ...option }))
    })),
    ...Object.entries(pluginTasks).map(([id, summary]) => ({ id, title: id, summary, target: "plugin", plugin: true, options: [] }))
  ];
}

/**
 * The flows of a project as they are defined, with everything a builder needs to change them.
 * @returns { schema, file, flows: [{ id, title, when, steps: [json] }], triggers: { [name]: { summary, sync, modes, tasks } }, artifacts }
 */
export async function describeFlows(input, { config: configPath, projectRoot } = {}) {
  const root = path.resolve(projectRoot ?? input ?? ".");
  const file = configPath ? path.resolve(configPath) : path.join(root, ".bca.json");
  const config = await readConfig(file);
  const plugins = await loadPlugins(root, config);
  return description(config, plugins.taskSummaries(), file);
}

function description(config, pluginTasks, file) {
  const flows = flowsConfig(config, { pluginTasks: Object.keys(pluginTasks) });
  let automation = { triggers: {} };
  try {
    automation = automationConfig(config, { pluginTasks: Object.keys(pluginTasks) });
  } catch {
    // The flows are shown although the automation section is not valid; bca run says why.
  }
  return {
    schema: FLOW_SCHEMA,
    file,
    flows: flows.map((flow) => ({ id: flow.id, title: flow.title, when: flow.when, steps: flow.steps.map(stepJson) })),
    triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([name, summary]) => [name, {
      summary,
      // Whether a hook, a pipeline, or a schedule knows the trigger (bca setup installs them).
      configured: Boolean(automation.triggers[name]),
      sync: automation.triggers[name]?.sync ?? "none",
      modes: syncModesFor(name),
      tasks: automation.triggers[name]?.tasks ?? []
    }])),
    syncModes: SYNC_MODES,
    artifacts: artifactCatalog(pluginTasks)
  };
}

async function readConfig(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`${path.basename(file)} is not valid JSON: ${error.message}`);
  }
}

/**
 * Changes the flows of a project in .bca.json.
 * @param input the project
 * @param options { operations, dryRun, config, projectRoot }
 * @returns the description of the flows after the change, with { written, changed }
 */
export async function defineFlows(input, { operations = [], dryRun = false, config: configPath, projectRoot } = {}) {
  const root = path.resolve(projectRoot ?? input ?? ".");
  const file = configPath ? path.resolve(configPath) : path.join(root, ".bca.json");
  const config = await readConfig(file);
  const plugins = await loadPlugins(root, config);
  const pluginTasks = plugins.taskSummaries();
  // What is not valid never reaches the file.
  const next = applyFlowOperations(config, operations, { pluginTasks: Object.keys(pluginTasks) });
  const changed = JSON.stringify(next) !== JSON.stringify(config);
  const written = changed && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { ...description(next, pluginTasks, file), written, changed };
}
