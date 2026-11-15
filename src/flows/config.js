// Flows in .bca.json: your own workflows that say what to make from the
// source (the artifacts), when (the triggers), and where to save it.
//
//   "flows": [
//     {
//       "id": "docs",
//       "title": "Documentation in the repository",
//       "when": ["pre-push", "ci"],
//       "steps": [
//         { "what": "layers", "to": "docs/system" },
//         { "what": "view", "lens": "data", "form": "diagram", "to": "docs/pictures/data.svg" },
//         { "what": "handbook", "to": "wiki/handbook", "language": "de" },
//         { "what": "check" }
//       ]
//     }
//   ]
//
// `bca run --trigger <name>` runs the flows of that trigger after its tasks;
// what they save is delivered with the sync mode of the trigger, like the
// output of a task. `bca run --flow <id>` runs one by name.
import path from "node:path";
import { syncModesFor, TRIGGERS } from "../automation/config.js";
import { ARTIFACTS, stepOutputs } from "./artifacts.js";

export const FLOW_SCHEMA = "bc-atlas.flows/1";
const RESERVED = new Set(["what", "to"]);
const ID = /^[a-z0-9][a-z0-9._-]*$/u;
const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const posix = (value) => String(value).trim().replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");

/** A valid id from a title: "Docs for the wiki" is docs-for-the-wiki. */
export function flowId(title) {
  return String(title ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9._]+/gu, "-").replace(/^[-._]+|-+$/gu, "") || "flow";
}

function normalizeStep(step, where, pluginTasks) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`flows: ${where} must be an object such as { "what": "layers", "to": "docs/layers" }`);
  const what = String(step.what ?? "").trim();
  const artifact = ARTIFACTS[what];
  const plugin = !artifact && pluginTasks.includes(what);
  if (!artifact && !plugin) {
    throw new Error(`flows: ${where} makes "${what}", which is not an artifact; use ${[...Object.keys(ARTIFACTS), ...pluginTasks].join(", ")}`);
  }
  const options = Object.fromEntries(Object.entries(step).filter(([key, value]) => !RESERVED.has(key) && value !== undefined && value !== null && value !== ""));
  if (plugin) {
    // A task of a plugin saves where its own section of .bca.json says.
    if (step.to) throw new Error(`flows: ${where} runs the task "${what}" of a plugin, which saves where its own settings say; remove "to"`);
    if (Object.keys(options).length) throw new Error(`flows: ${where} runs the task "${what}" of a plugin, which takes its settings from its own section of .bca.json; remove ${Object.keys(options).join(", ")}`);
    return { what, plugin: true, options: {} };
  }
  if (!artifact.open) {
    const unknown = Object.keys(options).filter((key) => !artifact.options[key]);
    if (unknown.length) throw new Error(`flows: ${where} (${what}) has no option "${unknown[0]}"; it takes ${Object.keys(artifact.options).join(", ") || "no options"}`);
  }
  for (const [key, value] of Object.entries(options)) {
    const allowed = artifact.options[key]?.values;
    if (allowed && !allowed.includes(String(value))) throw new Error(`flows: ${where} (${what}) "${key}" must be one of ${allowed.join(", ")}, not "${value}"`);
  }
  let to = step.to === undefined || step.to === null || step.to === "" ? artifact.to : posix(step.to);
  if (to !== undefined) {
    if (!to || path.isAbsolute(to) || /^[A-Za-z]:/u.test(to)) throw new Error(`flows: ${where} (${what}) saves to "${step.to}"; "to" is a path relative to the project, such as ${artifact.to ?? "docs/health.md"}`);
    if (artifact.target === "file") {
      const extension = path.posix.extname(to).slice(1).toLowerCase();
      if (!artifact.extensions.includes(extension)) throw new Error(`flows: ${where} (${what}) saves to "${to}"; it writes one file that ends in ${artifact.extensions.map((item) => `.${item}`).join(", ")}`);
    }
  } else if (!artifact.optional) {
    throw new Error(`flows: ${where} (${what}) needs "to": where to save it`);
  }
  return { what, ...(to ? { to } : {}), options };
}

