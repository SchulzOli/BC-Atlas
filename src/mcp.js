#!/usr/bin/env node

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { createArchitectureModel } from "./architecture.js";
import { createCapabilities, FAIL_LEVELS, REPORT_VIEWS, VIEWS as VIEW_CATALOG } from "./capabilities.js";
import { runHealthCheck } from "./commands/check.js";
import { runAutomation } from "./automation/run.js";
import { applySetup, createPlan } from "./automation/setup.js";
import { checkForUpdate } from "./commands/update.js";
import { writeExplorer } from "./commands/explore.js";
import { assessArchitecture } from "./blueprint/index.js";
import { architectureJson } from "./blueprint/report.js";
import { planExtraction } from "./blueprint/extract.js";
import { planObjectMove } from "./commands/refactor.js";
import { applyRefactoring } from "./refactor/move.js";
import { planSurface } from "./refactor/surface.js";
import { generateReport } from "./commands/report.js";
import { resolveOutput, writeArchitecture } from "./output.js";
import { planMetadataEdit, writeMetadataEdit } from "./docs/al-ui-writer.js";
import { documentationGlossary } from "./docs/tags.js";
import { DOCUMENT_MODES, EXPORT_FORMATS, exportDocumentation } from "./docs/export.js";
import { loadCorpus, scenarioSummary } from "./docs/model.js";

const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
const VIEWS = VIEW_CATALOG.map(([id]) => id);

const architectureFields = {
  path: z.string().min(1).describe("AL file or project directory"),
  projectRoot: z.string().min(1).optional().describe(
    "App or multi-app workspace root; path becomes the rendered folder focus"
  ),
  view: z.enum(VIEWS).optional(),
  object: z.string().optional(),
  objectInboundDepth: z.number().int().nonnegative().optional(),
  objectOutboundDepth: z.number().int().nonnegative().optional(),
  members: z.array(z.enum(["fields", "actions", "triggers", "events", "procedures"])).optional(),
  scope: z.array(z.string()).optional(),
  focus: z.string().optional(),
  entry: z.array(z.string()).optional(),
  namespace: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  groupBy: z.enum(["namespace", "folder", "type", "role"]).optional(),
  moduleDepth: z.union([z.literal("auto"), z.number().int().positive()]).optional(),
  folderDepth: z.number().int().positive().optional(),
  includeUnresolvedCalls: z.boolean().optional(),
  rootProcedure: z.array(z.string()).optional(),
  callDepth: z.number().int().nonnegative().optional(),
  callDirection: z.enum(["incoming", "outgoing", "both"]).optional(),
  expandProcedures: z.boolean().optional(),
  expandFrameworkCalls: z.boolean().optional(),
  workflowDepth: z.number().int().positive().optional(),
  workflowMaxNodes: z.number().int().positive().optional(),
  workflowEdgeTypes: z.array(z.enum(["calls", "events", "writes", "reads"])).optional(),
  maxEdges: z.number().int().positive().optional(),
  direction: z.enum(["right", "down", "left", "up"]).optional(),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceRef: z.string().optional(),
  sourcePathPrefix: z.string().optional(),
  noLegend: z.boolean().optional(),
  details: z.boolean().optional(),
  noExternal: z.boolean().optional(),
  config: z.string().optional(),
  strict: z.boolean().optional()
};

function architectureOptions(args) {
  const { path: _path, output: _output, format: _format, ...values } = args;
  return values;
}

function text(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
  };
}

function tool(handler) {
  return async (args) => {
    try {
      return text(await handler(args));
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true
      };
    }
  };
}

async function generateDiagram(args) {
  const architecture = await createArchitectureModel(args.path, architectureOptions(args));
  const target = resolveOutput({ output: args.output, format: args.format ?? "svg" });
  const { files } = await writeArchitecture(architecture, target);
  return {
    output: target.finalOutput,
    files,
    format: target.format,
    analyzedFiles: architecture.model.files,
    nodes: architecture.model.objects.length,
    edges: architecture.model.edges.length
  };
}

