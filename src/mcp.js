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
  config: architectureFields.config
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

  server.registerTool("bc_atlas_check", {
    description: "Assess architecture health: cycles, policy violations, fan-in/fan-out hot spots, diagnostics, and unresolved references.",
    inputSchema: z.object({
      ...projectFields,
      failOn: z.enum(FAIL_LEVELS).optional(),
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
      diagrams: result.diagrams.map(({ view, skipped, nodes, edges }) => ({ view, skipped, nodes, edges }))
    };
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
