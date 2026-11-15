// Processes: how the company works with the app, as a model you draw in lanes (BPMN) and BC Atlas
// tests against what the source and Business Central say.
//
//   "processes": [
//     {
//       "id": "purchase-requests",
//       "title": "Purchase requests",
//       "steps": [
//         { "id": "create", "title": "Create a request", "lane": "Employee", "test": "purchase-request-create" },
//         { "id": "approve", "title": "Approve it", "lane": "Team lead", "test": "purchase-request-approve", "after": ["create"] },
//         { "id": "order", "title": "Order", "lane": "Purchaser", "test": "purchase-request-order", "after": [{ "step": "approve", "when": "approved" }] }
//       ]
//     }
//   ]
//
// A step is something a person does. Its `lane` is who does it: a role of the company
// (simulation.roles). Its `test` is what shows that it works: a process test (an AL UI test, by
// document ID) or a recording of Business Central. `after` says what it comes after; a wire with
// a `when` is one way of several (an exclusive gateway in BPMN).
//
// From this, three things:
//   mine      the processes as they are, from the process tests and the recordings: who really
//             does what in which order, and what each step does in the app (its events)
//   run       the model step by step with the people of the simulation: who performs it, who is
//             stopped and by what, where the work changes hands
//   improve   what the run and the comparison with the mined process say should change
import fs from "node:fs/promises";
import path from "node:path";
import { flowId, stepOrder } from "../flows/config.js";

export const PROCESS_SCHEMA = "bc-atlas.processes/1";
const ID = /^[a-z0-9][a-z0-9._-]*$/u;
const text = (value) => String(value ?? "").trim();
const filled = (entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && !value.length)));

/** The wires into a step as it is written: [{ step, when? }]. */
function wiresOf(step) {
  return [step.after ?? []].flat().flatMap((wire) => (typeof wire === "string" ? wire.split(",").map((part) => part.trim()).filter(Boolean).map((name) => ({ step: name })) : wire?.step ? [{ step: String(wire.step), ...(text(wire.when) ? { when: text(wire.when) } : {}) }] : [wire]));
}

/**
 * Normalizes and validates the processes of a configuration.
 * @returns [{ id, title, steps: [{ id, title, lane, test?, after: [{ step, when? }] }] }]
 */
export function processesConfig(config = {}) {
  const processes = config.processes ?? [];
  if (!Array.isArray(processes)) throw new Error("processes: \"processes\" in .bca.json must be a list of processes");
  const seen = new Set();
  return processes.map((process, index) => {
    if (!process || typeof process !== "object" || Array.isArray(process)) throw new Error(`processes: process ${index + 1} must be an object with "id" and "steps"`);
    const id = text(process.id);
    if (!ID.test(id)) throw new Error(`processes: process ${index + 1} needs an "id" of lowercase letters, digits, ".", "_", or "-"${process.id ? `, not "${process.id}"` : ""}`);
    if (seen.has(id)) throw new Error(`processes: there are two processes "${id}"`);
    seen.add(id);
    if (!Array.isArray(process.steps ?? [])) throw new Error(`processes: "steps" of process "${id}" must be a list`);
    const names = new Set();
    const steps = (process.steps ?? []).map((step, at) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`processes: step ${at + 1} of process "${id}" must be an object such as { "id": "approve", "lane": "Team lead" }`);
      const name = text(step.id);
      if (!ID.test(name)) throw new Error(`processes: step ${at + 1} of process "${id}" needs an "id" of lowercase letters, digits, ".", "_", or "-"${step.id ? `, not "${step.id}"` : ""}`);
      if (names.has(name)) throw new Error(`processes: process "${id}" has two steps "${name}"`);
      names.add(name);
      const after = [];
      for (const wire of wiresOf(step)) {
        if (!wire?.step) throw new Error(`processes: step "${name}" of process "${id}" has an "after" that names no step`);
        if (after.some((other) => other.step === wire.step)) throw new Error(`processes: step "${name}" of process "${id}" comes after "${wire.step}" twice`);
        after.push(wire);
      }
      return { id: name, title: text(step.title) || name, lane: text(step.lane), ...(text(step.test) ? { test: text(step.test) } : {}), after };
    });
    for (const step of steps) {
      for (const wire of step.after) {
        if (!names.has(wire.step)) throw new Error(`processes: step "${step.id}" of process "${id}" comes after "${wire.step}", which is not a step of this process; it has ${[...names].join(", ")}`);
        if (wire.step === step.id) throw new Error(`processes: step "${step.id}" of process "${id}" comes after itself`);
      }
    }
    try {
      stepOrder(steps, id);
    } catch (error) {
      // A process that goes in a circle cannot be walked from a start to an end.
      throw new Error(error.message.replace(/^flows: the steps of flow/u, "processes: the steps of process"));
    }
    return { id, title: text(process.title) || id, steps };
  });
}

