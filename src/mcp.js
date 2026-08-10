#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { createArchitectureModel } from "./architecture.js";
import { createCapabilities } from "./capabilities.js";
import { renderD2 } from "./d2.js";
import { renderSvg } from "./svg.js";
import { planMetadataEdit, writeMetadataEdit } from "./docs/al-ui-writer.js";
import { documentationGlossary } from "./docs/tags.js";
import { writeCorpusDocumentation } from "./docs/markdown.js";
import { loadCorpus, scenarioSummary } from "./docs/model.js";

const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));
const VIEWS = ["project", "module", "object", "data", "call", "boundary", "contracts", "events", "ui", "workflow"];

const architectureFields = {
  path: z.string().min(1).describe("AL file or project directory"),
  projectRoot: z.string().min(1).optional().describe(
    "App or multi-app workspace root; path becomes the rendered folder focus"
  ),
  view: z.enum(VIEWS).optional(),
  object: z.string().optional(),
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
  workflowDepth: z.number().int().positive().optional(),
  workflowMaxNodes: z.number().int().positive().optional(),
  workflowEdgeTypes: z.array(z.enum(["calls", "events", "writes", "reads"])).optional(),
  maxEdges: z.number().int().positive().optional(),
  direction: z.enum(["right", "down", "left", "up"]).optional(),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
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

function outputPath(requested, format) {
  const absolute = path.resolve(requested);
  return path.extname(absolute).toLowerCase() === `.${format}` ? absolute : `${absolute}.${format}`;
}

async function generateDiagram(args) {
  const format = args.format ?? "svg";
  const architecture = await createArchitectureModel(args.path, architectureOptions(args));
  const output = outputPath(args.output, format);
  await fs.mkdir(path.dirname(output), { recursive: true });

  if (format === "json") {
    await fs.writeFile(output, `${JSON.stringify(architecture.model, null, 2)}\n`);
    return { output, format, files: architecture.model.files, nodes: architecture.model.objects.length, edges: architecture.model.edges.length };
  }

  const d2 = renderD2(architecture.model, architecture.renderOptions);
  if (format === "d2") {
    await fs.writeFile(output, d2);
    return { output, format, files: architecture.model.files, nodes: architecture.model.objects.length, edges: architecture.model.edges.length };
  }

  const d2Output = output.replace(/\.svg$/iu, ".d2");
  await fs.writeFile(d2Output, d2);
  await fs.writeFile(output, await renderSvg(d2, architecture.options));
  return { output, d2Output, format, files: architecture.model.files, nodes: architecture.model.objects.length, edges: architecture.model.edges.length };
}

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
    description: "Generate Markdown from documented AL UI tests.",
    inputSchema: z.object({
      path: z.string().min(1),
      outputDirectory: z.string().min(1).default("docs/generated")
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, outputDirectory }) => {
    const written = await writeCorpusDocumentation(await loadCorpus(input), outputDirectory);
    return { written };
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

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  serveStdio(() => createMcpServer(), {
    onerror: (error) => console.error(`bca-mcp: ${error.message}`)
  });
  console.error("BC Atlas MCP server running on stdio.");
}
