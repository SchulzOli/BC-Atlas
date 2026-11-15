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
// Steps are a graph. A step with an "id" can be waited for: "after" names the steps a step comes
// after, each with a condition ("if": passed, the default; failed; always). A step without
// "after" starts with the flow.
//
//   { "id": "gate", "what": "check" },
//   { "what": "layers", "to": "docs/system", "after": ["gate"] },
//   { "what": "check", "to": "docs/health.md", "after": [{ "step": "gate", "if": "failed" }] }
//
// `bca run --trigger <name>` runs the flows of that trigger after its tasks;
// what they save is delivered with the sync mode of the trigger, like the
// output of a task. `bca run --flow <id>` runs one by name.
import path from "node:path";
import { syncModesFor, TRIGGERS } from "../automation/config.js";
import { ARTIFACTS, stepOutputs } from "./artifacts.js";

export const FLOW_SCHEMA = "bc-atlas.flows/1";
const RESERVED = new Set(["what", "to", "id", "after"]);
export const CONDITIONS = Object.freeze({
  passed: "when that step passed",
  failed: "when that step failed",
  always: "whatever became of that step"
});
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
    return { what, plugin: true, options: {}, ...wiring(step, where) };
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
  return { what, ...(to ? { to } : {}), options, ...wiring(step, where) };
}

/** The name of a step and the steps it comes after: { id?, after: [{ step, if }] }. */
function wiring(step, where) {
  const id = step.id === undefined || step.id === null || step.id === "" ? undefined : String(step.id).trim();
  if (id !== undefined && !ID.test(id)) throw new Error(`flows: ${where} has the id "${step.id}"; an id is lowercase letters, digits, ".", "_", or "-"`);
  const after = [];
  for (const entry of [step.after ?? []].flat().flatMap((item) => (typeof item === "string" ? item.split(",").map((part) => part.trim()).filter(Boolean) : [item]))) {
    const wire = typeof entry === "string" ? Object.fromEntries(entry.split(":").map((part, index) => [index ? "if" : "step", part.trim()])) : entry;
    if (!wire || typeof wire !== "object" || !wire.step) throw new Error(`flows: ${where} has an "after" that names no step; use "after": ["gate"] or [{ "step": "gate", "if": "failed" }]`);
    const condition = wire.if ?? "passed";
    if (!Object.hasOwn(CONDITIONS, condition)) throw new Error(`flows: ${where} comes after "${wire.step}" if "${condition}"; use ${Object.keys(CONDITIONS).join(", ")}`);
    if (after.some((other) => other.step === String(wire.step))) throw new Error(`flows: ${where} comes after "${wire.step}" twice`);
    after.push({ step: String(wire.step), if: condition });
  }
  return { ...(id ? { id } : {}), after };
}

/**
 * The order to run the steps of a flow in: every step after those it waits for, else as written.
 * @param steps normalized steps
 * @returns indexes into steps; throws when the wires go in a circle
 */