/** A normalized step, and a process, as they are written in .bca.json. */
const stepJson = (step) => ({ id: step.id, title: step.title, ...(step.lane ? { lane: step.lane } : {}), ...(step.test ? { test: step.test } : {}), ...(step.after.length ? { after: step.after.map((wire) => (wire.when ? { step: wire.step, when: wire.when } : wire.step)) } : {}) });
export const processJson = (process) => ({ id: process.id, title: process.title, steps: process.steps.map(stepJson) });

/** The lanes of a process, in the order its steps name them. */
export const lanesOf = (process) => [...new Set(process.steps.map(({ lane }) => lane || "Nobody yet"))];

// ------------------------------------------------------------------ define
// A change to the processes is a list of operations, as for the flows and the simulation:
//
//   { op: "set", process, title? }                              add a process, or change its title
//   { op: "remove", process }                                   remove it
//   { op: "step", process, step?, id?, title?, lane?, test? }   add a step; with `step` (its id) change that one. An empty value takes a field away
//   { op: "unstep", process, step }                             remove a step: what came after it comes after what it came after
//   { op: "wire", process, from, into, when? }                  step `into` comes after step `from`; `when` names the way
//   { op: "unwire", process, from, into }                       it no longer does
//   { op: "lane", process, lane, title }                        rename a lane
//   { op: "adopt", model }                                      take a whole model: a mined or an imported process

