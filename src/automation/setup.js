// Guided setup. `plan` inspects the project and returns detected facts, the
// questions to ask, and recommended answers. `apply` turns answers into
// .bca.json, Git hooks, and a CI pipeline. A person answers the questions in
// the terminal wizard, or an AI agent relays them and calls the CLI.
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStarterConfig } from "../commands/init.js";
import { EXPORT_FORMATS } from "../docs/export.js";
import { loadCorpus } from "../docs/model.js";
import { CI_PROVIDERS, DEFAULTS, HOOK_MANAGERS, outputsFor, parseList, TASKS, validateCron } from "./config.js";
import { findGitRoot, git, hostOf, remoteUrl } from "./git.js";
import {
  azurePipeline, GENERATED_MARKER, githubWorkflow, mergeHook, PIPELINE_FILES, validatePipelineSync
} from "./pipelines.js";
import { hasJsonComments, mergeTasks, vscodeTasks } from "./vscode.js";
import { agentFile, AGENTS } from "./agent.js";
import { mergeDependabot } from "./dependabot.js";

const IGNORED = new Set([".git", ".alpackages", ".vscode", "node_modules", ".snapshots", "docs", ".husky", ".github"]);
const FEATURES = ["check", "report", "docs", "codegraph"];

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`cannot read ${file}: ${error.message}`);
  }
}

const exists = (file) => stat(file).then(() => true, () => false);
const portable = (value) => value.replaceAll("\\", "/") || ".";

async function directories(root, depth = 0, relative = "") {
  if (depth > 3) return [];
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || IGNORED.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    found.push(child, ...await directories(root, depth + 1, child));
  }
  return found;
}

async function xliffLanguages(root) {
  const languages = new Set();
  for (const directory of [".", ...await directories(root)]) {
    const entries = await readdir(path.join(root, directory)).catch(() => []);
    for (const name of entries.filter((entry) => entry.toLowerCase().endsWith(".xlf"))) {
      const head = (await readFile(path.join(root, directory, name), "utf8")).slice(0, 2000);
      const language = /target-language="([^"]+)"/u.exec(head)?.[1];
      if (language) languages.add(language);
    }
  }
  return [...languages].sort();
}

/** Finds the folder with the most documented UI-test scenarios. */
async function findUiTests(root, gitRoot) {
  const candidates = new Set(["."]);
  for (const directory of await directories(root)) if (/test/iu.test(path.basename(directory))) candidates.add(directory);
  if (gitRoot && gitRoot !== root) {
    for (const directory of await directories(gitRoot)) {
      if (/test/iu.test(path.basename(directory))) candidates.add(portable(path.relative(root, path.join(gitRoot, directory))));
    }
  }
  let best = { path: undefined, scenarios: 0 };
  for (const candidate of candidates) {
    const corpus = await loadCorpus(path.join(root, candidate)).catch(() => undefined);
    const count = corpus?.scenarios.length ?? 0;
    // Prefer the most specific folder when counts tie.
    if (count > best.scenarios || (count && count === best.scenarios && candidate.length > (best.path ?? "").length)) {
      best = { path: candidate, scenarios: count };
    }
  }
  return best;
}

export async function detectProject(input) {
  const root = path.resolve(input);
  if (!(await stat(root)).isDirectory()) throw new Error(`setup expects a directory: ${root}`);
  const gitRoot = await findGitRoot(root);
  const remote = gitRoot ? await remoteUrl(gitRoot) : undefined;
  const app = await readJson(path.join(root, "app.json"));
  const packageJson = gitRoot ? await readJson(path.join(gitRoot, "package.json")) : undefined;
  const uiTests = await findUiTests(root, gitRoot);
  const workflows = gitRoot ? await readdir(path.join(gitRoot, ".github", "workflows")).catch(() => []) : [];
  const azure = gitRoot ? (await readdir(gitRoot).catch(() => [])).filter((name) => /^azure-pipelines.*\.ya?ml$/iu.test(name)) : [];
  return {
    root,
    gitRoot,
    appPath: gitRoot ? portable(path.relative(gitRoot, root)) : ".",
    app: app ? { name: app.name, publisher: app.publisher, version: app.version } : undefined,
    host: hostOf(remote),
    uiTests,
    languages: await xliffLanguages(root),
    config: await exists(path.join(root, ".bca.json")),
    packageJson: Boolean(packageJson),
    husky: Boolean(packageJson?.devDependencies?.husky || packageJson?.dependencies?.husky) ||
      (gitRoot ? await exists(path.join(gitRoot, ".husky")) : false),
    vscode: await exists(path.join(root, ".vscode")) || (gitRoot ? await exists(path.join(gitRoot, ".vscode")) : false),
    ci: { githubWorkflows: workflows.filter((name) => /\.ya?ml$/u.test(name)), azurePipelines: azure }
  };
}

