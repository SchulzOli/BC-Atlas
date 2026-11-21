// One AL project, read from its source: parsed, resolved, filtered by the
// selections of .bca.json and the command line, and with its insights.
// Every command and the view start here.
import { statSync } from "node:fs";
import path from "node:path";
import { analyze } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { filterModel, objectFilter, pathMatcher } from "./filters.js";
import { dependencyLens } from "./graph/lenses/dependency.js";
import { addInsights } from "./insights.js";
import { openParseCache } from "./parse-cache.js";
import { resolveModel } from "./resolver.js";

export function positiveInteger(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

/** The values of .bca.json with those of the call on top. */
export function mergeOptions(config, values) {
  return {
    ...config,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    namespaces: values.namespace ?? config.namespaces ?? [],
    types: values.type ?? config.types ?? [],
    include: values.include ?? config.include ?? [],
    exclude: values.exclude ?? config.exclude ?? []
  };
}

/**
 * Parses a project and resolves its references.
 * @param options merged .bca.json and CLI values
 * @param context { fileFilter, parseCache }; parseCache reuses parse results
 *   of unchanged files (src/parse-cache.js)
 */
export async function analyzeProject(projectRoot, options = {}, { fileFilter, parseCache } = {}) {
  // Without a cache from the caller, the one on disk: a second run parses
  // only changed files. Not for a subset of the files, whose save would drop
  // the others.
  const own = parseCache === undefined && !fileFilter && process.env.BCA_PARSE_CACHE !== "off"
    ? await openParseCache(projectRoot)
    : undefined;
  const model = await analyze(projectRoot, {
    fileFilter,
    parseCache: parseCache ?? own,
    al: { workspaceFile: options.al?.workspaceFile, settings: options.alSettings, editorSettings: options.alEditorSettings }
  });
  if (own) await own.save().catch(() => false);
  return resolveModel(model);
}

/**
 * What a call is about: the project root, its settings, and what is selected.
 * @param input app or workspace folder, or a folder or file inside the project root (the focus)
 * @returns { config, options, projectRoot, selectedPath, filter, fileFilter }
 */
export async function projectContext(input, values = {}) {
  const config = await loadConfig(values.projectRoot ?? input, values.config);
  const options = mergeOptions(config.values, values);
  const requestedRoot = path.resolve(options.projectRoot ?? input);
  const projectRoot = statSync(requestedRoot, { throwIfNoEntry: false })?.isFile() ? path.dirname(requestedRoot) : requestedRoot;
  const selectedPath = path.resolve(input);
  const focus = path.relative(projectRoot, selectedPath);
  if (focus.startsWith("..") || path.isAbsolute(focus)) {
    throw new Error(`selected focus path must be inside project root: ${projectRoot}`);
  }
  options.projectRoot = projectRoot;
  options.focusPath = focus ? focus.replaceAll("\\", "/") : undefined;
  const paths = [options.paths ?? []].flat().filter(Boolean);
  return {
    config,
    options,
    projectRoot,
    selectedPath,
    filter: objectFilter(options),
    fileFilter: paths.length ? pathMatcher(paths) : undefined
  };
}

/**
 * Reads a project.
 * @param context { cache, parseCache }: a shared `cache` Map reuses one parse
 *   of the same project and selection across calls
 * @returns { project, model, options, context, seriousDiagnostics }: `project`
 *   is everything that was read (shared, read only), `model` the selected
 *   objects with what lies next to them and the insights
 */
export async function loadProject(input, values = {}, { cache, parseCache } = {}) {
  const context = await projectContext(input, values);
  const { options, projectRoot, selectedPath, fileFilter } = context;
  const key = `${projectRoot}\n${[options.paths ?? []].flat().join("\n")}`;
  const read = () => analyzeProject(projectRoot, options, { fileFilter, parseCache });
  if (cache && !cache.has(key)) cache.set(key, await read());
  const project = cache ? cache.get(key) : await read();
  // The shared model is only read (test/project-cache.test.js freezes it).
  const model = addInsights(filterModel({ ...project, projectRoot, selectedPath }, options), options.forbiddenDependencies ?? []);
  if (!model.objects.length) {
    throw new Error(`no AL objects found in ${selectedPath}; check the path and the --include, --exclude, --namespace, --type, and --paths filters`);
  }
  const seriousDiagnostics = model.diagnostics.filter(({ severity }) => severity === "error" || severity === "warning");
  if (options.strict && seriousDiagnostics.length) {
    throw new Error(`${seriousDiagnostics.length} diagnostic(s) in strict mode; run "bca check" for details`);
  }
  return { project, model, options, context, seriousDiagnostics };
}

/** What depends on what, at the level of objects, namespaces, and apps (src/graph/lenses/dependency.js). */
export function projectLevels({ project, context }) {
  return dependencyLens(project, { filter: context.filter });
}