const projectFields = {
  path: architectureFields.path,
  projectRoot: architectureFields.projectRoot,
  namespace: architectureFields.namespace,
  type: architectureFields.type,
  include: architectureFields.include,
  exclude: architectureFields.exclude,
  config: architectureFields.config,
  compiler: z.string().optional().describe("AL compiler: auto (AL Language extension or AL Development Tools when installed), off, or a path"),
  compilerLog: z.string().optional().describe("Import diagnostics from an AL compiler error log file or folder")
};

export function createMcpServer(version = pkg.version) {
  const server = new McpServer({ name: "bc-atlas", version });

  server.registerTool("bc_atlas_capabilities", {
    description: "Read the versioned BC Atlas command and safety contract.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async () => createCapabilities(version)));

  server.registerTool("bc_atlas_inspect", {
    description: "Analyze AL source and return a selected architecture model as JSON.",
    inputSchema: z.object(architectureFields),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async (args) => (await createArchitectureModel(args.path, architectureOptions(args))).model));

  server.registerTool("bc_atlas_generate_diagram", {
    description: "Analyze AL source and write a D2, JSON, or SVG architecture file.",
    inputSchema: z.object({
      ...architectureFields,
      output: z.string().min(1).describe("Output file path"),
      format: z.enum(["d2", "json", "svg"]).default("svg")
    }),
    annotations: { idempotentHint: true }
  }, tool(generateDiagram));

  server.registerTool("bc_atlas_explore", {
    description: "Write the interactive dependency explorer (HTML) or its temporal graph document (JSON): object and app dependencies classified as intra-app, declared, implicit, undeclared, or unresolved, optionally replayed over Git history.",
    inputSchema: z.object({
      ...projectFields,
      output: z.string().min(1).describe("Output file path (.html or .json)"),
      format: z.enum(["html", "json"]).optional(),
      lens: z.enum(["dependency"]).optional(),
      paths: z.array(z.string()).optional().describe("Only analyze AL files below these project-relative folders or globs"),
      history: z.boolean().optional(),
      historyBy: z.enum(["commits", "prs", "releases"]).optional().describe("One frame per commit, merged pull request, or release tag; implies history"),
      last: z.number().int().positive().optional().describe("Only the last n steps"),
      maxCommits: z.number().int().positive().optional(),
      since: z.string().optional(),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { document, file, format } = await writeExplorer(input, values);
    return {
      output: file,
      format,
      frames: document.timeline.frames.length,
      objects: document.levels.object.nodes.length,
      dependencies: document.levels.object.edges.length,
      crossApp: document.levels.object.edges.filter(({ scope }) => scope === "inter-app").length,
      apps: document.levels.app.nodes.map(({ id, label, origin }) => ({ id, label, origin })),
      appDependencies: document.levels.app.edges.map(({ source, target, dependency, objectEdges }) =>
        ({ source, target, dependency, objectEdges }))
    };
  }));

  server.registerTool("bc_atlas_architecture", {
    description: "Find or check the target architecture: components, layers, allowed dependencies, every dependency that points the wrong way grouped into work items with a resolution strategy (declare-dependency, move-extension, move-subscriber, move-permissions, move-field-to-extension, move-object-down, extract-interface, raise-event, ...) and, for moves, the bca refactor command that performs them; data ownership (which components write, read, or extend each table), checks of the architecture, clean-architecture metrics, and which components can become apps of their own. Proposes an architecture when .bca.json defines none.",
    inputSchema: z.object({
      ...projectFields,
      propose: z.boolean().optional().describe("Propose an architecture even when .bca.json defines one"),
      groupBy: z.enum(["auto", "coupling", "namespace", "folder", "module", "app"]).optional().describe("auto: modules or apps, too large ones split by namespace; coupling: namespaces that are tightly coupled to each other"),
      depth: z.number().int().positive().optional(),
      paths: z.array(z.string()).optional(),
      limit: z.number().int().positive().default(50).describe("Most work items to return")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, limit, ...values }) => {
    const report = architectureJson(await assessArchitecture(input, values));
    const { violations, ...rest } = report;
    return { ...rest, workItems: report.workItems.slice(0, limit), violationCount: violations.length };
  }));

  server.registerTool("bc_atlas_extraction_plan", {
    description: "Plan extracting one component of the architecture as an app of its own: objects and files to move, the components it uses and that use it, blockers (wrong-way dependencies, internal objects, mutual dependencies) with their work items, the app.json it needs (dependencies, idRanges, internalsVisibleTo), tables whose data must move (ObsoleteState PendingMove/Moved with MovedTo/MovedFrom), permission sets to split, and the steps in order.",
    inputSchema: z.object({
      ...projectFields,
      component: z.string().min(1).describe("Component name from bc_atlas_architecture"),
      paths: z.array(z.string()).optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, component, ...values }) => planExtraction(await assessArchitecture(input, values), component)));

  server.registerTool("bc_atlas_refactor_move", {
    description: "Move an AL object to another component: the file moves to the component's folder (cut out of a file it shares), its namespace becomes the component's, and referencing files get the using they need. Returns a diff and warnings (app dependencies, ID ranges, table data). dryRun (default) writes nothing; apply with dryRun false, then compile and run bc_atlas_check. Work items of bc_atlas_architecture name the object and component in their command.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      object: z.string().min(1).describe("Object selector: codeunit:50100, table:Sales Doc, or a name"),
      to: z.string().optional().describe("Target component"),
      folder: z.string().optional().describe("Target folder relative to the project root (default: the component's folder)"),
      namespace: z.string().optional().describe("Target namespace (default: the component's namespace)"),
      dryRun: z.boolean().default(true)
    }),
    annotations: { destructiveHint: false, idempotentHint: false }
  }, tool(async ({ path: input, dryRun, ...values }) => {
    const { assessment, plan } = await planObjectMove(input, values);
    const applied = dryRun ? undefined : await applyRefactoring(assessment.model.root, plan);
    const { operations, ...rest } = plan;
    return { ...rest, operations: operations.map(({ action, from, path: file }) => ({ action, from, path: file })), applied: Boolean(applied) };
  }));

  server.registerTool("bc_atlas_refactor_surface", {
    description: "Lock the public surface of components: objects no other component uses (codeunits without events, queries, non-extensible enums) get Access = Internal, and .bca.json lists the objects other components use in exposes, so bc_atlas_check reports any new use of something else. bc_atlas_architecture returns each component's surface. dryRun (default) returns the diff.",
    inputSchema: z.object({
      path: architectureFields.path,
      projectRoot: architectureFields.projectRoot,
      config: architectureFields.config,
      component: z.string().optional().describe("Only this component (default: all)"),
      internal: z.boolean().default(true).describe("Set Access = Internal on objects no other component uses"),
      exposes: z.boolean().default(true).describe("Write exposes to .bca.json"),
      dryRun: z.boolean().default(true)
    }),
    annotations: { destructiveHint: false, idempotentHint: true }
  }, tool(async ({ path: input, dryRun, component, internal, exposes, ...values }) => {
    const assessment = await assessArchitecture(input, { ...values, compiler: "off" });
    const plan = await planSurface(assessment, { component, internal, exposes });
    const applied = dryRun ? undefined : await applyRefactoring(assessment.model.root, plan);
    const { operations, ...rest } = plan;
    return { ...rest, operations: operations.map(({ action, path: file }) => ({ action, path: file })), applied: Boolean(applied) };
  }));

  server.registerTool("bc_atlas_check", {
    description: "Assess architecture health: cycles, policy violations, fan-in/fan-out hot spots, diagnostics, and unresolved references; with the AL compiler installed, also compiler and code-analyzer findings.",
    inputSchema: z.object({
      ...projectFields,
      failOn: z.enum(FAIL_LEVELS).optional(),
      analyzers: z.array(z.string()).optional().describe("Code analyzers for the AL compile, e.g. CodeCop, UICop"),
      maxFanIn: z.number().int().positive().optional(),
      maxFanOut: z.number().int().positive().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => (await runHealthCheck(input, values)).report));

  server.registerTool("bc_atlas_report", {
    description: "Write a Markdown architecture report with an overview, health summary, and diagrams for several views.",
    inputSchema: z.object({
      ...projectFields,
      outputDir: z.string().min(1).default("docs/atlas"),
      views: z.array(z.enum([...REPORT_VIEWS, "call"])).optional(),
      format: z.enum(["svg", "d2"]).default("svg"),
      codegraph: z.boolean().optional(),
      json: z.boolean().optional(),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, views, ...values }) => {
    const result = await generateReport(input, { ...values, views: views?.join(",") });
    return {
      readme: result.readme,
      outputDirectory: result.outputDirectory,
      passed: result.health.passed,
      counts: result.health.counts,
      diagrams: result.diagrams.map(({ view, skipped, tooLarge, nodes, edges }) => ({ view, skipped, d2Only: tooLarge || undefined, nodes, edges }))
    };
  }));

  server.registerTool("bc_atlas_setup_plan", {
    description: "Detect an AL project and return setup questions with recommended answers for features, Git hooks, pipelines, schedules, and sync.",
    inputSchema: z.object({ path: z.string().min(1).describe("AL app folder") }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input }) => createPlan(input)));

  server.registerTool("bc_atlas_setup_apply", {
    description: "Write .bca.json, Git hooks, and a pipeline from setup answers. Preview with dryRun (default) before writing.",
    inputSchema: z.object({
      path: z.string().min(1),
      answers: z.object({
        features: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        tests: z.string().optional(),
        docsExport: z.array(z.enum(EXPORT_FORMATS)).optional(),
        docsAs: z.enum(DOCUMENT_MODES).optional(),
        language: z.string().optional(),
        hooks: z.enum(["husky", "git", "none"]).optional(),
        preCommit: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        prePush: z.array(z.enum(["check", "report", "docs", "codegraph"])).optional(),
        hookSync: z.enum(["verify", "stage", "none"]).optional(),
        editor: z.enum(["vscode", "none"]).optional(),
        updates: z.enum(["dependabot", "none"]).optional(),
        ci: z.enum(["github", "azure-devops", "none"]).optional(),
        ciSync: z.enum(["verify", "artifact", "none"]).optional(),
        schedule: z.string().optional().describe("Cron expression (UTC) or none"),
        scheduleSync: z.enum(["pull-request", "commit", "artifact", "verify", "none"]).optional()
      }).default({}),
      dryRun: z.boolean().default(true),
      force: z.boolean().default(false)
    })
  }, tool(async ({ path: input, answers, dryRun, force }) => applySetup(input, answers, { dryRun, force, version })));

  server.registerTool("bc_atlas_update_check", {
    description: "Check whether a newer BC Atlas version is available and return the release notes since the installed version. Update with the CLI: bca update.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, tool(async () => checkForUpdate(version)));

  server.registerTool("bc_atlas_run", {
    description: "Run the BC Atlas tasks configured for a trigger in .bca.json, or explicit tasks, and report sync status.",
    inputSchema: z.object({
      path: z.string().min(1),
      trigger: z.enum(["pre-commit", "pre-push", "ci", "schedule", "manual"]).default("manual"),
      tasks: z.array(z.enum(["check", "report", "docs", "codegraph", "diagrams"])).optional(),
      sync: z.enum(["none", "verify", "stage", "artifact", "pull-request", "commit"]).optional()
    })
  }, tool(async ({ path: input, ...options }) => {
    const { root: _root, ...result } = await runAutomation(input, options);
    return result;
  }));

  server.registerTool("bc_atlas_docs_list", {
    description: "List documented AL UI-test scenarios.",
    inputSchema: z.object({ path: z.string().min(1) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input }) => (await loadCorpus(input)).scenarios.map(scenarioSummary)));

  server.registerTool("bc_atlas_docs_show", {
    description: "Read one documented AL UI-test scenario and its source hash.",
    inputSchema: z.object({ path: z.string().min(1), id: z.string().min(1) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, id }) => {
    const scenario = (await loadCorpus(input)).byId.get(id);
    if (!scenario) throw new Error(`document ID "${id}" was not found`);
    return { ...scenarioSummary(scenario), fileHash: scenario.fileHash, value: scenario.value };
  }));

  server.registerTool("bc_atlas_docs_validate", {
    description: "Validate IDs, metadata, links, and prerequisites in AL UI-test documentation.",
    inputSchema: z.object({ path: z.string().min(1), strict: z.boolean().default(false) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, strict }) => {
    const corpus = await loadCorpus(input);
    const diagnostics = corpus.diagnostics.filter(({ severity }) =>
      severity === "error" || (strict && severity === "warning")
    );
    return { valid: diagnostics.length === 0, scenarios: corpus.scenarios.length, diagnostics };
  }));

  server.registerTool("bc_atlas_docs_generate", {
    description: "Generate user guides or test cases from documented AL UI tests as Markdown, HTML, DITA 1.3 tasks, or Azure DevOps Test Plans CSV.",
    inputSchema: z.object({
      path: z.string().min(1).describe("AL UI-test file or directory"),
      outputDirectory: z.string().min(1).default("docs/generated"),
      formats: z.array(z.enum(EXPORT_FORMATS)).default(["markdown"]),
      as: z.enum(DOCUMENT_MODES).default("guide"),
      appRoot: z.string().min(1).optional().describe("AL app source for real captions, tooltips, and coverage"),
      language: z.string().optional().describe("Language tag such as de-DE; captions come from the app's XLIFF"),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, as: mode, ...options }) => {
    const result = await exportDocumentation(await loadCorpus(input), { ...options, mode });
    return { written: result.files, warnings: result.warnings };
  }));

  server.registerTool("bc_atlas_docs_edit", {
    description: "Preview or apply one AL documentation metadata change. Real writes require expectedFileHash.",
    inputSchema: z.object({
      path: z.string().min(1),
      id: z.string().min(1),
      operation: z.enum(["set", "unset"]),
      tag: z.string().min(1),
      value: z.string().optional(),
      qualifier: z.string().optional(),
      dryRun: z.boolean().default(true),
      expectedFileHash: z.string().optional()
    })
  }, tool(async ({ path: input, id, operation, tag, value, qualifier, dryRun, expectedFileHash }) => {
    if (!dryRun && !expectedFileHash) {
      throw new Error("expectedFileHash is required when dryRun is false");
    }
    const plan = await planMetadataEdit(input, id, {
      tag,
      value,
      qualifier,
      remove: operation === "unset",
      expectedFileHash
    });
    if (!dryRun) await writeMetadataEdit(plan);
    return {
      applied: !dryRun,
      changed: plan.changed,
      file: plan.file,
      documentId: plan.documentId,
      fileHash: plan.fileHash,
      preview: plan.preview
    };
  }));

  server.registerTool("bc_atlas_docs_glossary", {
    description: "Read the supported AL documentation tags and prerequisite types.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async () => documentationGlossary()));

  return server;
}

export async function startMcpServer(version = pkg.version) {
  serveStdio(() => createMcpServer(version), {
    onerror: (error) => console.error(`bca-mcp: ${error.message}`)
  });
  console.error(`BC Atlas ${version} MCP server running on stdio.`);
}

// npm installs bin entries as symlinks, so compare real paths.
function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) await startMcpServer();