function recommend(facts) {
  const docs = facts.uiTests.scenarios > 0;
  const features = ["check", "report", ...(docs ? ["docs"] : [])];
  const ci = facts.host === "github" || (!facts.host && facts.ci.githubWorkflows.length) ? "github"
    : facts.host === "azure-devops" || facts.ci.azurePipelines.length ? "azure-devops" : "none";
  return {
    features,
    tests: docs ? facts.uiTests.path : undefined,
    docsExport: ["markdown", "html"],
    docsAs: "guide",
    language: "en-US",
    hooks: facts.gitRoot ? "husky" : "none",
    preCommit: ["check"],
    prePush: features.filter((feature) => feature !== "check"),
    hookSync: "verify",
    editor: facts.vscode ? "vscode" : "none",
    updates: facts.host === "github" ? "dependabot" : "none",
    ci,
    ciSync: "verify",
    schedule: ci === "none" ? "none" : "0 6 * * 1",
    scheduleSync: ci === "github" ? "pull-request" : ci === "azure-devops" ? "commit" : "none"
  };
}

const option = (value, description) => ({ value, description });

function questions(facts, recommended) {
  const list = [
    {
      id: "features", flag: "--features", type: "multi",
      question: "Which BC Atlas features should run automatically?",
      options: [
        option("check", TASKS.check),
        option("report", TASKS.report),
        option("docs", `${TASKS.docs}${facts.uiTests.scenarios ? ` (${facts.uiTests.scenarios} found)` : " (none found)"}`),
        option("codegraph", TASKS.codegraph)
      ]
    },
    {
      id: "tests", flag: "--tests", type: "text", when: "features includes docs",
      question: "Where are the AL UI tests that document user workflows?"
    },
    {
      id: "docsExport", flag: "--docs-export", type: "multi", when: "features includes docs",
      question: "In which formats should the guides be published?",
      options: EXPORT_FORMATS.map((format) => option(format, {
        markdown: "Markdown for the repository or wiki",
        html: "One self-contained HTML page",
        dita: "DITA 1.3 tasks for documentation tools",
        "ado-csv": "Azure DevOps Test Plans import",
        bpmn: "BPMN 2.0 processes for Camunda Modeler, Signavio, or bpmn.io"
      }[format]))
    },
    {
      id: "docsAs", flag: "--docs-as", type: "single", when: "features includes docs",
      question: "Should the documentation read as user guides or as test cases?",
      options: [option("guide", "Step-by-step instructions for users"), option("testcase", "Action/expected-result tables for UAT")]
    },
    {
      id: "language", flag: "--language", type: "text", when: "features includes docs",
      question: `Which language should the documentation use?${facts.languages.length ? ` Translations found: ${facts.languages.join(", ")}.` : ""}`
    },
    {
      id: "hooks", flag: "--hooks", type: "single",
      question: "Should BC Atlas run on Git commits and pushes?",
      options: [
        option("husky", `Husky Git hooks, shared through package.json${facts.packageJson ? "" : " (creates a package.json)"}`),
        option("git", "Plain Git hooks in .githooks (each clone runs git config core.hooksPath .githooks)"),
        option("none", "No Git hooks")
      ]
    },
    {
      id: "preCommit", flag: "--pre-commit", type: "multi", when: "hooks is not none",
      question: "What should run before each commit? Keep it fast.",
      options: [...FEATURES.map((feature) => option(feature, TASKS[feature])), option("none", "Nothing")]
    },
    {
      id: "prePush", flag: "--pre-push", type: "multi", when: "hooks is not none",
      question: "What should run before each push?",
      options: [...FEATURES.map((feature) => option(feature, TASKS[feature])), option("none", "Nothing")]
    },
    {
      id: "hookSync", flag: "--hook-sync", type: "single", when: "hooks is not none",
      question: "How should hooks keep generated files in sync?",
      options: [
        option("verify", "Stop the push when generated files are outdated"),
        option("stage", "Add regenerated files to the commit automatically"),
        option("none", "Only run the tasks")
      ]
    },
    {
      id: "editor", flag: "--editor", type: "single",
      question: "Should BC Atlas add tasks to your editor for the local development loop?",
      options: [
        option("vscode", "VS Code tasks: health check (findings in the Problems panel), report, docs, hook dry runs, live diagram"),
        option("none", "No editor tasks")
      ]
    },
    {
      id: "updates", flag: "--updates", type: "single", when: "hooks is husky",
      question: "Should new BC Atlas versions be proposed automatically as pull requests?",
      options: [
        option("dependabot", "Dependabot opens a pull request when a new bc-atlas version is released (GitHub)"),
        option("none", "Update with \"bca update\"; the CLI shows a notice when a new version exists")
      ]
    },
    {
      id: "ci", flag: "--ci", type: "single",
      question: "Which pipeline should run BC Atlas?",
      options: CI_PROVIDERS.map((provider) => option(provider, {
        github: "GitHub Actions workflow",
        "azure-devops": "Azure Pipelines YAML",
        none: "No pipeline"
      }[provider]))
    },
    {
      id: "ciSync", flag: "--ci-sync", type: "single", when: "ci is not none",
      question: "What should pull requests and pushes to main do with generated files?",
      options: [
        option("verify", "Fail when generated files are outdated"),
        option("artifact", "Publish them as a pipeline artifact"),
        option("none", "Only run the tasks")
      ]
    },
    {
      id: "schedule", flag: "--schedule", type: "text",
      question: "Should BC Atlas also run on a schedule? Enter a cron expression (UTC) or none.",
      examples: ["0 6 * * 1 (Mondays 06:00)", "0 5 * * * (daily 05:00)", "none"]
    },
    {
      id: "scheduleSync", flag: "--schedule-sync", type: "single", when: "schedule is not none",
      question: "What should a scheduled run do with regenerated files?",
      options: [
        option("pull-request", "Open a pull request (GitHub)"),
        option("commit", "Commit to the branch"),
        option("artifact", "Publish as a pipeline artifact"),
        option("none", "Only run the tasks")
      ]
    }
  ];
  return list.map((item) => ({ ...item, recommended: recommended[item.id] }));
}

