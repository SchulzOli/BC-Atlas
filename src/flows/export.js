// `bca flow export`: a flow as a pipeline of its own. For GitHub Actions, one workflow file
// per flow that runs `bca run --flow <id>` on the events of the flow's triggers and delivers
// what the flow saved.
//
//   ci        pull requests and pushes to main
//   schedule  the cron of automation.triggers.schedule (default: Mondays at 06:00 UTC)
//   always    by hand (workflow_dispatch)
//
// Delivery is the sync mode of the trigger: verify fails the run, artifact uploads the files,
// pull-request and commit (schedule) write them back. A trigger without a sync mode uploads
// an artifact, so a run never makes files nobody gets.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { automationConfig } from "../automation/config.js";
import { findGitRoot } from "../automation/git.js";
import { azurePipeline, FLOW_MARKER, githubWorkflow } from "../automation/pipelines.js";
import { loadPlugins } from "../plugins/registry.js";
import { flowsConfig } from "./config.js";
import { stepOutputs } from "./artifacts.js";
import { azureFlowPipeline, flowStarts, githubFlowWorkflow, startEvents } from "./pipeline.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
export const FLOW_EXPORT_TARGETS = Object.freeze(["github", "azure-devops"]);
export const DEFAULT_CRON = "0 6 * * 1";
const posix = (value) => value.replaceAll("\\", "/");

/**
 * Writes the workflow of one flow.
 * @param input the project
 * @param options { flow, to = "github", output, force, dryRun, config, projectRoot, version }
 * @returns { flow, to, file, path, content, action: "create" | "update" | "unchanged", written, events, delivery: { [trigger]: sync } }
 */
export async function exportFlow(input, { flow: id, to = "github", output, force = false, dryRun = false, config: configPath, projectRoot, version = pkg.version } = {}) {
  if (!FLOW_EXPORT_TARGETS.includes(to)) throw new Error(`flows: a flow is exported for ${FLOW_EXPORT_TARGETS.join(", ")}, not "${to}"`);
  const root = path.resolve(projectRoot ?? input ?? ".");
  const file = configPath ? path.resolve(configPath) : path.join(root, ".bca.json");
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`${path.basename(file)} is not valid JSON: ${error.message}`);
  }
  const plugins = await loadPlugins(root, config);
  const pluginTasks = Object.keys(plugins.taskSummaries());
  const flows = flowsConfig(config, { pluginTasks });
  if (!id) throw new Error(`flows: say which flow to export${flows.length ? `: ${flows.map((flow) => flow.id).join(", ")}` : "; there is none yet"}`);
  const flow = flows.find((item) => item.id === id);
  if (!flow) throw new Error(`flows: there is no flow "${id}"; there ${flows.length === 1 ? "is" : "are"} ${flows.map((item) => item.id).join(", ") || "none"}`);
  if (!flow.steps.length) throw new Error(`flows: the flow "${id}" has no steps yet`);
  const gitRoot = await findGitRoot(root);
  if (!gitRoot) throw new Error("flows: a pipeline of a flow needs a Git repository; run git init first");
  const appPath = posix(path.relative(gitRoot, root)) || ".";

  // What the flow saves, from the root of the repository; a task of a plugin says so itself.
  const outputs = [];
  for (const step of flow.steps) outputs.push(...(step.plugin ? await plugins.taskOutputs(step.what, config) : stepOutputs(step)));
  const placed = [...new Set(outputs)].map((item) => path.posix.join(appPath, posix(item)));
  const automation = automationConfig(config, { pluginTasks }).triggers;
  const deliver = (name) => (automation[name]?.sync && automation[name].sync !== "none" ? automation[name].sync : "artifact");
  const triggers = {};
  if (flow.when.includes("ci")) {
    // A push verifies or uploads; it never writes back to the branch it runs on.
    triggers.ci = { sync: ["verify", "artifact"].includes(deliver("ci")) ? deliver("ci") : "artifact", outputs: placed };
  }
  // Azure Pipelines has no step that opens a pull request: what the flow saved is published instead.
  const scheduled = to === "azure-devops" && deliver("schedule") === "pull-request" ? "artifact" : deliver("schedule");
  if (flow.when.includes("schedule")) triggers.schedule = { sync: scheduled, cron: automation.schedule?.cron ?? DEFAULT_CRON, outputs: placed };
  if (!triggers.ci && !triggers.schedule) triggers.manual = { sync: "artifact", outputs: placed };

  // With a package.json that declares bc-atlas, the workflow uses that version.
  const packageJson = await fs.readFile(path.join(gitRoot, "package.json"), "utf8").then(JSON.parse, () => undefined);
  const local = Boolean(packageJson?.devDependencies?.["bc-atlas"] || packageJson?.dependencies?.["bc-atlas"]);
  const alTools = (config.al?.compiler ?? "auto") !== "off";
  // A flow on triggers of your own gets a pipeline that tells them apart (pipeline.js).
  const own = flow.when.some((name) => automation[name]?.custom) ? flowStarts(flow.when, automation, { to, defaultCron: DEFAULT_CRON }) : undefined;
  const content = own
    ? (to === "github" ? githubFlowWorkflow : azureFlowPipeline)({ appPath, version, starts: own.starts, outputs: placed, local, alTools, flow: { id: flow.id, title: flow.title } })
    : (to === "github" ? githubWorkflow : azurePipeline)({ appPath, version, triggers, local, alTools, flow: { id: flow.id, title: flow.title } });

  const target = output ? path.resolve(output) : to === "github" ? path.join(gitRoot, ".github", "workflows", `bc-atlas-${flow.id}.yml`) : path.join(gitRoot, `azure-pipelines.bc-atlas-${flow.id}.yml`);
  const current = await fs.readFile(target, "utf8").catch(() => undefined);
  if (current !== undefined && current !== content && !current.includes(FLOW_MARKER) && !force) {
    throw new Error(`flows: ${posix(path.relative(gitRoot, target))} exists and was not written by bca flow export; use --force to replace it, or --output for another file`);
  }
  const action = current === undefined ? "create" : current === content ? "unchanged" : "update";
  const written = action !== "unchanged" && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return {
    flow: flow.id,
    to,
    file: target,
    path: posix(path.relative(gitRoot, target)),
    content,
    action,
    written,
    // The triggers of the flow that no pipeline starts, and why: [{ name, why }].
    skipped: own?.skipped ?? [],
    events: own ? startEvents(own.starts) : to === "github"
      ? [...(triggers.ci ? ["pull_request", "push"] : []), ...(triggers.schedule ? [`schedule (${triggers.schedule.cron})`] : []), "workflow_dispatch"]
      : [...(triggers.ci ? ["pull requests", "pushes to main"] : []), ...(triggers.schedule ? [`schedule (${triggers.schedule.cron})`] : []), "by hand"],
    delivery: own ? Object.fromEntries(own.starts.filter(({ implied }) => !implied).map(({ name, sync }) => [name, sync])) : Object.fromEntries(Object.entries(triggers).map(([name, { sync }]) => [name, sync]))
  };
}
