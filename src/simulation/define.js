// Defining the simulation: the company of the battle test (src/simulation/company.js)
// changed by operations instead of by hand. The view (its Simulate menu), the
// command `bca simulate define`, and the MCP tool bc_atlas_simulation_define
// all send the same operations, and this module applies them to the
// `simulation` section of .bca.json.
//
//   { op: "set", kind: "agent", name: "Ben", roles: ["Team lead"] }
//   { op: "set", kind: "role", name: "Team lead", permissionSets: ["PR - APPROVE"], taskGroups: ["Approval"], mustNot: ["Ordering"] }
//   { op: "set", kind: "taskGroup", name: "Approval", tasks: ["purchase-request-approve"] }
//   { op: "set", kind: "requirement", name: "REQ-2", title: "A team lead approves every request", tasks: ["purchase-request-approve"] }
//   { op: "remove", kind: "agent", name: "Ben" }
//   { op: "ground", task: "purchase-request-approve", snapshot: "approve-a-released-purchase-request" }
//   { op: "unground", task: "purchase-request-approve" }
//   { op: "company", name: "Contoso GmbH" }
//
// "set" changes the fields it names and keeps the others; an empty list or
// text takes a field away. A snapshot is a recording of the process in
// Business Central (the sync plugin): what really ran, as the ground the
// process test stands on.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeIdentifier } from "../resolver.js";
import { simulate } from "./index.js";

export const DEFINE_KINDS = Object.freeze(["agent", "role", "taskGroup", "requirement"]);
const LISTS = { agent: "agents", role: "roles", taskGroup: "taskGroups", requirement: "requirements" };
const KEYS = { agent: "name", role: "name", taskGroup: "name", requirement: "id" };
/** The fields of each kind: lists of names, or one text. */
export const DEFINE_FIELDS = Object.freeze({
  agent: { roles: "list", permissionSets: "list", taskGroups: "list", tasks: "list", mustNot: "list" },
  role: { description: "text", permissionSets: "list", taskGroups: "list", tasks: "list", features: "list", mustNot: "list" },
  taskGroup: { description: "text", tasks: "list", features: "list" },
  requirement: { title: "text", description: "text", tasks: "list", features: "list", objects: "list" }
});
const KIND_NAMES = { agent: "agent", role: "role", taskGroup: "task group", requirement: "requirement" };
const same = (a, b) => normalizeIdentifier(a) === normalizeIdentifier(b);
const kindOf = (value) => DEFINE_KINDS.find((kind) => normalizeIdentifier(kind) === normalizeIdentifier(String(value ?? "").replace(/[-_ ]/gu, ""))) ;

/**
 * Applies operations to a simulation section.
 * @returns the new section; the given one is not changed
 */
export function applyOperations(simulation = {}, operations = []) {
  if (!Array.isArray(operations)) throw new Error("operations must be a list");
  const next = structuredClone(simulation ?? {});
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw new Error("every operation is an object with \"op\"");
    const { op } = operation;
    if (op === "company") {
      if (typeof operation.name !== "string" || !operation.name.trim()) throw new Error("company needs a name");
      next.company = operation.name.trim();
      continue;
    }
    if (op === "ground" || op === "unground") {
      if (typeof operation.task !== "string" || !operation.task.trim()) throw new Error(`${op} needs the process test as "task"`);
      const grounding = { ...(next.grounding ?? {}) };
      for (const key of Object.keys(grounding)) if (same(key, operation.task)) delete grounding[key];
      if (op === "ground") {
        if (typeof operation.snapshot !== "string" || !operation.snapshot.trim()) throw new Error("ground needs the recording as \"snapshot\"");
        grounding[operation.task.trim()] = operation.snapshot.trim();
      }
      if (Object.keys(grounding).length) next.grounding = grounding;
      else delete next.grounding;
      continue;
    }
    if (op !== "set" && op !== "remove") throw new Error(`unknown operation "${op}"; use set, remove, ground, unground, or company`);
    const kind = kindOf(operation.kind);
    if (!kind) throw new Error(`"${operation.kind}" is not something to define; use ${DEFINE_KINDS.join(", ")}`);
    if (typeof operation.name !== "string" || !operation.name.trim()) throw new Error(`${op} ${KIND_NAMES[kind]} needs a name`);
    const name = operation.name.trim();
    const list = [...(next[LISTS[kind]] ?? [])];
    const at = list.findIndex((entry) => same(entry[KEYS[kind]], name));
    if (op === "remove") {
      if (at < 0) throw new Error(`there is no ${KIND_NAMES[kind]} "${name}" to remove`);
      list.splice(at, 1);
      // Nothing may point to what is gone.
      const strip = (entries, field) => entries?.forEach((entry) => {
        if (!entry[field]) return;
        entry[field] = entry[field].filter((value) => !same(value, name));
        if (!entry[field].length) delete entry[field];
      });
      if (kind === "role") strip(next.agents, "roles");
      if (kind === "taskGroup") for (const owners of [next.roles, next.agents]) for (const field of ["taskGroups", "mustNot"]) strip(owners, field);
    } else {
      const entry = at >= 0 ? { ...list[at] } : { [KEYS[kind]]: name };
      for (const [field, type] of Object.entries(DEFINE_FIELDS[kind])) {
        if (operation[field] === undefined) continue;
        if (type === "text") {
          if (typeof operation[field] !== "string") throw new Error(`${field} of ${KIND_NAMES[kind]} "${name}" must be text`);
          if (operation[field].trim()) entry[field] = operation[field].trim();
          else delete entry[field];
        } else {
          const values = [operation[field]].flat().flatMap((value) => String(value).split(",")).map((value) => value.trim()).filter(Boolean);
          if (values.length) entry[field] = [...new Set(values)];
          else delete entry[field];
        }
      }
      const unknown = Object.keys(operation).filter((field) => !["op", "kind", "name"].includes(field) && !(field in DEFINE_FIELDS[kind]));
      if (unknown.length) throw new Error(`${KIND_NAMES[kind]} has no "${unknown[0]}"; it has ${Object.keys(DEFINE_FIELDS[kind]).join(", ")}`);
      if (kind === "requirement" && !entry.title) throw new Error(`requirement "${name}" needs a title`);
      if (at >= 0) list[at] = entry;
      else list.push(entry);
    }
    if (list.length) next[LISTS[kind]] = list;
    else delete next[LISTS[kind]];
  }
  return next;
}