/** Applies operations to a configuration; returns a copy, and throws when the result is not valid. */
export function applyProcessOperations(config = {}, operations = []) {
  const next = structuredClone(config);
  const processes = Array.isArray(next.processes) ? next.processes : [];
  const need = (operation) => {
    const process = processes.find(({ id }) => id === operation.process);
    if (!process) throw new Error(`processes: there is no process "${operation.process ?? ""}"; there ${processes.length === 1 ? "is" : "are"} ${processes.map(({ id }) => id).join(", ") || "none"}`);
    process.steps ??= [];
    return process;
  };
  const stepOf = (process, name) => {
    const step = process.steps.find(({ id }) => id === name);
    if (!step) throw new Error(`processes: process "${process.id}" has no step "${name ?? ""}"; it has ${process.steps.map(({ id }) => id).join(", ") || "none"}`);
    return step;
  };
  const free = (process, base) => {
    for (let count = 1; ; count += 1) {
      const candidate = count === 1 ? flowId(base) : `${flowId(base)}-${count}`;
      if (!process.steps.some(({ id }) => id === candidate)) return candidate;
    }
  };
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") throw new Error("processes: an operation must be an object such as { \"op\": \"set\", \"process\": \"orders\" }");
    const { op } = operation;
    if (op === "set") {
      if (!operation.process) throw new Error("processes: set needs \"process\": the id of the process");
      let process = processes.find(({ id }) => id === operation.process);
      if (!process) processes.push(process = { id: operation.process, title: operation.title || operation.process, steps: [] });
      else if (operation.title) process.title = operation.title;
    } else if (op === "remove") {
      processes.splice(processes.indexOf(need(operation)), 1);
    } else if (op === "adopt") {
      const model = operation.model;
      if (!model?.id) throw new Error("processes: adopt needs \"model\": a process with an id and steps");
      const at = processes.findIndex(({ id }) => id === model.id);
      const entry = { id: model.id, title: model.title ?? model.id, steps: (model.steps ?? []).map(({ id, title, lane, test, after }) => filled({ id, title, lane, test, after: wiresOf({ after }).map((wire) => (wire.when ? wire : wire.step)) })) };
      if (at >= 0) processes[at] = entry;
      else processes.push(entry);
    } else if (op === "step") {
      const process = need(operation);
      const { op: _op, process: _process, step: name, ...fields } = operation;
      const allowed = Object.fromEntries(Object.entries(fields).filter(([key]) => ["id", "title", "lane", "test"].includes(key)));
      if (name) {
        const step = stepOf(process, name);
        // A step that is renamed is still the one the others come after.
        if (allowed.id && allowed.id !== step.id) {
          for (const other of process.steps) if (other.after) other.after = wiresOf(other).map((wire) => (wire.step === step.id ? { ...wire, step: allowed.id } : wire)).map((wire) => (wire.when ? wire : wire.step));
        }
        const merged = filled({ ...step, ...allowed });
        for (const key of Object.keys(step)) delete step[key];
        Object.assign(step, merged);
      } else {
        process.steps.push(filled({ id: allowed.id || free(process, allowed.title || allowed.test || "step"), title: allowed.title, lane: allowed.lane, test: allowed.test }));
      }
    } else if (op === "unstep") {
      const process = need(operation);
      const gone = stepOf(process, operation.step);
      process.steps.splice(process.steps.indexOf(gone), 1);
      // The way goes on without it: what came after it comes after what it came after.
      for (const other of process.steps) {
        const wires = wiresOf(other);
        const through = wires.find((wire) => wire.step === gone.id);
        if (!through) continue;
        const rest = wires.filter((wire) => wire.step !== gone.id);
        for (const before of wiresOf(gone)) if (!rest.some((wire) => wire.step === before.step)) rest.push({ step: before.step, ...(through.when ?? before.when ? { when: through.when ?? before.when } : {}) });
        if (rest.length) other.after = rest.map((wire) => (wire.when ? wire : wire.step));
        else delete other.after;
      }
    } else if (op === "wire" || op === "unwire") {
      const process = need(operation);
      const from = stepOf(process, operation.from);
      const into = stepOf(process, operation.into);
      if (from === into) throw new Error(`processes: step "${into.id}" of process "${process.id}" cannot come after itself`);
      const rest = wiresOf(into).filter((wire) => wire.step !== from.id);
      if (op === "wire") rest.push({ step: from.id, ...(text(operation.when) ? { when: text(operation.when) } : {}) });
      if (rest.length) into.after = rest.map((wire) => (wire.when ? wire : wire.step));
      else delete into.after;
    } else if (op === "lane") {
      const process = need(operation);
      if (!text(operation.title)) throw new Error("processes: lane needs \"title\": the new name of the lane");
      for (const step of process.steps) if ((step.lane ?? "") === (operation.lane ?? "")) step.lane = text(operation.title);
    } else {
      throw new Error(`processes: unknown operation "${op ?? ""}"; use set, remove, step, unstep, wire, unwire, lane, or adopt`);
    }
  }
  if (processes.length) next.processes = processes;
  else delete next.processes;
  // Fails before anything is written when the result is not valid.
  processesConfig(next);
  return next;
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
 * Changes the processes of a project in .bca.json.
 * @returns { file, written, changed, processes: [json] }
 */
export async function defineProcesses(input, { operations = [], dryRun = false, config: configPath, projectRoot } = {}) {
  const root = path.resolve(projectRoot ?? input ?? ".");
  const file = configPath ? path.resolve(configPath) : path.join(root, ".bca.json");
  const config = await readConfig(file);
  const next = applyProcessOperations(config, operations);
  const changed = JSON.stringify(next) !== JSON.stringify(config);
  const written = changed && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { file, written, changed, processes: processesConfig(next).map(processJson) };
}

// -------------------------------------------------------------------- mine
const RIGHTS = { execute: "runs", read: "reads", insert: "writes", modify: "writes", delete: "writes" };

