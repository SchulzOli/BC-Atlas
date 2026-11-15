// `bca process`: how the company works with the app, as models in lanes (BPMN) that BC Atlas runs
// with the people of the simulation. `bca process` shows the models and how each runs, `--mine` the
// processes as the process tests and recordings have them; `bca process define` changes the models,
// `bca process run` is the test and the demonstration, `bca process export` writes BPMN 2.0.
import fs from "node:fs/promises";
import path from "node:path";
import { CheckFailedError, UsageError } from "../cli/errors.js";
import { renderBpmn } from "../docs/render/bpmn.js";
import { displayPath } from "../output.js";
import { bpmnProcess, defineProcesses, importBpmn, processesConfig, runText, STEP_STATUS } from "../process/index.js";
import { span } from "../process/telemetry.js";
import { describeProcesses } from "../process/project.js";
import { terminalProgress } from "./check.js";

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const each = (value) => [value ?? []].flat().map((item) => String(item).trim()).filter(Boolean);
const usage = (error) => (/^processes:/u.test(error.message) ? new UsageError(error.message.replace(/^processes: /u, "")) : error);
const analysis = (values) => Object.fromEntries(["projectRoot", "config", "compiler", "compilerLog", "tests", "recordings", "telemetry", "language"].filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));

async function described(input, values) {
  try {
    return await describeProcesses(input, analysis(values), { onProgress: terminalProgress() });
  } catch (error) {
    throw usage(error);
  }
}

function modelText(process, { mined = false } = {}) {
  const lines = [`${process.id}  ${process.title}${mined ? `  (${process.sources.join(" and ")}, ${process.handovers} handover(s))` : ""}`];
  for (const step of process.steps) {
    const after = [step.after ?? []].flat().map((wire) => (typeof wire === "string" ? wire : `${wire.step}${wire.when ? ` (${wire.when})` : ""}`)).join(", ");
    lines.push(`  ${(step.lane || "no lane").padEnd(16)} ${step.id.padEnd(14)} ${step.title}${step.test ? `  [${step.test}]` : ""}${after ? `  after ${after}` : ""}`);
    if (mined) lines.push(`  ${" ".repeat(31)} ${step.events.steps} click(s): opens ${step.events.opens}, runs ${step.events.runs}, reads ${step.events.reads}, writes ${step.events.writes}; ${step.events.objects.length} object(s)${step.recorded ? "; recorded in Business Central" : ""}`);
    const timing = process.timing?.steps[step.id];
    if (mined && timing) lines.push(`  ${" ".repeat(31)} telemetry: ${timing.count} time(s) in ${timing.cases} case(s), ${span(timing.duration.avg)} on average${timing.repeated ? `, done again in ${timing.repeated} case(s)` : ""}`);
  }
  if (mined && process.timing) {
    const { timing } = process;
    lines.push("", `  Telemetry: ${timing.cases} case(s), ${timing.events} event(s), ${timing.from.slice(0, 10)} to ${timing.to.slice(0, 10)}. A case takes ${span(timing.throughput.avg)} on average, ${span(timing.throughput.p95)} for the slowest.`);
    lines.push("  The ways really taken:");
    for (const variant of timing.variants) lines.push(`    ${String(variant.cases).padStart(4)} case(s)  ${variant.steps.join(" > ")}`);
    lines.push("  Between the steps:");
    for (const way of timing.ways) lines.push(`    ${way.from} > ${way.into}: ${way.count} time(s), in ${way.share}% of the cases, waiting ${span(way.wait.avg)} on average (${span(way.wait.p95)} for the slowest)`);
  }
  return lines.join("\n");
}

