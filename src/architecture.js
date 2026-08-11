import path from "node:path";
import { analyze } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { addInsights } from "./insights.js";
import { resolveModel } from "./resolver.js";
import { createView, filterModel } from "./views.js";

export function positiveInteger(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

export function mergeArchitectureOptions(config, values) {
  return {
    ...config,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    namespaces: values.namespace ?? config.namespaces ?? [],
    types: values.type ?? config.types ?? [],
    include: values.include ?? config.include ?? [],
    exclude: values.exclude ?? config.exclude ?? [],
    scope: values.scope ?? config.scope ?? [],
    entry: values.entry ?? config.entry ?? config.entries
  };
}

export async function createArchitectureModel(input, values = {}) {
  const config = await loadConfig(values.projectRoot ?? values["project-root"] ?? input, values.config);
  const options = mergeArchitectureOptions(config.values, values);
  const projectRoot = path.resolve(options.projectRoot ?? options["project-root"] ?? input);
  const selectedPath = path.resolve(input);
  const relativeFocus = path.relative(projectRoot, selectedPath);
  if (relativeFocus.startsWith("..") || path.isAbsolute(relativeFocus)) {
    throw new Error(`selected focus path must be inside project root: ${projectRoot}`);
  }
  options.projectRoot = projectRoot;
  options.focusPath = relativeFocus ? relativeFocus.replaceAll("\\", "/") : undefined;
  const direction = options.direction ?? "right";
  const view = options.view ?? "project";
  const groupBy = options["group-by"] ?? options.groupBy ?? (
    view === "project" ? "role" : "namespace"
  );
  if (!["right", "down", "left", "up"].includes(direction)) {
    throw new Error(`unsupported direction: ${direction}`);
  }
  if (!["namespace", "folder", "type", "role"].includes(groupBy)) {
    throw new Error(`unsupported group-by mode: ${groupBy}`);
  }
  if (view === "module" && !["namespace", "folder"].includes(groupBy)) {
    throw new Error("module view supports --group-by namespace or folder");
  }
  const requestedModuleDepth = options["module-depth"] ?? options.moduleDepth ?? "auto";
  const moduleDepth = requestedModuleDepth === "auto"
    ? "auto"
    : positiveInteger(requestedModuleDepth, "module-depth");
  const members = (Array.isArray(options.members) ? options.members : [options.members])
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const invalidMembers = members.filter((member) =>
    !["fields", "actions", "triggers", "events", "procedures"].includes(member)
  );
  if (invalidMembers.length) throw new Error(`unsupported member categories: ${invalidMembers.join(", ")}`);

  let model = resolveModel(await analyze(projectRoot));
  model.projectRoot = projectRoot;
  model.selectedPath = selectedPath;
  model = filterModel(model, options);
  model = addInsights(model, options.forbiddenDependencies ?? []);
  const workflow = options.workflow ?? {};
  model = createView(model, view, {
    object: options.object,
    objectInboundDepth: options["object-inbound-depth"] ?? options.objectInboundDepth,
    objectOutboundDepth: options["object-outbound-depth"] ?? options.objectOutboundDepth,
    groupBy,
    moduleDepth,
    folderDepth: positiveInteger(
      options["folder-depth"] ?? options.folderDepth,
      "folder-depth",
      1
    ),
    includeUnresolvedCalls:
      options["include-unresolved-calls"] ?? options.includeUnresolvedCalls ?? false,
    rootProcedure: options["root-procedure"] ?? options.rootProcedure,
    callDepth: options["call-depth"] ?? options.callDepth,
    callDirection: options["call-direction"] ?? options.callDirection,
    expandProcedures: options["expand-procedures"] ?? options.expandProcedures ?? false,
    expandFrameworkCalls:
      options["expand-framework-calls"] ?? options.expandFrameworkCalls ?? false,
    scope: options.scope,
    focus: options.focus,
    entry: options.entry ?? workflow.entry ?? workflow.entries,
    depth: options["workflow-depth"] ?? options.workflowDepth ?? workflow.depth,
    maxNodes:
      options["workflow-max-nodes"] ?? options.workflowMaxNodes ?? workflow.maxNodes,
    maxEdges:
      values["max-edges"] ?? workflow.maxEdges ??
      options["max-edges"] ?? options.maxEdges,
    edgeTypes:
      options["workflow-edge-types"] ?? options.workflowEdgeTypes ?? workflow.edgeTypes,
    phases: options.phases ?? workflow.phases,
    stop: options.stop ?? options.stopConditions ?? workflow.stop ?? workflow.stopConditions,
    collapse:
      options.collapse ?? options.collapseUtilities ??
      workflow.collapse ?? workflow.collapseUtilities
  });
  model = addInsights(model);
  if (!model.objects.length && !model.emptyMessage) {
    throw new Error("no AL objects matched");
  }

  const seriousDiagnostics = model.diagnostics.filter(
    ({ severity }) => severity === "error" || severity === "warning"
  );
  if (options.strict && seriousDiagnostics.length) {
    throw new Error(
      `${seriousDiagnostics.length} diagnostic(s) in strict mode; run inspect for details`
    );
  }

  return {
    model,
    options,
    view,
    seriousDiagnostics,
    renderOptions: {
      direction,
      title: options.title ?? `AL ${view} architecture`,
      includeExternal: !(options["no-external"] ?? options.noExternal ?? false),
      details: options.details ?? false,
      memberNames: view === "object",
      members: members.length ? members : undefined,
      groupBy: view === "module" ? "namespace" : groupBy,
      sourceUrlTemplate: options["source-url"] ?? options.sourceUrl,
      sourceRef: options["source-ref"] ?? options.sourceRef,
      sourcePathPrefix: options["source-path-prefix"] ?? options.sourcePathPrefix,
      roleMappings: options.roleMappings,
      showLegend: !(options["no-legend"] ?? options.noLegend ?? false),
      maxEdges: positiveInteger(options["max-edges"] ?? options.maxEdges, "max-edges", 500)
    }
  };
}