/** What a process test or a recording does in the app, counted: its events. */
function eventsOf(task) {
  const events = { steps: task?.steps?.length ?? 0, opens: 0, runs: 0, reads: 0, writes: 0 };
  const objects = new Set();
  for (const step of task?.steps ?? []) {
    for (const need of step.needs ?? []) {
      objects.add(need.object);
      if (need.right === "execute" && need.type === "page") events.opens += 1;
      else events[RIGHTS[need.right] ?? "runs"] += 1;
    }
  }
  return { ...events, objects: [...objects] };
}

/** Who a step of a mined process is done by: the role of who gets through it, else of who tries. */
function laneOf(step, task) {
  const performer = step.performers.find(({ outcome }) => outcome === "completed") ?? step.performers[0];
  return performer?.roles?.[0] ?? performer?.agent ?? (task?.permissions?.length ? [...task.permissions].sort().join(", ") : "");
}

/**
 * The processes as they are: discovered from what the simulation read from the process tests and
 * the recordings of Business Central (simulate). One process per use case: its process tests in
 * their order, each in the lane of the role that performs it, with what it does in the app.
 * @param report the report of the simulation
 * @returns [{ id, title, feature, sources: ["process tests" | "recordings"], handovers, steps: [{ id, title, lane, test, after, status, recorded, events }] }]
 */
export function mineProcesses(report) {
  const tasks = new Map((report.tasks ?? []).map((task) => [task.id, task]));
  return (report.processes ?? []).map((found) => {
    const members = new Set(found.steps.map(({ task }) => task));
    const short = (task) => {
      // purchase-request-approve in the process purchase-requests is "approve".
      const words = String(task).split("-");
      const shared = found.steps.every(({ task: other }) => String(other).split("-")[0] === words[0]) && found.steps.length > 1;
      let cut = 0;
      if (shared) while (cut < words.length - 1 && found.steps.every(({ task: other }) => String(other).split("-")[cut] === words[cut])) cut += 1;
      return flowId(words.slice(cut).join("-") || task);
    };
    let main;
    let fork;
    const steps = found.steps.map((step) => {
      const task = tasks.get(step.task);
      // What a process test requires comes before it; else the tests follow each other as they are written.
      const required = (task?.requires ?? []).map(({ id }) => id).filter((id) => members.has(id) && id !== step.task);
      const after = required.length ? required.map((id) => ({ step: short(id) }))
        : step.alternative ? (fork ? [{ step: fork, when: "otherwise" }] : [])
          : main ? [{ step: main }] : [];
      if (!step.alternative) {
        fork = main;
        main = short(step.task);
      }
      return { id: short(step.task), title: step.title, lane: laneOf(step, task), test: step.task, after, status: step.status, recorded: Boolean(task?.recorded || task?.recording), events: eventsOf(task) };
    });
    const lanes = steps.map(({ lane }) => lane);
    return {
      id: flowId(String(found.id).replace(/^use-case-/u, "")),
      title: found.title,
      feature: found.feature,
      sources: [...new Set(steps.map(({ recorded }) => (recorded ? "recordings" : "process tests")))],
      handovers: lanes.filter((lane, index) => index && lane !== lanes[index - 1]).length,
      steps
    };
  }).filter(({ steps }) => steps.length);
}

// --------------------------------------------------------------------- run
const STATUS = {
  runs: "someone in the lane gets through it",
  blocked: "the lane is stopped",
  "other-lane": "another role does it, not the lane",
  unstaffed: "nobody is set to do it",
  unproven: "nothing shows that it works",
  unknown: "its test is not there"
};

/**
 * Runs the processes with the people of the simulation and says what to improve.
 * @param processes normalized processes (processesConfig)
 * @param report the report of the simulation (simulate), or nothing when the project has no process tests
 * @returns [{ id, title, passed, handovers, lanes, steps: [{ ...step, order, status, performers, missing, touches, handover }], findings: [{ severity, rule, message, fix, step? }] }]
 */
