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
//       "schedule":   { "cron": "0 6 * * 1", "tasks": ["report", "docs"], "sync": "pull-request" },
//       "release":    { "title": "A release tag", "on": ["tag"], "tags": ["v*"], "sync": "artifact" },
//       "al-changed": { "on": ["push"], "branches": ["main"], "paths": ["src/**/*.al"] },
//       "merged":     { "hook": "post-merge" },
//       "nightly":    { "cron": "0 2 * * *", "sync": "commit" }
//     }
//   }
//
// The first five are built in. Any other name is a trigger of your own: what starts it is its
// events ("on"), its cron, or its Git hook; with none of them it is started by its name only
// (bca run --trigger <name>), from a script of yours.
import path from "node:path";

export const TASKS = Object.freeze({
  check: "Architecture health gate (cycles, policies, diagnostics)",
  simulate: "Battle test: agents with the company's roles perform the process tests; report with fit-gap analysis (docs/simulation)",
  report: "Architecture report with diagrams (docs/atlas)",
  docs: "User guides or test cases from AL UI tests",
  codegraph: "One Markdown page per AL object",
  handbook: "System handbook: events, data, permissions, interfaces, UI, code health (docs/handbook)",
  layers: "Layered documentation, in sync with the source: system, apps, components, namespaces, objects, procedures (docs/layers)",
  diagrams: "Extra diagrams listed under \"diagrams\" in .bca.json"
});
// Plugins add tasks of their own (plugin.json contributes.tasks); see src/plugins.

export const TRIGGERS = Object.freeze({
  "pre-commit": "Git hook before each commit",
  "pre-push": "Git hook before each push",
  ci: "Pull requests and pushes to the main branch",
  schedule: "Scheduled pipeline run (cron)",
  manual: "bca run without a trigger"
});

/** What starts a trigger of your own in a pipeline ("on"). */
export const EVENTS = Object.freeze({
  push: "A push to a branch (branches, paths)",
  "pull-request": "A pull request (branches, paths)",
  tag: "A tag is pushed (tags)",
  release: "A release is published (GitHub)",
  manual: "Started by hand in the pipeline"
});

/** The Git hooks a trigger of your own can be. pre-commit and pre-push are the built-in triggers. */
export const HOOKS = Object.freeze(["post-commit", "post-merge", "post-checkout", "post-rewrite", "pre-rebase", "pre-merge-commit", "prepare-commit-msg", "commit-msg"]);

const TRIGGER_NAME = /^[a-z0-9][a-z0-9._-]*$/u;

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
  codegraph: { outputDir: "docs/codegraph" },
  handbook: { outputDir: "docs/handbook" },
  layers: { outputDir: "docs/layers" },
  simulation: { outputDir: "docs/simulation" }
});

/**
 * What starts a trigger: "hook" (a Git hook), "pipeline" (events or a cron), or "call" (its name only).
 * @param definition the trigger of your own as it is defined, for a name that is not built in
 */
export function triggerKind(trigger, definition) {
  if (["pre-commit", "pre-push"].includes(trigger)) return "hook";
  if (["ci", "schedule"].includes(trigger)) return "pipeline";
  if (trigger === "manual" || !definition) return "call";
  return definition.hook ? "hook" : definition.on?.length || definition.cron ? "pipeline" : "call";
}

export function syncModesFor(trigger, definition) {
  if (TRIGGERS[trigger] || !definition) return ["pre-commit", "pre-push", "manual"].includes(trigger) ? HOOK_SYNC : PIPELINE_SYNC;
  const kind = triggerKind(trigger, definition);
  // Started by its name, it runs wherever your script runs: on a machine or in a pipeline.
  return kind === "hook" ? HOOK_SYNC : kind === "pipeline" ? PIPELINE_SYNC : Object.keys(SYNC_MODES);
}

const list = (value) => [value ?? []].flat().flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);

/**
 * Normalizes a trigger of your own.
 * @param trigger what .bca.json or the builder says: { title?, on?, branches?, paths?, tags?, cron?, hook? }
 * @returns { title?, on?, branches?, paths?, tags?, cron?, hook? } with only what is set
 */
export function customTrigger(name, trigger = {}) {
  if (!TRIGGER_NAME.test(String(name ?? ""))) throw new Error(`a trigger needs a name of lowercase letters, digits, ".", "_", or "-", not "${name ?? ""}"`);
  if (TRIGGERS[name]) throw new Error(`"${name}" is a built-in trigger; give your own another name`);
  const on = [...new Set(list(trigger.on))];
  const unknown = on.filter((event) => !EVENTS[event]);
  if (unknown.length) throw new Error(`trigger "${name}" starts on "${unknown[0]}", which is not an event; use ${Object.keys(EVENTS).join(", ")}`);
  const hook = trigger.hook ? String(trigger.hook).trim() : undefined;
  if (hook && !HOOKS.includes(hook)) throw new Error(`trigger "${name}" is the Git hook "${hook}"; use ${HOOKS.join(", ")} (pre-commit and pre-push are built-in triggers)`);
  if (hook && (on.length || trigger.cron)) throw new Error(`trigger "${name}" is a Git hook and a pipeline event at once; make two triggers`);
  const filters = Object.fromEntries(["branches", "paths", "tags"].map((key) => [key, list(trigger[key])]).filter(([, value]) => value.length));
  if (filters.tags && !on.includes("tag")) throw new Error(`trigger "${name}" names tags but does not start on a tag; add "tag" to "on"`);
  if ((filters.branches || filters.paths) && !on.some((event) => ["push", "pull-request"].includes(event))) throw new Error(`trigger "${name}" names branches or paths but does not start on a push or a pull request; add "push" or "pull-request" to "on"`);
  const title = String(trigger.title ?? "").trim();
  return {
    ...(title ? { title } : {}),
    ...(on.length ? { on } : {}),
    ...filters,
    ...(trigger.cron ? { cron: validateCron(trigger.cron) } : {}),
    ...(hook ? { hook } : {})
  };
}