/**
 * Normalizes and validates the flows of a configuration.
 * @param config the values of .bca.json
 * @param pluginTasks ids of the tasks the project's plugins contribute; a step may run one
 * @returns [{ id, title, when: [trigger], steps: [{ what, to?, options, plugin? }] }]
 */
export function flowsConfig(config = {}, { pluginTasks = [] } = {}) {
  const flows = config.flows ?? [];
  if (!Array.isArray(flows)) throw new Error("flows: \"flows\" in .bca.json must be a list of flows");
  const seen = new Set();
  const saved = new Map();
  return flows.map((flow, index) => {
    if (!flow || typeof flow !== "object" || Array.isArray(flow)) throw new Error(`flows: flow ${index + 1} must be an object with "id" and "steps"`);
    const id = String(flow.id ?? "").trim();
    if (!ID.test(id)) throw new Error(`flows: flow ${index + 1} needs an "id" of lowercase letters, digits, ".", "_", or "-"${flow.id ? `, not "${flow.id}"` : ""}`);
    if (seen.has(id)) throw new Error(`flows: there are two flows "${id}"`);
    seen.add(id);
    const when = [...new Set(several(flow.when))];
    for (const trigger of when) if (!TRIGGERS[trigger]) throw new Error(`flows: flow "${id}" runs on "${trigger}", which is not a trigger; use ${Object.keys(TRIGGERS).join(", ")}`);
    if (!Array.isArray(flow.steps ?? [])) throw new Error(`flows: "steps" of flow "${id}" must be a list`);
    const steps = (flow.steps ?? []).map((step, at) => normalizeStep(step, `step ${at + 1} of flow "${id}"`, pluginTasks));
    for (const step of steps) {
      for (const output of stepOutputs(step)) {
        // Two steps that save to one place would overwrite each other, whatever their order.
        if (saved.has(output)) throw new Error(`flows: "${output}" is saved twice: by ${saved.get(output)} and by ${step.what} of flow "${id}"; give one of them another "to"`);
        saved.set(output, `${step.what} of flow "${id}"`);
      }
    }
    return { id, title: String(flow.title ?? "").trim() || id, when, steps };
  });
}

/** A normalized step as it is written in .bca.json. */
export const stepJson = (step) => ({ what: step.what, ...(step.to ? { to: step.to } : {}), ...step.options });

/** What the flows save, relative to the project. */
export function flowOutputs(flows) {
  return [...new Set(flows.flatMap(({ steps }) => steps.flatMap(stepOutputs)))];
}

/** The flows a trigger runs. */
export const flowsFor = (flows, trigger) => flows.filter(({ when }) => when.includes(trigger));

// ------------------------------------------------------------------ define
// A change to the flows is a list of operations, as for the simulation
// (src/simulation/define.js): the Flow menu of the view, `bca flow define`,
// and the MCP tool bc_atlas_flow_define all send them.
//
//   { op: "set", flow, title?, when? }                 add a flow, or change its title or triggers
//   { op: "remove", flow }                             remove a flow
//   { op: "step", flow, what, to?, at?, ...options }   add a step; with at (1-based) change that step
//   { op: "unstep", flow, at }                         remove a step
//   { op: "move", flow, at, by }                       move a step up (-1) or down (1)
//   { op: "deliver", trigger, sync }                   how a trigger delivers what was saved (its sync mode)

const position = (flow, at, id) => {
  if (!/^[1-9]\d*$/u.test(String(at)) || Number(at) > (flow.steps ?? []).length) throw new Error(`flows: flow "${id}" has no step ${at}; it has ${(flow.steps ?? []).length}`);
  return Number(at) - 1;
};

/**
 * Applies operations to a configuration.
 * @returns the changed configuration (a copy); throws when the result is not valid
 */