export function runProcesses(processes, report) {
  const tasks = new Map((report?.tasks ?? []).map((task) => [task.id, task]));
  const roles = new Set((report?.roles ?? []).map(({ name }) => name));
  const mined = report ? mineProcesses(report) : [];
  return processes.map((process) => {
    const findings = [];
    const finding = (severity, rule, message, fix, step) => findings.push({ severity, rule, message, fix, ...(step ? { step } : {}) });
    const order = stepOrder(process.steps, process.id);
    const position = new Map(order.map((index, at) => [process.steps[index].id, at + 1]));
    const steps = process.steps.map((step) => {
      const task = step.test ? tasks.get(step.test) : undefined;
      const attempts = (report?.agents ?? []).flatMap((agent) => (agent.attempts ?? []).filter(({ task: id, expected }) => id === step.test && expected === "complete")
        .map((attempt) => ({ agent: agent.name, roles: agent.roles ?? [], outcome: attempt.outcome, missing: attempt.missingPermissions ?? [], why: (attempt.missing ?? []).map(({ object, because }) => `${object}${because ? `: ${because}` : ""}`), blockedAt: attempt.blockedAt })));
      const lane = attempts.filter(({ roles: held }) => held.includes(step.lane));
      const others = attempts.filter(({ roles: held, outcome }) => !held.includes(step.lane) && outcome === "completed");
      const status = !step.test ? "unproven" : !task ? "unknown"
        : lane.some(({ outcome }) => outcome === "completed") ? "runs"
          : lane.length ? "blocked" : others.length ? "other-lane" : "unstaffed";
      return {
        ...step,
        order: position.get(step.id),
        status,
        performers: (status === "other-lane" ? others : lane).map(({ agent, roles: held, outcome }) => ({ agent, roles: held, outcome })),
        // What the lane lacks, as lines of a permission set, and why the step needs it.
        missing: [...new Set(lane.flatMap(({ missing }) => missing))],
        why: [...new Set(lane.flatMap(({ why }) => why))],
        blockedAt: lane.find(({ blockedAt }) => blockedAt)?.blockedAt,
        touches: eventsOf(task),
        // The work changes hands where a step comes after one of another lane.
        handover: step.after.some((wire) => (process.steps.find(({ id }) => id === wire.step)?.lane ?? "") !== step.lane)
      };
    });
    const named = (step) => `"${step.title}"`;
    for (const step of steps) {
      if (!step.lane) finding("warning", "process-step-no-lane", `The step ${named(step)} of the process ${process.title} is in no lane: nobody is said to do it.`, "Put it in the lane of the role that does it.", step.id);
      else if (report && !roles.has(step.lane)) finding("warning", "process-lane-unknown", `The lane ${step.lane} of the process ${process.title} is not a role of the company, so nobody can be tried in it.`, `Define the role (bca simulate define --role "${step.lane}"), or name the lane after one: ${[...roles].join(", ") || "there is none yet"}.`, step.id);
      if (step.status === "unproven") finding("warning", "process-step-unproven", `Nothing shows that the step ${named(step)} of the process ${process.title} works in the app: it has no process test and no recording.`, "Write a process test for it (an AL UI test with [SCENARIO]) or record it in Business Central, and set it as the test of the step.", step.id);
      if (step.status === "unknown") finding("error", "process-step-unknown-test", `The step ${named(step)} of the process ${process.title} names the test ${step.test}, which is not among the process tests and recordings.`, `Set one that is there: ${[...tasks.keys()].join(", ") || "the project has none"}.`, step.id);
      if (step.status === "blocked") finding("error", "process-step-blocked", `The process ${process.title} stops at ${named(step)}: ${step.lane} cannot perform it${step.missing.length ? `. Missing: ${step.missing.join(", ")}` : ""}.`, step.missing.length ? `Give ${step.lane} what is missing, with a permission set of the role${step.why.length ? ` (${step.why.join("; ")})` : ""}.` : `See bca simulate for what stops ${step.lane}.`, step.id);
      if (step.status === "other-lane") finding("warning", "process-step-other-lane", `The step ${named(step)} of the process ${process.title} is in the lane ${step.lane}, but it is ${[...new Set(step.performers.flatMap(({ roles: held }) => held))].join(", ")} who performs it.`, `Move the step to the lane of who does it, or give ${step.lane} the task.`, step.id);
      if (step.status === "unstaffed" && step.lane && roles.has(step.lane)) finding("warning", "process-step-unstaffed", `Nobody is set to perform the step ${named(step)} of the process ${process.title}: no role has its test ${step.test} among its tasks.`, `Add ${step.test} to the tasks of ${step.lane} (bca simulate define --role "${step.lane}" --tasks ...).`, step.id);
    }
    // The work goes back and forth: A, then B, then A again.
    const laneOfStep = new Map(steps.map((step) => [step.id, step.lane]));
    for (const step of steps) {
      for (const wire of step.after) {
        const middle = steps.find(({ id }) => id === wire.step);
        if (!middle || middle.lane === step.lane) continue;
        if (middle.after.some((before) => laneOfStep.get(before.step) === step.lane)) {
          finding("info", "process-back-and-forth", `In the process ${process.title} the work goes from ${step.lane} to ${middle.lane} and back for ${named(step)}: two handovers around ${named(middle)}.`, `See whether ${step.lane} can do ${named(step)} before handing over, or ${middle.lane} can do it too.`, step.id);
        }
      }
    }
    // Against the process as it is: what the tests and recordings have and the model has not, and an order that differs.
    const tests = new Set(steps.map(({ test }) => test).filter(Boolean));
    const real = mined.filter((other) => other.steps.some(({ test }) => tests.has(test)));
    for (const other of real) {
      for (const step of other.steps.filter(({ test }) => !tests.has(test))) {
        finding("info", "process-step-not-in-model", `The process tests of ${other.title} have "${step.title}" (${step.test}), which the process ${process.title} does not have.`, "Add it as a step, or decide that it is not part of the process.");
      }
      for (const step of other.steps) {
        for (const wire of step.after) {
          const first = steps.find(({ test }) => test === other.steps.find(({ id }) => id === wire.step)?.test);
          const second = steps.find(({ test }) => test === step.test);
          if (first && second && first.order > second.order) {
            finding("warning", "process-order-differs", `The process ${process.title} has ${named(second)} before ${named(first)}, but the process test of ${named(second)} requires ${named(first)} first.`, "Wire the steps in the order the app needs, or change what the test requires.", second.id);
          }
        }
      }
    }
    return {
      id: process.id,
      title: process.title,
      passed: !findings.some(({ severity }) => severity === "error"),
      lanes: lanesOf(process),
      handovers: steps.filter(({ handover }) => handover).length,
      steps,
      findings
    };
  });
}

