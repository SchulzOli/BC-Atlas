import path from "node:path";
import { statSync } from "node:fs";
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
  const levels = await dependencyLevels(context, { model });
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
  const baseline = proposal ? undefined : await readBaseline(context.baselineFile);
  return {
    context,
    levels,
    architecture,
    proposal,
    result,
    baseline: compareWithBaseline(result.violations, baseline)
  };
}
