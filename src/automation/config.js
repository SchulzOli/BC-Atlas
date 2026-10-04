// The automation model in .bca.json: which features (tasks) run, on which
// trigger, and how their generated output is kept in sync with the repository.
//
//   "automation": {
//     "hooks": "husky" | "git" | "none",
//     "ci": "github" | "azure-devops" | "none",
//     "triggers": {
//       "pre-commit": { "tasks": ["check"], "sync": "none" },
//       "pre-push":   { "tasks": ["report", "docs"], "sync": "verify" },
//       "ci":         { "tasks": ["check", "report", "docs"], "sync": "verify" },
//       "schedule":   { "cron": "0 6 * * 1", "tasks": ["report", "docs"], "sync": "pull-request" }
//     }
//   }
import path from "node:path";

export const TASKS = Object.freeze({
  check: "Architecture health gate (cycles, policies, diagnostics)",
  report: "Architecture report with diagrams (docs/atlas)",
  docs: "User guides or test cases from AL UI tests",
  codegraph: "One Markdown page per AL object",
  diagrams: "Extra diagrams listed under \"diagrams\" in .bca.json"
});

export const TRIGGERS = Object.freeze({
  "pre-commit": "Git hook before each commit",
  "pre-push": "Git hook before each push",
  ci: "Pull requests and pushes to the main branch",
  schedule: "Scheduled pipeline run (cron)",
  manual: "bca run without a trigger"
});

export const SYNC_MODES = Object.freeze({
  none: "Only run the tasks",
  verify: "Fail when generated files differ from the committed ones",
  stage: "Add regenerated files to the current commit (Git hooks)",
  artifact: "Publish generated files as a pipeline artifact",
  "pull-request": "Open a pull request with regenerated files (GitHub)",
  commit: "Commit regenerated files to the branch (pipelines)"
});

export const HOOK_MANAGERS = Object.freeze(["husky", "git", "none"]);
export const CI_PROVIDERS = Object.freeze(["github", "azure-devops", "none"]);

const HOOK_SYNC = ["none", "verify", "stage"];
const PIPELINE_SYNC = ["none", "verify", "artifact", "pull-request", "commit"];

export const DEFAULTS = Object.freeze({
  report: { outputDir: "docs/atlas" },
  docs: { outputDir: "docs/guides", export: ["markdown", "html"], as: "guide" },
  codegraph: { outputDir: "docs/codegraph" }
});

export function syncModesFor(trigger) {
  return ["pre-commit", "pre-push", "manual"].includes(trigger) ? HOOK_SYNC : PIPELINE_SYNC;
}

export function parseList(value, allowed, name) {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : String(value).split(","))
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 1 && items[0] === "none") return [];
  const invalid = allowed ? items.filter((item) => !allowed.includes(item)) : [];
  if (invalid.length) throw new Error(`${name} must be chosen from ${allowed.join(", ")}; unsupported: ${invalid.join(", ")}`);
  return [...new Set(items)];
}

/** Basic five-field cron validation; pipelines reject anything else. */
export function validateCron(value) {
  const fields = String(value).trim().split(/\s+/u);
  if (fields.length !== 5 || !fields.every((field) => /^[\d*/,\-A-Za-z]+$/u.test(field))) {
    throw new Error(`schedule must be a five-field cron expression such as "0 6 * * 1", received "${value}"`);
  }
  return fields.join(" ");
}

/** Normalizes and validates the automation section. */
export function automationConfig(config = {}) {
  const automation = config.automation ?? {};
  const triggers = {};
  for (const [name, trigger] of Object.entries(automation.triggers ?? {})) {
    if (!TRIGGERS[name]) throw new Error(`unknown trigger "${name}"; use ${Object.keys(TRIGGERS).join(", ")}`);
    const sync = trigger.sync ?? "none";
    if (!syncModesFor(name).includes(sync)) {
      throw new Error(`trigger "${name}" supports sync ${syncModesFor(name).join(", ")}, not "${sync}"`);
    }
    triggers[name] = {
      tasks: parseList(trigger.tasks ?? [], Object.keys(TASKS), `${name} tasks`),
      sync,
      ...(name === "schedule" && trigger.cron ? { cron: validateCron(trigger.cron) } : {})
    };
  }
  const hooks = automation.hooks ?? "none";
  const ci = automation.ci ?? "none";
  if (!HOOK_MANAGERS.includes(hooks)) throw new Error(`automation.hooks must be one of ${HOOK_MANAGERS.join(", ")}`);
  if (!CI_PROVIDERS.includes(ci)) throw new Error(`automation.ci must be one of ${CI_PROVIDERS.join(", ")}`);
  return { hooks, ci, triggers };
}

/** Output directories (relative to the project root) that a task writes. */
export function taskOutputs(task, config = {}) {
  if (task === "report") return [config.report?.outputDir ?? DEFAULTS.report.outputDir];
  if (task === "docs") return [config.docs?.outputDir ?? DEFAULTS.docs.outputDir];
  if (task === "codegraph") return [config.codegraph?.outputDir ?? DEFAULTS.codegraph.outputDir];
  if (task === "diagrams") {
    return (config.diagrams ?? []).flatMap(({ output }) => {
      if (!output) return [];
      const d2 = output.replace(/\.[^./\\]+$/u, ".d2");
      return [...new Set([output, d2])];
    });
  }
  return [];
}

export function outputsFor(tasks, config, base = "") {
  return [...new Set(tasks.flatMap((task) => taskOutputs(task, config)))]
    .map((output) => path.posix.join(base.replaceAll("\\", "/") || ".", output.replaceAll("\\", "/")));
}