export const STEP_STATUS = STATUS;

/** A run as text or Markdown: the process step by step, then what to improve. */
export function runText(run, { markdown = false } = {}) {
  const lines = markdown ? [`# ${run.title}`, ""] : [run.title];
  lines.push(`${run.passed ? "Runs" : "Stops"}: ${run.steps.length} step(s) in ${run.lanes.length} lane(s), ${run.handovers} handover(s).`, "");
  const mark = { runs: "ok", blocked: "STOPPED", "other-lane": "other lane", unstaffed: "nobody", unproven: "unproven", unknown: "no test" };
  for (const step of [...run.steps].sort((a, b) => a.order - b.order)) {
    const who = step.performers.length ? step.performers.map(({ agent }) => agent).join(", ") : "nobody";
    const after = step.after.map((wire) => `${wire.step}${wire.when ? ` (${wire.when})` : ""}`).join(", ");
    const head = `${step.order}. [${mark[step.status]}] ${step.lane || "no lane"}: ${step.title}`;
    lines.push(markdown ? `${step.order}. **${step.title}** — ${step.lane || "no lane"}, ${STATUS[step.status]}` : head);
    const detail = [
      after ? `after ${after}${step.handover ? ": the work changes hands" : ""}` : "starts the process",
      step.test ? `${step.status === "runs" || step.status === "other-lane" ? "performed by" : "tried by"} ${who} (${step.test})` : "",
      step.touches.objects.length ? `${step.touches.steps} click(s): opens ${step.touches.opens}, runs ${step.touches.runs}, reads ${step.touches.reads}, writes ${step.touches.writes}` : "",
      step.missing.length ? `missing: ${step.missing.join(", ")}` : ""
    ].filter(Boolean);
    for (const item of detail) lines.push(`${markdown ? "   - " : "     "}${item}`);
  }
  if (run.findings.length) {
    lines.push("", markdown ? "## What to improve" : "What to improve", "");
    for (const finding of run.findings) lines.push(`${markdown ? "- " : "  "}${finding.severity} ${finding.rule}: ${finding.message}${finding.fix ? ` ${finding.fix}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

// -------------------------------------------------------------------- BPMN
/**
 * A process as the structure the BPMN renderer draws (src/docs/render/bpmn.js): a pool with a
 * lane per role, a user task per step, and an exclusive gateway where the way parts.
 */
export function bpmnProcess(process) {
  const lanes = lanesOf(process).map((name, index) => ({ id: `Lane_${index + 1}`, name }));
  const lane = (step) => lanes.find(({ name }) => name === (step.lane || "Nobody yet")).id;
  const xml = (id) => String(id).replace(/[^A-Za-z0-9_]+/gu, "_");
  const nodes = [{ id: `Start_${xml(process.id)}`, kind: "start", name: "" }];
  const flows = [];
  let count = 0;
  const flow = (from, to, name) => flows.push({ id: `Flow_${xml(process.id)}_${++count}`, from, to, ...(name ? { name } : {}) });
  const taskId = (id) => `Activity_${xml(process.id)}_${xml(id)}`;
  for (const step of process.steps) nodes.push({ id: taskId(step.id), kind: "task", user: true, name: step.title, lane: lane(step), ...(step.test ? { documentation: `Test: ${step.test}` } : {}) });
  const end = { id: `End_${xml(process.id)}`, kind: "end", name: "" };
  nodes.push(end);
  const outgoing = new Map();
  for (const step of process.steps) {
    if (!step.after.length) (outgoing.get("") ?? outgoing.set("", []).get("")).push({ to: taskId(step.id) });
    for (const wire of step.after) (outgoing.get(wire.step) ?? outgoing.set(wire.step, []).get(wire.step)).push({ to: taskId(step.id), name: wire.when });
  }
  for (const step of process.steps) if (!outgoing.has(step.id)) outgoing.set(step.id, [{ to: end.id }]);
  for (const [from, targets] of outgoing) {
    const source = from ? taskId(from) : nodes[0].id;
    // One way of several: an exclusive gateway, its ways named.
    if (targets.length > 1 && targets.some(({ name }) => name)) {
      const gateway = { id: `Gateway_${xml(process.id)}_${xml(from || "start")}`, kind: "gateway", name: "", lane: from ? lane(process.steps.find(({ id }) => id === from)) : undefined };
      nodes.splice(nodes.length - 1, 0, gateway);
      flow(source, gateway.id);
      for (const target of targets) flow(gateway.id, target.to, target.name);
    } else {
      for (const target of targets) flow(source, target.to, target.name);
    }
  }
  return { id: `Process_${xml(process.id)}`, name: process.title, participant: `Participant_${xml(process.id)}`, lanes, nodes, flows };
}

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1];
const unescape = (value) => String(value ?? "").replace(/&#10;|&#xA;/giu, " ").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&apos;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();

/**
 * Reads a process from BPMN 2.0 XML, as other tools write it: its lanes, its tasks, and the ways
 * between them. Events and gateways are not steps: a way through them is one way, and it keeps
 * the name of the sequence flow that leaves a gateway.
 * @returns { id, title, steps } as in .bca.json
 */
export function importBpmn(xml, { id, title } = {}) {
  // Comments are no part of the process. Removing one can leave what reads as another, so until none is left.
  let body = String(xml);
  for (let before; before !== body;) {
    before = body;
    body = body.replace(/<!--[\s\S]*?-->/gu, "");
  }
  // What is left of a comment that never closes is cut off: nothing after it is read as BPMN.
  if (body.includes("<!--")) body = body.slice(0, body.indexOf("<!--"));
  const open = (name) => [...body.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?(${name})\\b([^>]*)>`, "gu"))];
  const processTag = open("process")[0]?.[0];
  if (!processTag) throw new Error("processes: this is not BPMN 2.0: it has no <process>");
  const participant = open("participant")[0]?.[0];
  const name = unescape(title ?? attribute(participant ?? "", "name") ?? attribute(processTag, "name") ?? "") || "Imported process";
  const tasks = new Map();
  for (const [tag, kind] of open("(?:user|service|manual|script|businessRule|send|receive)?[tT]ask|subProcess|callActivity")) {
    if (/^<\//u.test(tag)) continue;
    const key = attribute(tag, "id");
    if (key) tasks.set(key, { key, title: unescape(attribute(tag, "name")) || kind });
  }
  // A process BC Atlas wrote says the test of a step in its documentation.
  for (const [, tag, inner] of body.matchAll(/(<(?:[A-Za-z0-9_]+:)?[A-Za-z]*[tT]ask\b[^>]*[^/]>)\s*<(?:[A-Za-z0-9_]+:)?documentation>\s*Test: ([^<\s]+)\s*</gu)) {
    const task = tasks.get(attribute(tag, "id"));
    if (task) task.test = inner;
  }
  if (!tasks.size) throw new Error("processes: the BPMN file has no tasks to make steps of");
  // Which lane a task is in: the lane that refers to it.
  const laneOfTask = new Map();
  for (const [, , attributes, inner] of body.matchAll(/<(?:[A-Za-z0-9_]+:)?(lane)\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?lane>/gu)) {
    const lane = unescape(attribute(attributes, "name"));
    for (const [, reference] of inner.matchAll(/<(?:[A-Za-z0-9_]+:)?flowNodeRef>\s*([^<\s]+)\s*</gu)) laneOfTask.set(reference, lane);
  }
  const flows = open("sequenceFlow").map(([tag]) => ({ from: attribute(tag, "sourceRef"), to: attribute(tag, "targetRef"), name: unescape(attribute(tag, "name")) })).filter(({ from, to }) => from && to);
  // From a task to the tasks that follow it, through whatever is not a task.
  const next = (from, label, seen = new Set()) => flows.filter((flow) => flow.from === from).flatMap((flow) => {
    const way = flow.name || label;
    if (tasks.has(flow.to)) return [{ to: flow.to, when: way }];
    if (seen.has(flow.to)) return [];
    return next(flow.to, way, new Set([...seen, flow.to]));
  });
  const names = new Map();
  const taken = new Set();
  for (const task of tasks.values()) {
    let own = flowId(task.title);
    for (let count = 2; taken.has(own); count += 1) own = `${flowId(task.title)}-${count}`;
    taken.add(own);
    names.set(task.key, own);
  }
  const after = new Map([...tasks.keys()].map((key) => [key, []]));
  for (const key of tasks.keys()) {
    for (const { to, when } of next(key, "")) {
      if (to !== key && !after.get(to).some((wire) => wire.step === names.get(key))) after.get(to).push({ step: names.get(key), ...(when ? { when } : {}) });
    }
  }
  const model = {
    id: id ?? flowId(name),
    title: name,
    steps: [...tasks.values()].map((task) => filled({ id: names.get(task.key), title: task.title, lane: laneOfTask.get(task.key), test: task.test, after: after.get(task.key).map((wire) => (wire.when ? wire : wire.step)) }))
  };
  // A circle in the drawing (a way back) cannot be walked: the way back is left out.
  for (;;) {
    try {
      processesConfig({ processes: [model] });
      return model;
    } catch (error) {
      const circle = /in a circle: (.+)$/u.exec(error.message)?.[1].split(" > ");
      if (!circle) throw error;
      // "a > c > b > a": a comes after c, c after b, b after a. The way back is the one from a later step to an earlier.
      const order = (name) => model.steps.findIndex(({ id: own }) => own === name);
      const wires = circle.slice(0, -1).map((into, index) => ({ into, from: circle[index + 1] }));
      const back = wires.find(({ from, into }) => order(from) > order(into)) ?? wires.at(-1);
      const step = model.steps.find(({ id: own }) => own === back.into);
      step.after = wiresOf(step).filter((wire) => wire.step !== back.from).map((wire) => (wire.when ? wire : wire.step));
      if (!step.after.length) delete step.after;
    }
  }
}