/**
 * The company a battle test ran with, as a simulation section: what the
 * process tests say when nothing is defined yet. A definition starts here.
 */
export function definitionOf(report) {
  const pick = (entry, fields) => Object.fromEntries(fields.map((field) => [field, entry[field]]).filter(([, value]) => (Array.isArray(value) ? value.length : value !== undefined && value !== "")));
  return {
    ...(report.company?.name ? { company: report.company.name } : {}),
    taskGroups: (report.taskGroups ?? []).map((group) => pick(group, ["name", "description", "tasks"])),
    // A role does its task groups; tasks of its own are those no group holds.
    roles: (report.roles ?? []).map((role) => {
      const grouped = new Set((role.taskGroups ?? []).flatMap((name) => report.taskGroups?.find((group) => same(group.name, name))?.tasks ?? []));
      return pick({ ...role, tasks: (role.tasks ?? []).filter((task) => !grouped.has(task)) }, ["name", "description", "permissionSets", "taskGroups", "tasks", "mustNot"]);
    }),
    agents: (report.agents ?? []).map((agent) => pick(agent, ["name", "roles"])),
    requirements: (report.fitGap?.requirements ?? []).map((requirement) => pick({ ...requirement, tasks: (requirement.tasks ?? []).map((task) => task.id ?? task) }, ["id", "title", "description", "tasks"]))
  };
}

/**
 * Changes the simulation of a project and runs it.
 * @param input the project
 * @param options { operations, init, dryRun, config, ...analysis options } init writes the company the
 *   process tests describe when none is defined; dryRun runs the changed simulation and writes nothing
 * @returns { file, written, changed, started, derived, definition, report } started: the definition began from
 *   what the tests say; derived: nothing is defined, the definition is what the tests say
 */
export async function defineSimulation(input, { operations = [], init = false, dryRun = false, config: configPath, ...values } = {}, context = {}) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  const file = configPath ? path.resolve(configPath) : path.join(root, ".bca.json");
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`${path.basename(file)} is not valid JSON: ${error.message}`);
  }
  let section = config.simulation ?? {};
  let started = false;
  // Nothing to change: the simulation as it is, defined or as the process tests describe it.
  if (!operations.length && !init) {
    const report = await simulate(root, { ...values, config: configPath }, context);
    const derived = !section.roles?.length;
    return { file, written: false, changed: false, started: false, derived, definition: derived ? { ...definitionOf(report), ...(section.grounding ? { grounding: section.grounding } : {}) } : section, report };
  }
  // Without roles the process tests describe the company. Who defines one starts from that.
  if (!section.roles?.length && (init || operations.some(({ op }) => op === "set" || op === "remove"))) {
    const derived = await simulate(root, { ...values, config: configPath }, context);
    section = { ...section, ...definitionOf(derived), ...(section.company ? { company: section.company } : {}) };
    started = true;
  }
  const next = applyOperations(section, operations);
  // The changed simulation runs before anything is written: what is not valid never reaches the file.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-simulation-"));
  let report;
  try {
    const company = path.join(temporary, "company.json");
    // Lists that were emptied are empty, not what .bca.json still says.
    await fs.writeFile(company, JSON.stringify({ taskGroups: [], roles: [], agents: [], requirements: [], ...next }));
    report = await simulate(root, { ...values, config: configPath, company }, context);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  const changed = JSON.stringify(next) !== JSON.stringify(config.simulation ?? {});
  const written = changed && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ ...config, simulation: next }, null, 2)}\n`);
  }
  return { file, written, changed, started, derived: false, definition: next, report };
}

/** The definition as text: who does what, with what. */
export function definitionText(definition, { derived = false } = {}) {
  const lines = [`${definition.company ?? "The company"}${derived ? " (as the process tests describe it; nothing is defined in .bca.json yet)" : ""}`];
  const part = (title, entries, line) => {
    if (!entries?.length) return;
    lines.push("", title);
    for (const entry of entries) lines.push(`  ${line(entry)}`);
  };
  const list = (label, values) => (values?.length ? `; ${label}: ${values.join(", ")}` : "");
  part("Agents", definition.agents, (agent) => `${agent.name}${list("roles", agent.roles)}${list("permission sets", agent.permissionSets)}${list("task groups", agent.taskGroups)}${list("process tests", agent.tasks)}${list("must not", agent.mustNot)}`);
  part("Roles", definition.roles, (role) => `${role.name}${list("permission sets", role.permissionSets)}${list("task groups", role.taskGroups)}${list("process tests", role.tasks)}${list("features", role.features)}${list("must not", role.mustNot)}`);
  part("Task groups", definition.taskGroups, (group) => `${group.name}${list("process tests", group.tasks)}${list("features", group.features)}`);
  part("Requirements", definition.requirements, (requirement) => `${requirement.id}: ${requirement.title}${list("process tests", requirement.tasks)}${list("features", requirement.features)}${list("objects", requirement.objects)}`);
  part("Grounded on recordings", Object.entries(definition.grounding ?? {}), ([task, snapshot]) => `${task} on ${snapshot}`);
  return `${lines.join("\n")}\n`;
}
