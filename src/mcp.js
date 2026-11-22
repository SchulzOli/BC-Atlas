#!/usr/bin/env node

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { createCapabilities, FAIL_LEVELS, REPORT_LENSES, VIEW_FORMATS, VIEW_FORMS, VIEW_LENSES } from "./capabilities.js";
import { runHealthCheck } from "./commands/check.js";
import { writeView } from "./commands/view.js";
import { viewOverview } from "./app/view.js";
import { generateReport } from "./commands/report.js";
import { loadProject } from "./project.js";
import { INSPECT_LIMIT, inspectModel } from "./inspect.js";
import { planMetadataEdit, writeMetadataEdit } from "./docs/al-ui-writer.js";
import { documentationGlossary } from "./docs/tags.js";
import { DOCUMENT_MODES, EXPORT_FORMATS, exportDocumentation } from "./docs/export.js";
import { loadCorpus, scenarioSummary } from "./docs/model.js";
import { createService } from "./app/service.js";
import { Workspace } from "./app/workspace.js";

const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url)));

// What every tool that reads a project takes.
const projectFields = {
  path: z.string().min(1).describe("AL file or project directory"),
  projectRoot: z.string().min(1).optional().describe("App or multi-app workspace root; path becomes the focus"),
  namespace: z.array(z.string()).optional(),
  type: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional().describe("Only analyze AL files below these project-relative folders or globs"),
  config: z.string().optional()
};

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

// The BC Atlas view as an MCP App (SEP-1865, io.modelcontextprotocol/ui): the page, and one
// workspace per project so that the page asks on an analysis that is there, as in VS Code.
export const APP_URI = "ui://bc-atlas/view.html";
export const APP_MIME = "text/html;profile=mcp-app";
const appServices = new Map();
function appService(input) {
  const root = path.resolve(input ?? ".");
  if (!appServices.has(root)) appServices.set(root, createService(new Workspace(root, {}, { live: true })));
  return { root, service: appServices.get(root) };
}