export function applyFlowOperations(config = {}, operations = [], { pluginTasks = [] } = {}) {
  const next = structuredClone(config);
  const flows = Array.isArray(next.flows) ? next.flows : [];
  const find = (id) => flows.find((flow) => flow.id === id);
  const need = (operation) => {
    const flow = find(operation.flow);
    if (!flow) throw new Error(`flows: there is no flow "${operation.flow ?? ""}"; there ${flows.length === 1 ? "is" : "are"} ${flows.map(({ id }) => id).join(", ") || "none"}`);
    return flow;
  };
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw new Error("flows: an operation must be an object such as { \"op\": \"set\", \"flow\": \"docs\" }");
    const { op } = operation;
    if (op === "set") {
      if (!operation.flow) throw new Error("flows: set needs \"flow\": the id of the flow");
      let flow = find(operation.flow);
      if (!flow) flows.push(flow = { id: operation.flow, steps: [] });
      if (operation.title !== undefined) {
        if (operation.title) flow.title = operation.title;
        else delete flow.title;
      }
      if (operation.when !== undefined) flow.when = [...new Set(several(operation.when))];
      // Keys in one order, whatever was set first.
      const { id, title, when, steps, ...rest } = flow;
      for (const key of Object.keys(flow)) delete flow[key];
      Object.assign(flow, { id, ...(title ? { title } : {}), when: when ?? [], steps: steps ?? [], ...rest });
    } else if (op === "remove") {
      flows.splice(flows.indexOf(need(operation)), 1);
    } else if (op === "step") {
      const flow = need(operation);
      const { op: _op, flow: _flow, at, ...step } = operation;
      flow.steps ??= [];
      const filled = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== null && value !== undefined));
      if (at === undefined || at === null || at === "") flow.steps.push(filled(step));
      else {
        // A change names what it changes and keeps the rest; an empty value takes an option away.
        const index = position(flow, at, flow.id);
        flow.steps[index] = filled({ ...(step.what && step.what !== flow.steps[index].what ? {} : flow.steps[index]), ...step });
      }
    } else if (op === "unstep") {
      const flow = need(operation);
      flow.steps.splice(position(flow, operation.at, flow.id), 1);
    } else if (op === "move") {
      const flow = need(operation);
      const from = position(flow, operation.at, flow.id);
      const to = from + Number(operation.by ?? 0);
      if (!Number.isInteger(to) || to < 0 || to >= flow.steps.length) throw new Error(`flows: step ${operation.at} of flow "${flow.id}" cannot move there`);
      flow.steps.splice(to, 0, ...flow.steps.splice(from, 1));
    } else if (op === "deliver") {
      const { trigger, sync } = operation;
      if (!TRIGGERS[trigger]) throw new Error(`flows: "${trigger ?? ""}" is not a trigger; use ${Object.keys(TRIGGERS).join(", ")}`);
      if (!syncModesFor(trigger).includes(sync)) throw new Error(`flows: the trigger "${trigger}" delivers with ${syncModesFor(trigger).join(", ")}, not "${sync ?? ""}"`);
      next.automation ??= {};
      next.automation.triggers ??= {};
      next.automation.triggers[trigger] = { tasks: [], ...(next.automation.triggers[trigger] ?? {}), sync };
    } else {
      throw new Error(`flows: unknown operation "${op ?? ""}"; use set, remove, step, unstep, move, or deliver`);
    }
  }
  if (flows.length) next.flows = flows;
  else delete next.flows;
  // Fails before anything is written when the result is not valid.
  flowsConfig(next, { pluginTasks });
  return next;
}

/** The flows as text, for the terminal. */
export function flowsText(flows, { triggers = {} } = {}) {
  if (!flows.length) return "No flows yet. Add one: bca flow define --flow docs --when pre-push,ci --step layers --to docs/layers\n";
  const lines = [];
  for (const flow of flows) {
    lines.push(`${flow.id}${flow.title !== flow.id ? `  ${flow.title}` : ""}`);
    lines.push(`  when   ${flow.when.length ? flow.when.map((trigger) => `${trigger}${triggers[trigger]?.sync && triggers[trigger].sync !== "none" ? ` (${triggers[trigger].sync})` : ""}`).join(", ") : "only by name: bca run --flow " + flow.id}`);
    flow.steps.forEach((step, index) => {
      const options = Object.entries(step.options).map(([key, value]) => `${key}=${value}`).join(" ");
      lines.push(`  ${String(index + 1).padStart(2)}. ${step.what.padEnd(16)} ${step.to ? `-> ${step.to}` : step.plugin ? "(plugin task)" : "(gate)"}${options ? `  ${options}` : ""}`);
    });
    if (!flow.steps.length) lines.push("  no steps yet");
    lines.push("");
  }
  return lines.join("\n");
}