/** One line that says what starts a trigger of your own. */
export function triggerSummary(name, definition = {}) {
  if (definition.title) return definition.title;
  if (definition.hook) return `Git hook ${definition.hook}`;
  const parts = (definition.on ?? []).map((event) => ({
    push: `pushes${definition.branches ? ` to ${definition.branches.join(", ")}` : ""}`,
    "pull-request": `pull requests${definition.branches ? ` into ${definition.branches.join(", ")}` : ""}`,
    tag: `tags${definition.tags ? ` ${definition.tags.join(", ")}` : ""}`,
    release: "a published release",
    manual: "by hand in the pipeline"
  })[event]);
  if (definition.cron) parts.push(`cron ${definition.cron}`);
  if (!parts.length) return `bca run --trigger ${name}, from a script of yours`;
  return `${parts.join(", ")}${definition.paths ? `, when ${definition.paths.join(", ")} changed` : ""}`.replace(/^./u, (letter) => letter.toUpperCase());
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

/**
 * Normalizes and validates the automation section.
 * @param pluginTasks ids of the tasks the project's plugins contribute
 */
export function automationConfig(config = {}, { pluginTasks = [] } = {}) {
  const allowed = [...Object.keys(TASKS), ...pluginTasks];
  const automation = config.automation ?? {};
  const triggers = {};
  for (const [name, trigger] of Object.entries(automation.triggers ?? {})) {
    if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) throw new Error(`trigger "${name}" must be an object such as { "tasks": ["check"], "sync": "none" }`);
    // Any name that is not built in is a trigger of your own.
    const custom = TRIGGERS[name] ? undefined : customTrigger(name, trigger);
    const sync = trigger.sync ?? "none";
    if (!syncModesFor(name, custom).includes(sync)) {
      throw new Error(`trigger "${name}" supports sync ${syncModesFor(name, custom).join(", ")}, not "${sync}"`);
    }
    triggers[name] = {
      tasks: parseList(trigger.tasks ?? [], allowed, `${name} tasks`),
      sync,
      ...(name === "schedule" && trigger.cron ? { cron: validateCron(trigger.cron) } : {}),
      ...(custom ? { ...(custom.cron ? { cron: custom.cron } : {}), custom } : {})
    };
  }
  const hooks = automation.hooks ?? "none";
  const ci = automation.ci ?? "none";
  if (!HOOK_MANAGERS.includes(hooks)) throw new Error(`automation.hooks must be one of ${HOOK_MANAGERS.join(", ")}`);
  if (!CI_PROVIDERS.includes(ci)) throw new Error(`automation.ci must be one of ${CI_PROVIDERS.join(", ")}`);
  return { hooks, ci, triggers };
}

/**
 * Output directories (relative to the project root) that a task writes.
 * @param pluginOutputs outputs of plugin tasks, already asked from the plugins: { [task]: paths }
 */
export function taskOutputs(task, config = {}, pluginOutputs = {}) {
  if (pluginOutputs[task]) return pluginOutputs[task];
  if (task === "report") return [config.report?.outputDir ?? DEFAULTS.report.outputDir];
  if (task === "docs") return [config.docs?.outputDir ?? DEFAULTS.docs.outputDir];
  if (task === "codegraph") return [config.codegraph?.outputDir ?? DEFAULTS.codegraph.outputDir];
  if (task === "handbook") return [config.handbook?.outputDir ?? DEFAULTS.handbook.outputDir];
  if (task === "layers") return [config.layers?.outputDir ?? DEFAULTS.layers.outputDir];
  if (task === "simulate") return [config.simulation?.outputDir ?? DEFAULTS.simulation.outputDir, ...(config.simulation?.snapshotDir ? [config.simulation.snapshotDir] : [])];
  if (task === "diagrams") {
    return (config.diagrams ?? []).flatMap(({ output }) => {
      if (!output) return [];
      const d2 = output.replace(/\.[^./\\]+$/u, ".d2");
      return [...new Set([output, d2])];
    });
  }
  return [];
}

export function outputsFor(tasks, config, base = "", pluginOutputs = {}) {
  return [...new Set(tasks.flatMap((task) => taskOutputs(task, config, pluginOutputs)))]
    .map((output) => path.posix.join(base.replaceAll("\\", "/") || ".", output.replaceAll("\\", "/")));
}