export function createMcpServer(version = pkg.version) {
  const server = new McpServer({ name: "bc-atlas", version });

  server.registerTool("bc_atlas_capabilities", {
    description: "Read the versioned BC Atlas command and safety contract.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async () => createCapabilities(version)));

  server.registerTool("bc_atlas_inspect", {
    description: `The resolved model, a part at a time: the objects that select names and the relations that touch them, and the diagnostics of their files, with a summary of the whole project (files, objects, relations, apps, cycles, hubs). At most limit objects (default ${INSPECT_LIMIT}); when there are more, next is the offset of the following page. detail summary (default) gives each object in a line and the relations counted by kind; full gives every member, and every relation with its evidence: ask for it for a few objects. For what the view shows, use bc_atlas_view.`,
    inputSchema: z.object({
      ...projectFields,
      select: z.array(z.string()).optional().describe("Which objects: selectors as in .bca.json, such as object:codeunit:50100, object:table:Customer, type:table, namespace:Contoso.Sales, app:Contoso Core, file:src/Sales/*.al, id:50100..50199. Objects that match any of them. Without it, every object of the workspace"),
      offset: z.number().int().min(0).optional().describe("Skip this many of the selected objects (next of the page before)"),
      limit: z.number().int().min(1).max(500).optional().describe(`At most this many objects (default ${INSPECT_LIMIT})`),
      detail: z.enum(["summary", "full"]).optional().describe("summary (default): each object in a line, the relations counted by kind; full: members, and relations with their evidence"),
      strict: z.boolean().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, select, offset, limit, detail, ...values }) => inspectModel((await loadProject(input, values)).model, { select, offset, limit, detail })));

  // ------------------------------------------------------------- MCP App
  // The BC Atlas view inside the chat (MCP Apps, io.modelcontextprotocol/ui): the same page the
  // VS Code extension shows. bc_atlas_app opens it; the page asks for everything else through
  // bc_atlas_app_call, which only the page can call.
  server.registerResource("BC Atlas view", APP_URI, {
    description: "The BC Atlas view: the graph of the project with its lenses, findings, and stories.",
    mimeType: APP_MIME
  }, async () => {
    const { renderAppHtml } = await import("./app/page.js");
    return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: renderAppHtml({ mode: "mcp" }), _meta: { ui: { prefersBorder: true } } }] };
  });

  server.registerTool("bc_atlas_app", {
    title: "BC Atlas view",
    description: "Show the BC Atlas view to the user, inside the chat: the interactive graph of the project with every lens, the findings, and the stories. It is the same view the VS Code extension shows. Use it when the user wants to see or explore something rather than read about it; lens, story, inside, and select choose what it opens on. In a client that does not render MCP Apps the tool returns a summary of the project and the address of what would be shown; use bc_atlas_view there.",
    inputSchema: z.object({
      path: projectFields.path,
      lens: z.string().optional().describe("The lens to open: overview, system, apps, data, calls, events, health, ... (bc_atlas_view lists them)"),
      story: z.string().optional().describe("A story to open instead: system or fix"),
      inside: z.string().optional().describe("Open inside this node: an object, an app, or a namespace"),
      select: z.string().optional().describe("Select this node, by id")
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: { ui: { resourceUri: APP_URI }, "ui/resourceUri": APP_URI }
  }, async ({ path: input, lens, story, inside, select }) => {
    const { root, service } = appService(input);
    const overview = await service.call("overview");
    const address = `#${new URLSearchParams(Object.entries({ lens, story, inside, sel: select }).filter(([, value]) => value)).toString()}`;
    const summary = {
      path: root,
      address: address === "#" ? "" : address,
      title: overview.title,
      health: { passed: overview.health?.passed, ...(overview.health?.counts ?? {}) }
    };
    return { content: [{ type: "text", text: `The BC Atlas view of ${overview.title} is shown to the user${address === "#" ? "" : ` (${address})`}.\n${JSON.stringify(summary, null, 2)}` }], structuredContent: summary };
  });

  server.registerTool("bc_atlas_app_call", {
    title: "BC Atlas view: a request of the page",
    description: "A request of the BC Atlas view (bc_atlas_app) to the project it shows: what the VS Code extension answers for the same page. Only the page calls it.",
    inputSchema: z.object({
      path: z.string().describe("The project the view shows"),
      method: z.string().describe("The method of the view service"),
      params: z.record(z.string(), z.unknown()).optional()
    }),
    _meta: { ui: { resourceUri: APP_URI, visibility: ["app"] }, "ui/resourceUri": APP_URI }
  }, async ({ path: input, method, params = {} }) => {
    try {
      const { root, service } = appService(input);
      let result;
      if (method === "saveFile") {
        // A chat client has no save dialog: what the view exports goes into the project.
        const directory = path.join(root, ".bca", "exports");
        const file = path.join(directory, path.basename(String(params.name ?? "export")));
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(file, Buffer.from(String(params.content ?? ""), params.encoding === "base64" ? "base64" : "utf8"));
        result = { path: path.relative(root, file).replaceAll("\\", "/") };
      } else if (method === "openFile") {
        throw new Error(`${params.file}${params.line ? `:${params.line}` : ""}`);
      } else {
        result = await service.call(method, params);
      }
      return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });

  server.registerTool("bc_atlas_check", {
    description: "Assess the health of the code: cycles, forbidden dependencies, fan-in/fan-out hot spots, undocumented public API, diagnostics, and unresolved references.",
    inputSchema: z.object({
      ...projectFields,
      failOn: z.enum(FAIL_LEVELS).optional(),
      maxFanIn: z.number().int().positive().optional(),
      maxFanOut: z.number().int().positive().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => (await runHealthCheck(input, values)).report));

  server.registerTool("bc_atlas_report", {
    description: "Write a Markdown report (README.md) with the numbers of the project, a picture of each lens, and the health summary.",
    inputSchema: z.object({
      ...projectFields,
      outputDir: z.string().min(1).default("docs/atlas"),
      lenses: z.array(z.string()).optional().describe(`The lenses to draw (default ${REPORT_LENSES.join(", ")}); one the project does not have is left out`),
      json: z.boolean().optional(),
      title: z.string().optional()
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, lenses, ...values }) => {
    const result = await generateReport(input, { ...values, lenses: lenses?.join(",") });
    return {
      readme: result.readme,
      outputDirectory: result.outputDirectory,
      passed: result.health.passed,
      counts: result.health.counts,
      pictures: result.pictures.map(({ lens, file, nodes, relations }) => ({ lens, file, nodes, relations }))
    };
  }));

  server.registerTool("bc_atlas_view", {
    description: "The BC Atlas view without a window: everything read from the AL source is one graph (apps, namespaces, objects, health rules, and what they do with each other). Without lens, story, inside, or focus it returns what there is to see: the lenses and stories of the project. A lens (overview: how it works, in columns from the screens over the logic to the data; system, apps, modules, data, calls, events, contracts, pages, security, visibility, health) returns that part of the graph: nodes with their facts and findings, and relations. inside goes into one node: an object opens to its procedures and what each does, an app or a namespace to its objects; focus returns a node and what is near it; story returns a generated walk through the graph (system: what the system is; fix: what to fix). format text, md, or csv returns that text; with output it writes a file, also a picture (svg, png) in a form (2d, diagram, 3d). Reads the source; changes nothing but the output file.",
    inputSchema: z.object({
      path: projectFields.path,
      projectRoot: projectFields.projectRoot,
      config: projectFields.config,
      paths: projectFields.paths,
      lens: z.string().optional().describe(`The part of the graph to return: ${VIEW_LENSES.join(", ")}; health needs a finding`),
      inside: z.string().optional().describe("Go into this node: an object (codeunit:50100, table:Sales Header, or a name), or an app or a namespace"),
      focus: z.string().optional().describe("Only this node and what is near it: a name, an ID, or a selector such as table:Customer"),
      depth: z.number().int().positive().optional().describe("Steps from the focus node (default 1)"),
      find: z.string().optional().describe("Only nodes whose name, type, namespace, or ID match (in a picture they stand out)"),
      hide: z.array(z.string()).optional().describe("Kinds of node to leave out: codeunit, table, other apps, ..."),
      off: z.array(z.string()).optional().describe("Kinds of relation to leave out: uses, reads, permits, ..."),
      check: z.boolean().optional().describe("Text: the findings with their fixes below each node. Picture: a ring on every node with a finding"),
      story: z.string().optional().describe("A story by id (system, fix)"),
      step: z.number().int().positive().optional().describe("One step of the story, from 1: the nodes it is about"),
      stories: z.boolean().optional().describe("Every story as one document"),
      form: z.enum(VIEW_FORMS).optional().describe("Form of a picture (default 2d)"),
      color: z.enum(["type", "namespace", "app", "level", "findings"]).optional(),
      size: z.enum(["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"]).optional(),
      group: z.enum(["namespace", "app", "kind", "none"]).optional(),
      select: z.string().optional().describe("The selected node of a picture"),
      theme: z.enum(["light", "dark"]).optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      format: z.enum(VIEW_FORMATS).optional().describe("json (default), text, md, csv, link; svg and png need output"),
      rows: z.enum(["nodes", "relations"]).optional().describe("csv: one row per node or per relation"),
      output: z.string().min(1).optional().describe("Write to this file; its extension selects the format when format is omitted")
    }),
    annotations: { idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const asked = ["lens", "inside", "focus", "story", "stories", "find", "select", "hide", "off"].some((name) => values[name] !== undefined && values[name] !== false);
    const format = values.format ?? (values.output ? undefined : "json");
    if ((format === "svg" || format === "png") && !values.output) throw new Error(`a ${format} picture needs output, the file to write`);
    const { content, output, scene, atlas, counts, format: written } = await writeView(input, { ...values, format });
    if (output) return { output, format: written, project: atlas.title, ...(scene ? { title: scene.title, nodes: counts?.nodes ?? scene.entries.length, relations: counts?.relations ?? scene.edges.length } : {}) };
    // What there is to see, and not every node of the project at once.
    if (!asked && written === "json") return viewOverview(atlas);
    return written === "json" ? JSON.parse(content) : content;
  }));

  server.registerTool("bc_atlas_layers", {
    description: "Write the documentation of a repository, in sync with the source, for one app or many: README.md (how it works, where to start), architecture.md (how the apps and namespaces are connected), findings.md, and one page per app, namespace, and object, each with a picture. Returns where the pages are and whether they were in sync. With check, nothing is written.",
    inputSchema: z.object({
      path: projectFields.path,
      projectRoot: projectFields.projectRoot,
      config: projectFields.config,
      output: z.string().min(1).optional().describe("Folder of the pages (default: layers.outputDir in .bca.json, else docs/layers)"),
      check: z.boolean().optional().describe("Write nothing; report whether the pages are in sync with the source"),
      pictures: z.enum(["auto", "all", "none"]).optional().describe("Pictures of single objects: auto (up to 400 objects), all, or none"),
      profile: z.string().min(1).optional().describe("A documentation profile of layers.profiles in .bca.json: which pages and sections are written, for which part of the system, in which language, under which file names, from which templates. Without it, the settings of layers itself")
    }),
    annotations: { readOnlyHint: false, idempotentHint: true }
  }, tool(async ({ path: input, ...values }) => {
    const { syncLayers } = await import("./commands/layers.js");
    const { output, check, inSync, current, profile } = await syncLayers(input, values);
    return {
      output,
      ...(profile ? { profile } : {}),
      start: current.fixed.readme ? `${output}/${current.fixed.readme}` : undefined,
      check,
      inSync,
      counts: current.manifest.counts,
      files: current.files,
      written: current.written.length,
      removed: current.removed.length
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