export function stepOrder(steps, flow = "") {
  const at = new Map(steps.flatMap((step, index) => (step.id ? [[step.id, index]] : [])));
  const order = [];
  const state = new Array(steps.length).fill(0);
  const visit = (index, path) => {
    if (state[index] === 2) return;
    if (state[index] === 1) throw new Error(`flows: the steps of flow "${flow}" wait for each other in a circle: ${[...path, steps[index].id].join(" > ")}`);
    state[index] = 1;
    for (const wire of steps[index].after) visit(at.get(wire.step), [...path, steps[index].id ?? `step ${index + 1}`]);
    state[index] = 2;
    order.push(index);
  };
  steps.forEach((_, index) => visit(index, []));
  return order;
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
    // The wires: every name once, every "after" a step of this flow, and no circle.
    const names = new Set();
    steps.forEach((step, at) => {
      if (!step.id) return;
      if (names.has(step.id)) throw new Error(`flows: flow "${id}" has two steps "${step.id}"`);
      names.add(step.id);
    });
    steps.forEach((step, at) => {
      for (const wire of step.after) {
        if (!names.has(wire.step)) throw new Error(`flows: step ${at + 1} of flow "${id}" comes after "${wire.step}", which is not a step of this flow${names.size ? `; it has ${[...names].join(", ")}` : "; give the step it waits for an \"id\""}`);
        if (wire.step === step.id) throw new Error(`flows: step ${at + 1} of flow "${id}" comes after itself`);
      }
    });
    stepOrder(steps, id);
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
export const stepJson = (step) => ({
  ...(step.id ? { id: step.id } : {}),
  what: step.what,
  ...(step.to ? { to: step.to } : {}),
  ...step.options,
  ...(step.after?.length ? { after: step.after.map((wire) => (wire.if === "passed" ? wire.step : { step: wire.step, if: wire.if })) } : {})
});

/** A name for a step that no step of the flow has: its artifact, then check-2, check-3. */
export function freeStepId(steps, what) {
  const taken = new Set(steps.map(({ id }) => id).filter(Boolean));
  const base = flowId(what);
  for (let count = 1; ; count += 1) {
    const candidate = count === 1 ? base : `${base}-${count}`;
    if (!taken.has(candidate)) return candidate;
  }
}

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
//   { op: "wire", flow, from, into, if? }              step `into` comes after step `from` (numbers from 1), if passed, failed, or always
//   { op: "unwire", flow, from, into }                 it no longer does
//   { op: "unstep", flow, at }                         remove a step; steps that waited for it no longer do
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
      const filled = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && !value.length)));
      if (at === undefined || at === null || at === "") flow.steps.push(filled(step));
      else {
        // A change names what it changes and keeps the rest; an empty value takes an option away.
        // Another artifact starts anew, but stays the step it is: its name, and what it waits for.
        const index = position(flow, at, flow.id);
        const { id, after, ...rest } = flow.steps[index];
        flow.steps[index] = filled({ ...(step.what && step.what !== rest.what ? {} : rest), ...(id ? { id } : {}), ...(after ? { after } : {}), ...step });
        // A step that is renamed is still the one the others wait for.
        if (id && step.id && step.id !== id) {
          for (const other of flow.steps) if (other.after) other.after = [other.after].flat().map((wire) => (typeof wire === "string" ? (wire.split(":")[0] === id ? [step.id, ...wire.split(":").slice(1)].join(":") : wire) : wire?.step === id ? { ...wire, step: step.id } : wire));
        }
      }
    } else if (op === "wire" || op === "unwire") {
      const flow = need(operation);
      const from = flow.steps[position(flow, operation.from, flow.id)];
      const into = flow.steps[position(flow, operation.into, flow.id)];
      if (from === into) throw new Error(`flows: step ${operation.into} of flow "${flow.id}" cannot come after itself`);
      // A step that is waited for needs a name.
      if (!from.id) from.id = freeStepId(flow.steps, from.what);
      const others = [into.after ?? []].flat().filter((wire) => (typeof wire === "string" ? wire.split(":")[0] : wire?.step) !== from.id);
      if (op === "wire") others.push(!operation.if || operation.if === "passed" ? from.id : { step: from.id, if: operation.if });
      if (others.length) into.after = others;
      else delete into.after;
    } else if (op === "unstep") {
      const flow = need(operation);
      const [gone] = flow.steps.splice(position(flow, operation.at, flow.id), 1);
      // What waited for it no longer does.
      if (gone.id) {
        for (const other of flow.steps) {
          if (!other.after) continue;
          other.after = [other.after].flat().filter((wire) => (typeof wire === "string" ? wire.split(":")[0] : wire?.step) !== gone.id);
          if (!other.after.length) delete other.after;
        }
      }
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
      throw new Error(`flows: unknown operation "${op ?? ""}"; use set, remove, step, wire, unwire, unstep, move, or deliver`);
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
      const after = step.after.map((wire) => `${wire.step}${wire.if === "passed" ? "" : ` (if ${wire.if})`}`).join(", ");
      lines.push(`  ${String(index + 1).padStart(2)}. ${(step.id && step.id !== step.what ? `${step.what} "${step.id}"` : step.what).padEnd(16)} ${step.to ? `-> ${step.to}` : step.plugin ? "(plugin task)" : "(gate)"}${options ? `  ${options}` : ""}${after ? `  after ${after}` : ""}`);
    });
    if (!flow.steps.length) lines.push("  no steps yet");
    lines.push("");
  }
  return lines.join("\n");
}
