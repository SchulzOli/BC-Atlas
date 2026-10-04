// Runs the configured BC Atlas tasks for a trigger and keeps their output in
// sync with Git. Every trigger (Git hooks, schedules, pipelines, the GitHub
// Action) ends up here, so all of them behave the same way.
import { existsSync } from "node:fs";
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { generateCodeGraph } from "../codegraph.js";
import { loadConfig } from "../config.js";
import { exportDocumentation } from "../docs/export.js";
import { loadCorpus } from "../docs/model.js";
import { healthResultLine } from "../health.js";
import { resolveOutput, writeArchitecture } from "../output.js";
import { runHealthCheck } from "../commands/check.js";
import { generateReport } from "../commands/report.js";
import { automationConfig, DEFAULTS, outputsFor, parseList, SYNC_MODES, TASKS } from "./config.js";
import { changedPaths, findGitRoot, stagePaths } from "./git.js";

const ORDER = ["check", "report", "diagrams", "docs", "codegraph"];

async function runTask(task, root, config, log, appPath) {
  const at = (relative) => path.resolve(root, relative);
  if (task === "check") {
    const { report } = await runHealthCheck(root, {});
    log(`check: ${healthResultLine(report)}`);
    return { ok: report.passed, summary: healthResultLine(report) };
  }
  if (task === "report") {
    const settings = config.report ?? {};
    const result = await generateReport(root, {
      outputDir: at(settings.outputDir ?? DEFAULTS.report.outputDir),
      // Independent of the working directory, so verify gives the same result everywhere.
      regenerate: `bca run ${appPath} --tasks report`
    });
    const rendered = result.diagrams.filter(({ skipped }) => !skipped).length;
    log(`report: ${rendered} diagram(s) in ${settings.outputDir ?? DEFAULTS.report.outputDir}`);
    return { ok: true, summary: `${rendered} diagram(s)` };
  }
  if (task === "docs") {
    const settings = { ...DEFAULTS.docs, ...(config.docs ?? {}) };
    if (!settings.tests) throw new Error("docs task needs \"docs.tests\" (the AL UI-test folder) in .bca.json");
    const corpus = await loadCorpus(at(settings.tests));
    const result = await exportDocumentation(corpus, {
      formats: settings.export,
      mode: settings.as,
      language: settings.language,
      title: settings.title,
      appRoot: at(settings.app ?? "."),
      outputDirectory: at(settings.outputDir)
    });
    for (const warning of result.warnings) log(`docs: warning: ${warning}`);
    log(`docs: ${result.catalog.tasks.length} scenario(s) in ${settings.outputDir}`);
    return { ok: true, summary: `${result.catalog.tasks.length} scenario(s)` };
  }
  if (task === "codegraph") {
    const outputDir = config.codegraph?.outputDir ?? DEFAULTS.codegraph.outputDir;
    const result = await generateCodeGraph(root, { outputDir: at(outputDir) });
    log(`codegraph: ${result.objects} object page(s) in ${outputDir}`);
    return { ok: true, summary: `${result.objects} page(s)` };
  }
  if (task === "diagrams") {
    const diagrams = config.diagrams ?? [];
    if (!diagrams.length) throw new Error("diagrams task needs a \"diagrams\" list in .bca.json");
    const cache = new Map();
    for (const diagram of diagrams) {
      if (!diagram.output) throw new Error("every entry in \"diagrams\" needs an \"output\" path");
      const architecture = await createArchitectureModel(root, { ...diagram, output: at(diagram.output) }, { cache });
      await writeArchitecture(architecture, resolveOutput({ output: at(diagram.output), format: diagram.format }));
    }
    log(`diagrams: ${diagrams.length} diagram(s)`);
    return { ok: true, summary: `${diagrams.length} diagram(s)` };
  }
  throw new Error(`unknown task "${task}"`);
}

/**
 * @param input project root containing .bca.json
 * @param options { tasks, trigger, sync, config, log }
 */
export async function runAutomation(input, options = {}) {
  const root = path.resolve(input ?? ".");
  const log = options.log ?? (() => {});
  const config = (await loadConfig(root, options.config)).values;
  const automation = automationConfig(config);
  const trigger = options.trigger ?? "manual";
  const configured = automation.triggers[trigger];
  if (options.trigger && !configured && !options.tasks?.length) {
    throw new Error(`trigger "${trigger}" is not configured in .bca.json; run "bca setup" or pass tasks explicitly`);
  }
  const requested = parseList(options.tasks, Object.keys(TASKS), "tasks");
  const tasks = ORDER.filter((task) => (requested?.length ? requested : configured?.tasks ?? []).includes(task));
  if (!tasks.length) {
    return { root, trigger, tasks, results: [], sync: "none", outputs: [], changed: [], passed: true };
  }
  const sync = options.sync ?? configured?.sync ?? "none";
  // verify and stage happen here; artifact, pull-request, and commit are
  // pipeline steps that use the outputs reported below.
  if (!SYNC_MODES[sync]) throw new Error(`sync must be one of ${Object.keys(SYNC_MODES).join(", ")}`);

  const gitRoot = await findGitRoot(root);
  const appPath = gitRoot ? path.relative(gitRoot, root).replaceAll("\\", "/") || "." : ".";
  const results = [];
  for (const task of tasks) {
    try {
      results.push({ task, ...(await runTask(task, root, config, log, appPath)) });
    } catch (error) {
      log(`${task}: failed: ${error.message}`);
      results.push({ task, ok: false, summary: error.message });
    }
  }

  if (["verify", "stage"].includes(sync) && !gitRoot) throw new Error(`sync "${sync}" needs a Git repository`);
  const base = gitRoot ? path.relative(gitRoot, root) : "";
  const outputs = outputsFor(tasks, config, base);
  let changed = [];
  if (sync === "verify") {
    changed = changedPaths(gitRoot, outputs);
    if (changed.length) log(`verify: ${changed.length} generated file(s) differ from the commit:\n  ${changed.slice(0, 20).join("\n  ")}`);
    else log("verify: generated files are up to date");
  } else if (sync === "stage") {
    stagePaths(gitRoot, outputs.filter((output) => existsSync(path.join(gitRoot, output))));
    log(`stage: added ${outputs.join(", ")} to the commit`);
  }
  return {
    root,
    trigger,
    tasks,
    sync,
    outputs,
    changed,
    results,
    passed: results.every(({ ok }) => ok) && changed.length === 0
  };
}