function applyArgs(appPath, answers) {
  const args = ["bca", "setup", "apply", appPath];
  for (const [id, flag] of Object.entries(ANSWER_FLAGS)) {
    const value = answers[id];
    if (value === undefined) continue;
    args.push(flag, Array.isArray(value) ? (value.length ? value.join(",") : "none") : String(value));
  }
  return args;
}

export const ANSWER_FLAGS = Object.freeze({
  features: "--features",
  tests: "--tests",
  docsExport: "--docs-export",
  docsAs: "--docs-as",
  language: "--language",
  hooks: "--hooks",
  preCommit: "--pre-commit",
  prePush: "--pre-push",
  hookSync: "--hook-sync",
  editor: "--editor",
  updates: "--updates",
  ci: "--ci",
  ciSync: "--ci-sync",
  schedule: "--schedule",
  scheduleSync: "--schedule-sync"
});

export async function createPlan(input) {
  const facts = await detectProject(input);
  const recommended = recommend(facts);
  return {
    schemaVersion: 1,
    facts: { ...facts, root: undefined, gitRoot: facts.gitRoot ? "." : undefined },
    questions: questions(facts, recommended),
    recommended,
    apply: applyArgs(".", recommended)
  };
}

/** Validates answers and fills gaps with recommendations. */
export function resolveAnswers(raw, recommended) {
  const pick = (id) => (raw[id] === undefined ? recommended[id] : raw[id]);
  const features = parseList(pick("features"), FEATURES, "--features");
  const hooks = pick("hooks");
  const ci = pick("ci");
  if (!HOOK_MANAGERS.includes(hooks)) throw new Error(`--hooks must be one of ${HOOK_MANAGERS.join(", ")}`);
  if (!CI_PROVIDERS.includes(ci)) throw new Error(`--ci must be one of ${CI_PROVIDERS.join(", ")}`);
  const schedule = String(pick("schedule") ?? "none").trim();
  const answers = {
    features,
    tests: pick("tests"),
    docsExport: parseList(pick("docsExport"), EXPORT_FORMATS, "--docs-export"),
    docsAs: pick("docsAs"),
    language: pick("language"),
    hooks,
    preCommit: hooks === "none" ? [] : parseList(pick("preCommit"), FEATURES, "--pre-commit"),
    prePush: hooks === "none" ? [] : parseList(pick("prePush"), FEATURES, "--pre-push"),
    hookSync: pick("hookSync"),
    editor: pick("editor") ?? "none",
    updates: pick("updates") ?? "none",
    ci,
    ciSync: pick("ciSync"),
    schedule: schedule === "none" || schedule === "" ? "none" : validateCron(schedule),
    scheduleSync: pick("scheduleSync")
  };
  if (!["guide", "testcase"].includes(answers.docsAs)) throw new Error("--docs-as must be guide or testcase");
  if (!["none", "verify", "stage"].includes(answers.hookSync)) throw new Error("--hook-sync must be verify, stage, or none");
  if (!["vscode", "none"].includes(answers.editor)) throw new Error("--editor must be vscode or none");
  if (!["dependabot", "none"].includes(answers.updates)) throw new Error("--updates must be dependabot or none");
  // Dependabot can only bump a version that lives in package.json.
  if (answers.updates === "dependabot" && answers.hooks !== "husky") answers.updates = "none";
  if (features.includes("docs") && !answers.tests) throw new Error("the docs feature needs --tests <folder with AL UI tests>");
  for (const list of [answers.preCommit, answers.prePush]) {
    const missing = list.filter((task) => !features.includes(task));
    if (missing.length) throw new Error(`hook tasks must also be enabled with --features: ${missing.join(", ")}`);
  }
  validatePipelineSync(ci, answers.ciSync, answers.schedule === "none" ? undefined : answers.scheduleSync);
  return answers;
}

