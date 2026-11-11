import fs from "node:fs/promises";
import path from "node:path";
import { CheckFailedError, UsageError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { DEFINE_FIELDS, defineSimulation, definitionText } from "../simulation/define.js";
import { simulate } from "../simulation/index.js";
import { renderSimulation, simulationResultLine } from "../simulation/report.js";
import { terminalProgress } from "./check.js";

/** Runs the battle test and writes its report (the default of `bca run`: Markdown in docs/simulation). */
export async function writeSimulation(input, values = {}, context = {}) {
  const report = await simulate(input, values, context);
  const format = values.format ?? (values.output && /\.md$/iu.test(values.output) ? "markdown" : values.output && /\.json$/iu.test(values.output) ? "json" : "text");
  const content = renderSimulation(report, format, { marker: Boolean(values.output) });
  let output;
  if (values.output) {
    output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
  }
  // The simulation of each process test as a fact snapshot: --snapshots, or simulation.snapshotDir.
  let snapshots;
  const snapshotDir = values.snapshots ? path.resolve(values.snapshots) : context.snapshotDir;
  if (snapshotDir) {
    const { writeSnapshots } = await import("../simulation/snapshots.js");
    snapshots = { directory: snapshotDir, files: await writeSnapshots(report, snapshotDir) };
  }
  return { report, content, output, format, snapshots };
}

export async function simulateCommand(input, values) {
  const { report, content, output, snapshots } = await writeSimulation(input, values, { onProgress: terminalProgress() });
  if (output) {
    console.error(simulationResultLine(report));
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (snapshots) console.error(`Wrote ${snapshots.files.length} snapshot(s) to ${displayPath(snapshots.directory)}`);
  if (!report.passed) throw new CheckFailedError("battle test failed");
}

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const ENTITIES = { agent: "agent", role: "role", taskGroup: "taskGroup", requirement: "requirement" };

/**
 * The operations a set of options asks for (see src/simulation/define.js).
 * @param values { agent | role | taskGroup | requirement, roles, permissionSets, taskGroups, tasks, features, mustNot,
 *   objects, title, description, remove, ground, unground, companyName, from }
 */
export async function defineOperations(values = {}) {
  const operations = [];
  if (values.from) {
    let read;
    try {
      read = JSON.parse(await fs.readFile(path.resolve(values.from), "utf8"));
    } catch (error) {
      throw new UsageError(`--from ${values.from}: ${error.code === "ENOENT" ? "no such file" : `not valid JSON (${error.message})`}`);
    }
    const list = Array.isArray(read) ? read : read?.operations;
    if (!Array.isArray(list)) throw new UsageError("--from needs a JSON list of operations, or { \"operations\": [...] }");
    operations.push(...list);
  }
  if (values.companyName) operations.push({ op: "company", name: values.companyName });
  const named = Object.keys(ENTITIES).filter((kind) => values[kind] !== undefined);
  if (named.length > 1) throw new UsageError(`define one thing at a time: --${named.join(" or --").replace("taskGroup", "task-group")}; use --from for several`);
  if (named.length) {
    const [kind] = named;
    const operation = { op: "set", kind, name: String(values[kind]) };
    for (const [field, type] of Object.entries(DEFINE_FIELDS[kind])) {
      if (values[field] === undefined) continue;
      operation[field] = type === "text" ? String(values[field]) : several(values[field]);
    }
    const stray = ["roles", "permissionSets", "taskGroups", "tasks", "features", "mustNot", "objects", "title", "description"].filter((field) => values[field] !== undefined && !(field in DEFINE_FIELDS[kind]));
    if (stray.length) throw new UsageError(`${kind === "taskGroup" ? "a task group" : `a${kind === "agent" ? "n" : ""} ${kind}`} has no --${stray[0].replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
    operations.push(operation);
  }
  for (const item of several(values.remove)) {
    const [kind, name] = item.split(/:(.*)/su, 2);
    if (!name) throw new UsageError(`--remove needs kind:name, as in agent:Anna or role:"Team lead"; got "${item}"`);
    operations.push({ op: "remove", kind, name });
  }
  for (const item of [values.ground ?? []].flat()) {
    const [task, snapshot] = String(item).split(/=(.*)/su, 2);
    if (!snapshot) throw new UsageError(`--ground needs <process test>=<recording>; got "${item}"`);
    operations.push({ op: "ground", task: task.trim(), snapshot: snapshot.trim() });
  }
  for (const task of several(values.unground)) operations.push({ op: "unground", task });
  return operations;
}

/** `bca simulate define`: shows the simulation, or changes it and runs it. */
export async function simulateDefineCommand(input, values) {
  const { from: _from, format, init, dryRun, ...rest } = values;
  const operations = await defineOperations(values);
  const analysis = Object.fromEntries(Object.entries(rest).filter(([key]) => ["projectRoot", "config", "compiler", "compilerLog", "tests", "language"].includes(key)));
  let result;
  try {
    result = await defineSimulation(input, { ...analysis, operations, init: Boolean(init), dryRun: Boolean(dryRun) }, { onProgress: terminalProgress() });
  } catch (error) {
    if (/^(?:simulation:|there is no|.* needs |unknown operation|".*" is not something|.* has no ")/u.test(error.message)) throw new UsageError(error.message);
    throw error;
  }
  const { report, definition, derived } = result;
  const asked = operations.length > 0 || Boolean(init);
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      schema: "bc-atlas.simulation-definition/1",
      file: displayPath(result.file),
      written: result.written,
      dryRun: Boolean(dryRun),
      derived,
      definition,
      result: { passed: report.passed, summary: report.summary, counts: report.counts, findings: report.findings }
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(definitionText(definition, { derived }));
  const lines = ["", simulationResultLine(report)];
  if (asked) lines.push(result.written ? `Wrote ${displayPath(result.file)}${result.started ? " (the definition starts from what the process tests say)" : ""}` : result.changed ? "Dry run: nothing written." : "Nothing changed.");
  for (const finding of report.findings.filter(({ severity }) => severity !== "info").slice(0, 12)) lines.push(`  ${finding.severity} ${finding.code}: ${finding.message}`);
  console.error(lines.join("\n"));
}
