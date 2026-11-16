// Runs flows (config.js) and changes them in .bca.json.
import fs from "node:fs/promises";
import path from "node:path";
import { automationConfig, EVENTS, HOOKS, syncModesFor, SYNC_MODES, triggerKind, triggerSummary, TRIGGERS } from "../automation/config.js";
import { loadPlugins } from "../plugins/registry.js";
import { ARTIFACTS, makeArtifact, stepOutputs } from "./artifacts.js";
import { applyFlowOperations, CONDITIONS, FLOW_SCHEMA, flowsConfig, stepJson, stepOrder } from "./config.js";
import { readFlowCanvas, writeFlowCanvas } from "./canvas.js";
import { DEFAULT_CRON } from "./export.js";

export { ARTIFACTS } from "./artifacts.js";
export { DEFAULT_CRON, exportFlow, FLOW_EXPORT_TARGETS } from "./export.js";
export { CANVAS_FILE, normalizeCanvas, readFlowCanvas, writeFlowCanvas } from "./canvas.js";
export { applyFlowOperations, CONDITIONS, FLOW_SCHEMA, flowId, flowOutputs, flowsConfig, flowsFor, flowsText, freeStepId, stepJson, stepKey, stepOrder } from "./config.js";

/**
 * Runs flows. The steps of a flow run each after those it waits for, else as written. A step
 * whose wires say otherwise is skipped: it comes after a step if that one passed (the default),
 * failed, or whatever became of it. A step that fails does not stop those that do not wait for
 * it: a run says everything that is wrong at once.
 * @param flows normalized flows (flowsConfig)
 * @param context { root, config, values, log, appPath, plugins, runPluginTask(task) }
 * @returns [{ flow, title, ok, steps: [{ what, id?, to?, status: "passed" | "failed" | "skipped", ok, summary, outputs }] }] steps as written
 */
export async function runFlows(flows, context) {
  const log = context.log ?? (() => {});
  const results = [];
  for (const flow of flows) {
    log(`flow ${flow.id}: ${flow.steps.length} step(s)`);
    const steps = new Array(flow.steps.length);
    const status = new Map();
    for (const index of stepOrder(flow.steps, flow.id)) {
      const step = flow.steps[index];
      const name = `${step.id && step.id !== step.what ? `${step.what} "${step.id}"` : step.what}${step.to ? ` -> ${step.to}` : ""}`;
      // Every wire into the step has to hold.
      const unmet = step.after.find((wire) => wire.if !== "always" && status.get(wire.step) !== wire.if);
      let result;
      let outputs = [];
      if (unmet) {
        result = { status: "skipped", summary: `skipped: it comes after ${unmet.step} if that ${unmet.if}, and ${unmet.step} ${status.get(unmet.step) === "skipped" ? "was skipped" : status.get(unmet.step)}` };
      } else {
        try {
          const made = step.plugin
            ? await context.runPluginTask(step.what)
            : await makeArtifact(step, { ...context, flow: flow.id, steps: flow.steps });
          result = { status: made.ok === false ? "failed" : "passed", summary: made.summary };
        } catch (error) {
          result = { status: "failed", summary: error.message };
        }
        outputs = step.plugin ? await context.plugins.taskOutputs(step.what, context.config) : stepOutputs(step);
      }
      if (step.id) status.set(step.id, result.status);
      steps[index] = { what: step.what, ...(step.id ? { id: step.id } : {}), ...(step.to ? { to: step.to } : {}), status: result.status, ok: result.status !== "failed", summary: result.summary, outputs };
      log(`  ${{ passed: "ok", failed: "failed", skipped: "skipped" }[result.status]}  ${name}: ${result.summary}`);
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
  // How the builder lays the flows out (canvas.js).
  return { ...description(config, plugins.taskSummaries(), file), canvas: await readFlowCanvas(root) };
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
    triggers: Object.fromEntries([
      ...Object.entries(TRIGGERS).map(([name, summary]) => [name, {
        summary,
        kind: triggerKind(name),
        // Whether a hook, a pipeline, or a schedule knows the trigger (bca setup installs them).
        configured: Boolean(automation.triggers[name]),
        sync: automation.triggers[name]?.sync ?? "none",
        modes: syncModesFor(name),
        tasks: automation.triggers[name]?.tasks ?? [],
        ...(name === "schedule" ? { cron: automation.triggers.schedule?.cron ?? DEFAULT_CRON } : {})
      }]),
      // The triggers of your own: what starts each, as it is defined.
      ...Object.entries(automation.triggers).filter(([, trigger]) => trigger.custom).map(([name, trigger]) => [name, {
        summary: triggerSummary(name, trigger.custom),
        kind: triggerKind(name, trigger.custom),
        custom: true,
        configured: true,
        sync: trigger.sync,
        modes: syncModesFor(name, trigger.custom),
        tasks: trigger.tasks,
        ...trigger.custom
      }])
    ]),
    // What a trigger of your own can start on.
    events: EVENTS,
    hooks: HOOKS,
    syncModes: SYNC_MODES,
    conditions: CONDITIONS,
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
  const freed = [];
  const rerouted = [];
  const next = applyFlowOperations(config, operations, { pluginTasks: Object.keys(pluginTasks), freed, rerouted });
  const changed = JSON.stringify(next) !== JSON.stringify(config);
  const written = changed && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
    // Steps that left a flow with the step they ran through stay on the canvas of the builder, in no flow.
    if (freed.length) {
      const canvas = await readFlowCanvas(root);
      let number = Math.max(0, ...canvas.loose.flatMap(({ key, group }) => [key, group]).map((name) => Number(/^loose:(\d+)$/u.exec(name ?? "")?.[1] ?? 0)));
      for (const { steps } of freed) {
        const group = `loose:${++number}`;
        for (const { key, step } of steps) {
          const loose = `loose:${++number}`;
          canvas.loose.push({ key: loose, step, group });
          if (canvas.positions[key]) canvas.positions[loose] = canvas.positions[key];
        }
      }
      await writeFlowCanvas(root, canvas);
    }
  }
  return {
    ...description(next, pluginTasks, file),
    canvas: await readFlowCanvas(root),
    written,
    changed,
    // What left a flow without being removed: [{ flow, steps: [json] }].
    freed: freed.map(({ flow, steps }) => ({ flow, steps: steps.map(({ step }) => step) })),
    // The steps that came after a step that was removed, and what they come after now: [{ flow, step, after }].
    rerouted
  };
}