/** Answers that reproduce an existing setup, e.g. after an update. */
export function answersFromConfig(config, fallback) {
  const automation = config.automation ?? {};
  const triggers = automation.triggers ?? {};
  const taskList = (name) => triggers[name]?.tasks ?? [];
  const features = [...new Set([
    ...taskList("ci"), ...taskList("schedule"), ...taskList("pre-commit"), ...taskList("pre-push"),
    ...(config.docs?.tests ? ["docs"] : [])
  ])].filter((task) => ["check", "report", "docs", "codegraph"].includes(task));
  return {
    ...fallback,
    features: features.length ? features : fallback.features,
    tests: config.docs?.tests ?? fallback.tests,
    docsExport: config.docs?.export ?? fallback.docsExport,
    docsAs: config.docs?.as ?? fallback.docsAs,
    language: config.docs?.language ?? fallback.language,
    hooks: automation.hooks ?? "none",
    preCommit: taskList("pre-commit"),
    prePush: taskList("pre-push"),
    hookSync: triggers["pre-push"]?.sync ?? triggers["pre-commit"]?.sync ?? fallback.hookSync,
    editor: automation.editor ?? fallback.editor,
    updates: automation.updates ?? "none",
    ci: automation.ci ?? "none",
    ciSync: triggers.ci?.sync ?? fallback.ciSync,
    schedule: triggers.schedule?.cron ?? "none",
    scheduleSync: triggers.schedule?.sync ?? fallback.scheduleSync
  };
}

function buildConfig(existing, answers) {
  const config = { ...existing };
  const triggers = {};
  // A sync mode only matters for tasks that write files (check writes none).
  const hookSync = (tasks) => (outputsFor(tasks, existing).length ? answers.hookSync : "none");
  if (answers.preCommit.length) triggers["pre-commit"] = { tasks: answers.preCommit, sync: hookSync(answers.preCommit) };
  if (answers.prePush.length) triggers["pre-push"] = { tasks: answers.prePush, sync: hookSync(answers.prePush) };
  if (answers.ci !== "none") triggers.ci = { tasks: answers.features, sync: answers.ciSync };
  if (answers.schedule !== "none") {
    triggers.schedule = {
      cron: answers.schedule,
      tasks: answers.features.filter((task) => task !== "check"),
      sync: answers.scheduleSync
    };
  }
  config.automation = { hooks: answers.hooks, editor: answers.editor, updates: answers.updates, ci: answers.ci, triggers };
  if (answers.features.includes("report")) config.report = { ...DEFAULTS.report, ...(config.report ?? {}) };
  if (answers.features.includes("codegraph")) config.codegraph = { ...DEFAULTS.codegraph, ...(config.codegraph ?? {}) };
  if (answers.features.includes("docs")) {
    config.docs = {
      ...(config.docs ?? {}),
      tests: portable(answers.tests),
      app: config.docs?.app ?? ".",
      export: answers.docsExport,
      as: answers.docsAs,
      language: answers.language,
      outputDir: config.docs?.outputDir ?? DEFAULTS.docs.outputDir
    };
  }
  return config;
}

