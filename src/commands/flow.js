// `bca flow`: your own workflows. A flow says what to make from the source
// (the artifacts), when (the triggers), and where to save it; `bca run` runs
// it. `bca flow` shows the flows, `bca flow define` changes them.
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../cli/errors.js";
import { defineFlows, describeFlows, exportFlow, flowsConfig, flowsText } from "../flows/index.js";
import { displayPath } from "../output.js";

const several = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
const each = (value) => [value ?? []].flat().map((item) => String(item).trim()).filter(Boolean);

function pair(item, option, example) {
  const at = item.indexOf("=");
  if (at < 1) throw new UsageError(`${option} needs ${example}; got "${item}"`);
  return [item.slice(0, at).trim(), item.slice(at + 1).trim()];
}

/**
 * The operations a set of options asks for (see src/flows/config.js).
 * @param values { flow, title, when, step, to, at, set, id, after, unstep, up, down, remove, deliver, from }
 */
export async function flowOperations(values = {}) {
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
  for (const id of each(values.remove)) operations.push({ op: "remove", flow: id });
  const stepOptions = ["step", "to", "at", "set", "id", "after", "unstep", "up", "down"].filter((name) => values[name] !== undefined);
  if (values.flow) {
    // A flow that is not there yet starts with its first step.
    operations.push({ op: "set", flow: values.flow, ...(values.title !== undefined ? { title: values.title } : {}), ...(values.when !== undefined ? { when: several(values.when) } : {}) });
    if (values.unstep !== undefined) operations.push({ op: "unstep", flow: values.flow, at: values.unstep });
    if (values.up !== undefined) operations.push({ op: "move", flow: values.flow, at: values.up, by: -1 });
    if (values.down !== undefined) operations.push({ op: "move", flow: values.flow, at: values.down, by: 1 });
    if (["step", "to", "set", "at", "id", "after"].some((name) => values[name] !== undefined)) {
      if (values.step === undefined && values.at === undefined) throw new UsageError("--to, --set, --id, and --after belong to a step: add --step <artifact> for a new one, or --at <n> to change one");
      const options = Object.fromEntries(each(values.set).map((item) => pair(item, "--set", "<option>=<value>, such as lens=data")));
      operations.push({
        op: "step", flow: values.flow, ...(values.step !== undefined ? { what: values.step } : {}), ...(values.to !== undefined ? { to: values.to } : {}), ...(values.at !== undefined ? { at: values.at } : {}), ...options,
        ...(values.id !== undefined ? { id: values.id } : {}),
        // gate, or gate:failed; an empty value takes the wires away.
        ...(values.after !== undefined ? { after: several(values.after) } : {})
      });
    }
  } else if (stepOptions.length || values.title !== undefined || values.when !== undefined) {
    throw new UsageError("say which flow with --flow <id>");
  }
  for (const item of each(values.deliver)) {
    const [trigger, sync] = pair(item, "--deliver", "<trigger>=<sync mode>, such as ci=verify");
    operations.push({ op: "deliver", trigger, sync });
  }
  return operations;
}

const usage = (error) => (/^flows:/u.test(error.message) ? new UsageError(error.message.replace(/^flows: /u, "")) : error);