/** `bca process`: the models and how they run, or the processes as they are. */
export async function processCommand(input, values) {
  const result = await described(input, values);
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify(values.mine ? { schema: result.schema, mined: result.mined } : result, null, 2)}\n`);
    return;
  }
  if (values.mine) {
    if (!result.mined.length) console.log("Nothing to mine: the project has no process tests (AL UI tests with [SCENARIO]) and no recordings.");
    else console.log(`${result.mined.map((model) => modelText(model, { mined: true })).join("\n\n")}\n\nTake one as a model: bca process define --adopt ${result.mined[0].id}`);
    return;
  }
  if (!result.processes.length) {
    console.log(`No processes yet.${result.mined.length ? ` The process tests have ${result.mined.length}: see them with bca process --mine, take one with bca process define --adopt ${result.mined[0].id}.` : " Add one: bca process define --process orders --step \"Take the order\" --lane \"Order processor\""}`);
    return;
  }
  for (const run of result.runs) {
    console.log(`${run.id}  ${run.title}: ${run.passed ? "runs" : "STOPS"}, ${run.steps.length} step(s), ${run.lanes.length} lane(s), ${run.handovers} handover(s), ${run.findings.length} to improve`);
    for (const step of [...run.steps].sort((a, b) => a.order - b.order)) console.log(`  ${String(step.order).padStart(2)}. ${(step.lane || "no lane").padEnd(16)} ${step.title}: ${STEP_STATUS[step.status]}`);
  }
  if (!result.simulated) console.error("The project has no process tests and no recordings: nothing can show whether a step works.");
  if (result.telemetry) console.error(`Telemetry: ${result.telemetry.events} event(s) from ${result.telemetry.source}, a case by ${result.telemetry.case}.`);
  console.error("Step by step: bca process run. Change them: bca process define, or the Process mode of the builder in the view.");
}

/**
 * The operations a set of options asks for (see src/process/index.js).
 * @param values { process, title, step, id, lane, test, after, at, unstep, remove, renameLane, adopt, import, from }
 */
export async function processOperations(values = {}, mined = []) {
  const operations = [];
  if (values.from) {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(path.resolve(values.from), "utf8"));
    } catch (error) {
      throw new UsageError(`cannot read the operations of ${values.from}: ${error.message}`);
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.operations;
    if (!Array.isArray(list)) throw new UsageError(`${values.from} must hold a list of operations, or { "operations": [...] }`);
    operations.push(...list);
  }
  if (values.import) {
    let xml;
    try {
      xml = await fs.readFile(path.resolve(values.import), "utf8");
    } catch (error) {
      throw new UsageError(`cannot read ${values.import}: ${error.message}`);
    }
    try {
      operations.push({ op: "adopt", model: importBpmn(xml, { id: values.process, title: values.title }) });
    } catch (error) {
      throw usage(error);
    }
    return operations;
  }
  for (const id of each(values.adopt)) {
    const model = mined.find((item) => item.id === id);
    if (!model) throw new UsageError(`there is no mined process "${id}"; bca process --mine shows ${mined.map((item) => item.id).join(", ") || "none"}`);
    operations.push({ op: "adopt", model });
  }
  for (const id of each(values.remove)) operations.push({ op: "remove", process: id });
  const stepOptions = ["step", "at", "id", "lane", "test", "after", "unstep", "renameLane"].filter((name) => values[name] !== undefined);
  if (!values.process) {
    if (stepOptions.length || values.title !== undefined) throw new UsageError("say which process with --process <id>");
    return operations;
  }
  operations.push({ op: "set", process: values.process, ...(values.title !== undefined && values.step === undefined && values.at === undefined ? { title: values.title } : {}) });
  if (values.unstep !== undefined) operations.push({ op: "unstep", process: values.process, step: values.unstep });
  if (values.renameLane !== undefined) {
    const at = String(values.renameLane).indexOf("=");
    if (at < 1) throw new UsageError(`--rename-lane needs <lane>=<new name>; got "${values.renameLane}"`);
    operations.push({ op: "lane", process: values.process, lane: values.renameLane.slice(0, at).trim(), title: values.renameLane.slice(at + 1).trim() });
  }
  if (values.step !== undefined || values.at !== undefined) {
    // --step is the title of a new step; --at names the step to change, and --step then gives it a new title.
    const fields = { ...(values.id !== undefined ? { id: values.id } : {}), ...(values.lane !== undefined ? { lane: values.lane } : {}), ...(values.test !== undefined ? { test: values.test } : {}) };
    const title = values.step ?? (values.at !== undefined ? values.title : undefined);
    const name = values.at ?? values.id ?? undefined;
    operations.push({ op: "step", process: values.process, ...(values.at !== undefined ? { step: values.at } : {}), ...(title !== undefined ? { title } : {}), ...fields });
    if (values.after !== undefined) {
      // Known only once the step is there: by its id, which --at or --id gives, else by its title.
      const into = name ?? { title };
      operations.push({ after: several(values.after), into });
    }
  } else if (["id", "lane", "test", "after"].some((name) => values[name] !== undefined)) {
    throw new UsageError("--id, --lane, --test, and --after belong to a step: add --step <title> for a new one, or --at <step id> to change one");
  }
  return operations;
}

/** `bca process define`: changes the processes in .bca.json. */
export async function processDefineCommand(input, values) {
  const mined = values.adopt !== undefined ? (await described(input, values)).mined : [];
  const asked = await processOperations(values, mined);
  if (!asked.length) return processCommand(input, values);
  const plain = asked.filter((operation) => !operation.after);
  const wires = asked.filter((operation) => operation.after);
  let result;
  try {
    // The steps first, so that a new one has its id; then its wires. Nothing is written until all of it is valid.
    const staged = await defineProcesses(input, { operations: plain, dryRun: true, config: values.config, projectRoot: values.projectRoot });
    const operations = [...plain];
    for (const { after, into } of wires) {
      const target = plain.findLast((operation) => operation.op === "step");
      const process = staged.processes.find(({ id }) => id === target.process);
      const name = typeof into === "string" ? into : process.steps.findLast(({ title }) => title === into.title)?.id ?? process.steps.at(-1).id;
      const current = [process.steps.find(({ id }) => id === name)?.after ?? []].flat().map((wire) => (typeof wire === "string" ? wire : wire.step));
      for (const before of current) operations.push({ op: "unwire", process: target.process, from: before, into: name });
      for (const item of after) {
        const [from, ...when] = item.split(":");
        operations.push({ op: "wire", process: target.process, from: from.trim(), into: name, ...(when.length ? { when: when.join(":").trim() } : {}) });
      }
    }
    result = await defineProcesses(input, { operations, dryRun: Boolean(values.dryRun), config: values.config, projectRoot: values.projectRoot });
  } catch (error) {
    throw usage(error);
  }
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...result, file: displayPath(result.file), dryRun: Boolean(values.dryRun) }, null, 2)}\n`);
    return undefined;
  }
  console.log(processesConfig({ processes: result.processes }).map((model) => modelText(model)).join("\n\n"));
  console.error(result.written ? `Wrote ${displayPath(result.file)}` : result.changed ? "Dry run: nothing written." : "Nothing changed.");
  return undefined;
}

