import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import { analyzeProject, mergeArchitectureOptions } from "../architecture.js";
import { loadConfig } from "../config.js";
import { objectFilter, pathMatcher } from "../views.js";
import { dependencyLens } from "../graph/lenses/dependency.js";
import { BASELINE_FILE, compareWithBaseline, readBaseline } from "./baseline.js";
import { evaluateArchitecture } from "./evaluate.js";
import { proposeArchitecture } from "./propose.js";

export { evaluateArchitecture } from "./evaluate.js";
export { proposeArchitecture } from "./propose.js";

/** Options shared by bca architecture, bca check, the explorer, and the app. */
export async function architectureContext(input, values = {}) {
  const config = await loadConfig(values.projectRoot ?? input, values.config);
  const options = mergeArchitectureOptions(config.values, values);
  const requestedRoot = path.resolve(options.projectRoot ?? input);
  const projectRoot = statSync(requestedRoot).isFile() ? path.dirname(requestedRoot) : requestedRoot;
  const focus = path.relative(projectRoot, path.resolve(input));
  if (focus.startsWith("..") || path.isAbsolute(focus)) {
    throw new Error(`selected focus path must be inside project root: ${projectRoot}`);
  }
  const paths = [options.paths ?? []].flat().filter(Boolean);
  return {
    config,
    options,
    projectRoot,
    filter: objectFilter({ ...options, focusPath: focus ? focus.replaceAll("\\", "/") : undefined }),
    fileFilter: paths.length ? pathMatcher(paths) : undefined,
    baselineFile: path.resolve(projectRoot, options.architecture?.baseline ?? options.baseline ?? BASELINE_FILE)
  };
}

/** The current dependency graph (object, module, and app levels). */
export async function dependencyLevels(context, { model } = {}) {
  const resolved = model ?? await analyzeProject(context.projectRoot, context.options, { fileFilter: context.fileFilter });
  return dependencyLens(resolved, { filter: context.filter });
}

/**
 * Evaluates the configured architecture, or proposes one when the project has
 * none (or `propose` is set), and compares the violations with the baseline.
 */
export async function assessArchitecture(input, values = {}, { model } = {}) {
  const context = await architectureContext(input, values);
  const analyzed = model ?? await analyzeProject(context.projectRoot, context.options, { fileFilter: context.fileFilter });
  const levels = await dependencyLevels(context, { model: analyzed });
  const configured = context.options.architecture;
  let proposal;
  let architecture = configured;
  if (values.propose || !configured?.components?.length) {
    proposal = proposeArchitecture(levels, {
      groupBy: values.groupBy,
      depth: values.depth,
      minObjects: values.minObjects === undefined ? 1 : Number(values.minObjects)
    });
    architecture = proposal.architecture;
  }
  const result = evaluateArchitecture(levels, architecture);
  if (!proposal) locateChecks(result.checks, context);
  const baseline = proposal ? undefined : await readBaseline(context.baselineFile);
  return {
    context,
    model: analyzed,
    levels,
    architecture,
    proposal,
    result,
    baseline: compareWithBaseline(result.violations, baseline)
  };
}

/** Points the checks of the configuration at their component in .bca.json. */
function locateChecks(checks, context) {
  const file = context.config.path;
  if (!file || !checks.length) return;
  let lines;
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/u);
  } catch {
    return;
  }
  const relative = path.relative(context.projectRoot, file).replaceAll("\\", "/");
  const lineOf = (pattern) => {
    const index = lines.findIndex((line) => pattern.test(line));
    return index < 0 ? undefined : index + 1;
  };
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const architectureLine = lineOf(/"architecture"\s*:/u);
  for (const check of checks) {
    // Checks about code (a table others write) already point at the source.
    if (check.file) continue;
    const component = check.component ?? check.components?.[0];
    check.file = relative.startsWith("..") ? file : relative;
    check.line = (component && lineOf(new RegExp(`"name"\\s*:\\s*"${escape(component)}"`, "u"))) ?? architectureLine;
  }
}