function catalogText(artifacts) {
  const lines = ["What a step of a flow can make (\"what\"), where it saves by default, and its options:", ""];
  for (const artifact of artifacts) {
    const target = artifact.plugin ? "task of a plugin" : artifact.target === "folder" ? `folder, default ${artifact.to}` : `file ${artifact.extensions.map((item) => `.${item}`).join(" ")}${artifact.to ? `, default ${artifact.to}` : ", optional"}`;
    lines.push(`${artifact.id.padEnd(16)} ${artifact.title}${artifact.gate ? " (gate: it can fail the run)" : ""}`);
    lines.push(`${" ".repeat(17)}${artifact.summary}`);
    lines.push(`${" ".repeat(17)}saves: ${target}${artifact.stable === false ? "; differs on every run, so not for the sync mode verify" : ""}`);
    if (artifact.options.length || artifact.open) lines.push(`${" ".repeat(17)}options: ${artifact.options.map(({ name, values }) => (values ? `${name}=${values.join("|")}` : name)).join(", ")}${artifact.open ? ", and every option of bca export" : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** What the triggers of the flows still need, as lines for the terminal. */
function hints(description) {
  const used = [...new Set(description.flows.flatMap(({ when }) => when))].filter((trigger) => trigger !== "manual");
  const missing = used.filter((trigger) => !description.triggers[trigger].configured);
  return missing.length ? [`Nothing calls ${missing.join(", ")} yet: "bca setup" installs the Git hook or the pipeline, and "bca flow define --deliver ${missing[0]}=verify" says how it delivers.`] : [];
}

/** `bca flow`: the flows of the project, or what a step can make. */
export async function flowCommand(input, values) {
  let description;
  try {
    description = await describeFlows(input, values);
  } catch (error) {
    throw usage(error);
  }
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...description, file: displayPath(description.file) }, null, 2)}\n`);
    return;
  }
  if (values.artifacts) {
    process.stdout.write(catalogText(description.artifacts));
    return;
  }
  process.stdout.write(flowsText(flowsConfig({ flows: description.flows }, { pluginTasks: description.artifacts.filter(({ plugin }) => plugin).map(({ id }) => id) }), description));
  const lines = hints(description);
  if (description.flows.length) lines.push("Run one: bca run --flow <id>. Change them: bca flow define, or the Flow menu of the view.");
  if (lines.length) console.error(lines.join("\n"));
}

/** `bca flow define`: changes the flows in .bca.json. */
export async function flowDefineCommand(input, values) {
  const operations = await flowOperations(values);
  if (!operations.length) return flowCommand(input, values);
  let result;
  try {
    result = await defineFlows(input, { operations, dryRun: Boolean(values.dryRun), config: values.config, projectRoot: values.projectRoot });
  } catch (error) {
    throw usage(error);
  }
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...result, file: displayPath(result.file), dryRun: Boolean(values.dryRun) }, null, 2)}\n`);
    return undefined;
  }
  process.stdout.write(flowsText(flowsConfig({ flows: result.flows }, { pluginTasks: result.artifacts.filter(({ plugin }) => plugin).map(({ id }) => id) }), result));
  const freed = result.freed.flatMap(({ steps }) => steps);
  console.error([
    result.written ? `Wrote ${displayPath(result.file)}` : result.changed ? "Dry run: nothing written." : "Nothing changed.",
    ...(freed.length ? [`${freed.length} step(s) ran only through what was taken out and left the flow with it: ${freed.map((step) => step.id ?? step.what).join(", ")}. ${result.written ? "They are on the canvas of the builder, in no flow, to be wired again." : ""}`.trim()] : []),
    ...hints(result)
  ].join("\n"));
  return undefined;
}

/** `bca flow export`: a flow as a workflow for GitHub Actions. */
export async function flowExportCommand(input, values) {
  const stdout = values.output === "-";
  let result;
  try {
    result = await exportFlow(input, { flow: values.flow, to: values.to, output: stdout ? undefined : values.output, force: Boolean(values.force), dryRun: Boolean(values.dryRun) || stdout, config: values.config, projectRoot: values.projectRoot });
  } catch (error) {
    throw usage(error);
  }
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...result, file: displayPath(result.file), dryRun: Boolean(values.dryRun) || stdout }, null, 2)}\n`);
    return;
  }
  if (stdout) {
    process.stdout.write(result.content);
    return;
  }
  const did = result.written ? (result.action === "create" ? "Wrote" : "Updated") : result.action === "unchanged" ? "Up to date:" : "Dry run: would write";
  console.log([
    `${did} ${displayPath(result.file)}`,
    `  runs     bca run --flow ${result.flow}`,
    `  on       ${result.events.join(", ")}`,
    ...Object.entries(result.delivery).map(([trigger, sync]) => `  ${trigger.padEnd(8)} ${{ verify: "fails when what the flow saves differs from the commit", artifact: "uploads what the flow saves as an artifact", "pull-request": "opens a pull request with what the flow saves", commit: "commits what the flow saves" }[sync]}`),
    ...(result.written ? ["Commit the file; GitHub runs it from the next push."] : [])
  ].join("\n"));
}