/** `bca process run`: a process step by step with the people of the simulation, and what to improve. */
export async function processRunCommand(input, values) {
  const result = await described(input, values);
  const wanted = each(values.process);
  const unknown = wanted.filter((id) => !result.runs.some((run) => run.id === id));
  if (unknown.length) throw new UsageError(`there is no process "${unknown[0]}"; there ${result.runs.length === 1 ? "is" : "are"} ${result.runs.map(({ id }) => id).join(", ") || "none: add one with bca process define"}`);
  const runs = wanted.length ? result.runs.filter(({ id }) => wanted.includes(id)) : result.runs;
  if (!runs.length) throw new UsageError("there are no processes yet; add one with bca process define, or take one the process tests have with --adopt (bca process --mine)");
  const format = values.format ?? (values.output && /\.md$/iu.test(values.output) ? "markdown" : values.output && /\.json$/iu.test(values.output) ? "json" : "text");
  const content = format === "json" ? `${JSON.stringify({ schema: result.schema, passed: runs.every(({ passed }) => passed), runs }, null, 2)}\n`
    : runs.map((run) => runText(run, { markdown: format === "markdown" })).join("\n");
  if (values.output) {
    const output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
    console.error(`${runs.map((run) => `${run.title}: ${run.passed ? "runs" : "stops"}`).join("; ")}\nWrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (!result.simulated) console.error("The project has no process tests and no recordings: nothing can show whether a step works.");
  if (!runs.every(({ passed }) => passed)) throw new CheckFailedError("a process stops");
}

/** `bca process export`: a process as BPMN 2.0, for other tools. */
export async function processExportCommand(input, values) {
  const root = path.resolve(values.projectRoot ?? input ?? ".");
  let processes;
  try {
    const { loadConfig } = await import("../config.js");
    processes = processesConfig((await loadConfig(root, values.config)).values);
  } catch (error) {
    throw usage(error);
  }
  const model = processes.find(({ id }) => id === values.process);
  if (!model) throw new UsageError(`there is no process "${values.process ?? ""}"; there ${processes.length === 1 ? "is" : "are"} ${processes.map(({ id }) => id).join(", ") || "none"}`);
  if (!model.steps.length) throw new UsageError(`the process "${model.id}" has no steps yet`);
  const { readFileSync } = await import("node:fs");
  const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  const xml = renderBpmn(bpmnProcess(model), { version, note: `The process "${model.id}" of .bca.json, written by bca process export. Change the process and export it again.` });
  if (values.output === "-") {
    process.stdout.write(xml);
    return;
  }
  const output = path.resolve(values.output ?? `${model.id}.bpmn`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, xml);
  console.log(`Wrote ${displayPath(output)}: ${model.steps.length} step(s) in ${new Set(model.steps.map(({ lane }) => lane)).size} lane(s)`);
}