async function plannedWrite(file, content, { gitRoot, force, generatedOnly }) {
  const current = await readFile(file, "utf8").catch(() => undefined);
  const relative = portable(path.relative(gitRoot ?? path.dirname(file), file));
  if (current === content) return { path: relative, action: "unchanged" };
  if (current !== undefined && generatedOnly && !current.includes(GENERATED_MARKER) && !force) {
    return { path: relative, action: "skip", reason: "exists and was not generated by bca setup; use --force to replace it" };
  }
  return { path: relative, action: current === undefined ? "create" : "update", file, content };
}

/**
 * @param answers raw answers (CLI flags); missing answers use the recommendation
 * @returns { files, commands, nextSteps, config, answers }
 */
export async function applySetup(input, rawAnswers = {}, { dryRun = false, force = false, version, fromConfig = false } = {}) {
  const facts = await detectProject(input);
  const { root, gitRoot, appPath } = facts;
  let base = recommend(facts);
  if (fromConfig) {
    const current = await readJson(path.join(root, ".bca.json"));
    if (!current?.automation) throw new Error("--from-config needs a .bca.json with an automation section; run bca setup first");
    base = answersFromConfig(current, base);
  }
  const answers = resolveAnswers(rawAnswers, base);
  if ((answers.hooks !== "none" || answers.ci !== "none") && !gitRoot) {
    throw new Error("Git hooks and pipelines need a Git repository; run git init first or use --hooks none --ci none");
  }
  const configFile = path.join(root, ".bca.json");
  const existing = await readJson(configFile) ?? (await createStarterConfig(root)).config;
  const config = buildConfig(existing, answers);
  const options = { gitRoot: gitRoot ?? root, force };
  const files = [await plannedWrite(configFile, `${JSON.stringify(config, null, 2)}\n`, options)];
  const commands = [];
  const nextSteps = [];

  for (const [hook, trigger] of [["pre-commit", "pre-commit"], ["pre-push", "pre-push"]]) {
    if (!config.automation.triggers[trigger] || answers.hooks === "none") continue;
    const directory = answers.hooks === "husky" ? ".husky" : ".githooks";
    const file = path.join(gitRoot, directory, hook);
    const current = await readFile(file, "utf8").catch(() => undefined);
    files.push(await plannedWrite(file, mergeHook(current, answers.hooks, hook, { appPath, version }), options));
  }
  if (answers.hooks === "husky") {
    const file = path.join(gitRoot, "package.json");
    const pkg = await readJson(file) ?? { name: `${path.basename(gitRoot).toLowerCase().replace(/[^a-z0-9-]+/gu, "-")}-tooling`, private: true };
    pkg.devDependencies = { ...(pkg.devDependencies ?? {}), "bc-atlas": `^${version}`, husky: pkg.devDependencies?.husky ?? "^9.1.7" };
    pkg.scripts = { ...(pkg.scripts ?? {}) };
    if (!pkg.scripts.prepare) pkg.scripts.prepare = "husky";
    else if (!/\bhusky\b/u.test(pkg.scripts.prepare)) pkg.scripts.prepare = `${pkg.scripts.prepare} && husky`;
    files.push(await plannedWrite(file, `${JSON.stringify(pkg, null, 2)}\n`, options));
    nextSteps.push("npm install            # installs Husky and BC Atlas, activates the hooks, writes package-lock.json");
  }
  // With a package.json that declares bc-atlas, every runner uses that one version.
  const packageJson = gitRoot ? await readJson(path.join(gitRoot, "package.json")) : undefined;
  const local = answers.hooks === "husky" || Boolean(packageJson?.devDependencies?.["bc-atlas"] || packageJson?.dependencies?.["bc-atlas"]);
  if (answers.updates === "dependabot") {
    const file = path.join(gitRoot, ".github", "dependabot.yml");
    const merged = mergeDependabot(await readFile(file, "utf8").catch(() => undefined));
    if (merged.skip) {
      files.push({ path: ".github/dependabot.yml", action: merged.unchanged ? "unchanged" : "skip", reason: merged.reason });
    } else {
      files.push(await plannedWrite(file, merged.content, options));
    }
  }
  if (answers.hooks === "git") {
    commands.push(["git", "config", "core.hooksPath", ".githooks"]);
    nextSteps.push("Every clone: git config core.hooksPath .githooks");
  }

  if (answers.editor === "vscode") {
    // Use the folder VS Code opens: the app folder when it has .vscode, else the repository.
    const workspace = await exists(path.join(root, ".vscode")) || !gitRoot ? root : gitRoot;
    const tasksFile = path.join(workspace, ".vscode", "tasks.json");
    const current = await readFile(tasksFile, "utf8").catch(() => undefined);
    const command = local ? ["npx", "--no-install", "bca"] : ["npx", "--yes", `bc-atlas@${version}`];
    const tasks = vscodeTasks({
      appPath: portable(path.relative(workspace, root)),
      command,
      features: answers.features,
      triggers: config.automation.triggers
    });
    if (current !== undefined && hasJsonComments(current) && !force) {
      files.push({
        path: portable(path.relative(gitRoot ?? root, tasksFile)),
        action: "skip",
        reason: "contains comments; use --force to rewrite it (comments are removed)"
      });
    } else {
      let content;
      try {
        content = mergeTasks(current, tasks);
      } catch (error) {
        throw new Error(`cannot read ${tasksFile}: ${error.message}`);
      }
      files.push(await plannedWrite(tasksFile, content, options));
    }
    files.push(await plannedWrite(path.join(root, ".bca", ".gitignore"), "# Local BC Atlas output, e.g. the live diagram.\n*\n", options));
    nextSteps.push("VS Code: Terminal > Run Task > BC Atlas: ...");
  }

  if (answers.ci !== "none") {
    const triggers = {};
    for (const name of ["ci", "schedule"]) {
      const trigger = config.automation.triggers[name];
      if (trigger) triggers[name] = { ...trigger, outputs: outputsFor(trigger.tasks, config, appPath) };
    }
    const content = (answers.ci === "github" ? githubWorkflow : azurePipeline)({ appPath, version, triggers, local });
    files.push(await plannedWrite(path.join(gitRoot, PIPELINE_FILES[answers.ci]), content, { ...options, generatedOnly: true }));
    if (answers.ci === "azure-devops") nextSteps.push(`Azure DevOps: create a pipeline from ${PIPELINE_FILES["azure-devops"]}`);
    if (answers.scheduleSync === "commit" && answers.schedule !== "none") {
      nextSteps.push("Allow the pipeline identity to push to the repository (contents: write / Contribute)");
    }
  } else if (answers.schedule !== "none") {
    nextSteps.push(`Local schedule (crontab -e): ${answers.schedule} cd ${gitRoot ?? root} && bca run ${appPath} --trigger schedule`);
  }
  // Agent command files pin the version too; keep existing ones current.
  if (gitRoot) {
    for (const [agent, { file }] of Object.entries(AGENTS)) {
      if (!file) continue;
      const target = path.join(gitRoot, file);
      const current = await readFile(target, "utf8").catch(() => undefined);
      if (current?.includes("# Set up BC Atlas")) {
        files.push(await plannedWrite(target, agentFile(agent, { version, appPath }), options));
      }
    }
  }
  nextSteps.push(config.automation.triggers.ci
    ? `bca run ${appPath} --trigger ci   # first run`
    : `bca run ${appPath} --tasks ${answers.features.join(",")}   # first run`);
  nextSteps.push("Commit the new files.");

  if (!dryRun) {
    for (const item of files.filter(({ content }) => content !== undefined)) {
      await mkdir(path.dirname(item.file), { recursive: true });
      await writeFile(item.file, item.content);
      if (/[/\\](\.husky|\.githooks)[/\\]/u.test(item.file)) await chmod(item.file, 0o755);
    }
    for (const command of commands) {
      const result = git(gitRoot, command.slice(1));
      if (result.status !== 0) throw new Error(`${command.join(" ")} failed: ${result.stderr.trim()}`);
    }
  }
  return {
    dryRun,
    answers,
    config,
    files: files.map(({ file: _file, content, ...item }) => (dryRun && content !== undefined ? { ...item, content } : item)),
    commands: commands.map((command) => command.join(" ")),
    nextSteps
  };
}
