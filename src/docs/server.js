import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createArchitectureModel } from "../architecture.js";
import { renderD2 } from "../d2.js";
import { renderSvg } from "../svg.js";
import { createAutomationPlan } from "./automation.js";
import { planMetadataEdit, writeMetadataEdit } from "./al-ui-writer.js";
import { renderDocumentation, writeCorpusDocumentation } from "./markdown.js";
import { loadCorpus, scenarioSummary } from "./model.js";
import { documentationGlossary } from "./tags.js";

const WEB_ROOT = fileURLToPath(new URL("./web/", import.meta.url));
const WEB_ASSETS = new Map([
  ["/assets/dompurify.js", fileURLToPath(import.meta.resolve("dompurify"))],
  ["/assets/marked.js", fileURLToPath(import.meta.resolve("marked"))]
]);
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalPath(filename) {
  let current = path.resolve(filename);
  const missing = [];
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(filename);
    missing.push(path.basename(current));
    current = parent;
  }
}

async function requestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

function scenarioDetails(scenario, corpus) {
  return {
    ...scenarioSummary(scenario),
    fileHash: scenario.fileHash,
    features: scenario.value.features,
    prerequisites: scenario.value.typedPrerequisites,
    permissions: scenario.value.permissions,
    links: scenario.value.links,
    metadata: scenario.value.metadata,
    steps: scenario.value.guideSteps,
    markdown: renderDocumentation(scenario, { catalog: corpus.byId }),
    diagnostics: corpus.diagnostics.filter(({ documentId }) => documentId === scenario.value.id)
  };
}

const DOC_COMMANDS = ["list", "show", "validate", "generate", "set", "unset", "glossary", "automation"];

async function executeCommand(root, body, defaults = {}, appRoot, exportRoot = root) {
  const commands = appRoot ? [...DOC_COMMANDS, "graph"] : DOC_COMMANDS;
  if (!commands.includes(body.command)) throw new Error(`unsupported command: ${body.command}`);
  if (body.command === "graph") {
    const architecture = await createArchitectureModel(appRoot, {
      view: body.view,
      object: body.object,
      scope: body.scope,
      focus: body.focus,
      objectInboundDepth: body.objectInboundDepth,
      objectOutboundDepth: body.objectOutboundDepth,
      members: body.members,
      entry: body.entry,
      direction: body.direction,
      details: body.details,
      groupBy: body.groupBy,
      moduleDepth: body.moduleDepth,
      folderDepth: body.folderDepth,
      rootProcedure: body.rootProcedure,
      callDepth: body.callDepth,
      callDirection: body.callDirection,
      expandProcedures: body.expandProcedures,
      expandFrameworkCalls: body.expandFrameworkCalls,
      sourceUrl: body.sourceUrl,
      sourceRef: body.sourceRef,
      sourcePathPrefix: body.sourcePathPrefix,
      noLegend: body.noLegend,
      workflowDepth: body.workflowDepth,
      workflowMaxNodes: body.workflowMaxNodes,
      workflowEdgeTypes: body.workflowEdgeTypes,
      maxEdges: body.maxEdges
    });
    const source = renderD2(architecture.model, architecture.renderOptions);
    return {
      view: architecture.view,
      files: architecture.model.files,
      nodes: architecture.model.objects.length,
      edges: architecture.model.edges.length,
      diagnostics: architecture.model.diagnostics,
      svg: await renderSvg(source, architecture.options)
    };
  }
  if (body.command === "glossary") return documentationGlossary();

  const corpus = await loadCorpus(root);
  if (body.command === "list") return corpus.scenarios.map(scenarioSummary);
  if (body.command === "validate") return corpus.diagnostics;
  if (body.command === "automation") {
    return createAutomationPlan(corpus, {
      provider: body.provider,
      inputPath: body.inputPath ?? defaults.inputPath,
      outputDirectory: body.outputDirectory
    });
  }
  if (body.command === "generate") {
    const outputDirectory = path.resolve(exportRoot, body.outputDirectory ?? "docs/generated");
    const [canonicalRoot, canonicalOutput] = await Promise.all([
      canonicalPath(exportRoot),
      canonicalPath(outputDirectory)
    ]);
    if (!isWithin(canonicalRoot, canonicalOutput)) {
      throw new Error(`output directory must be within ${exportRoot}`);
    }
    const files = await writeCorpusDocumentation(corpus, outputDirectory);
    return { files };
  }

  if (!body.id) throw new Error("document ID is required");
  const scenario = corpus.byId.get(body.id);
  if (!scenario) throw new Error(`document ID "${body.id}" was not found`);
  if (body.command === "show") return scenarioDetails(scenario, corpus);
  if (!body.tag) throw new Error("tag is required");
  if (!body.expectedFileHash) throw new Error("expectedFileHash is required for AL mutations");

  const plan = await planMetadataEdit(root, body.id, {
    tag: body.tag,
    value: body.value,
    qualifier: body.qualifier,
    expectedFileHash: body.expectedFileHash,
    remove: body.command === "unset"
  });
  if (!body.dryRun) await writeMetadataEdit(plan);
  return {
    changed: plan.changed,
    written: plan.changed && !body.dryRun,
    file: plan.relativePath,
    procedure: plan.procedure,
    documentId: plan.documentId,
    fileHash: plan.fileHash,
    preview: body.dryRun ? plan.preview : undefined
  };
}

async function apiResponse(request, response, pathname, root, defaults, appRoot, security) {
  if (request.method === "GET" && pathname === "/api/commands") {
    return sendJson(response, 200, appRoot ? [...DOC_COMMANDS, "graph"] : DOC_COMMANDS);
  }
  if (request.method === "POST" && pathname === "/api/commands") {
    if (!security.hosts.has(request.headers.host)) {
      return sendJson(response, 403, { error: "host is not allowed" });
    }
    if (request.headers.origin && !security.origins.has(request.headers.origin)) {
      return sendJson(response, 403, { error: "origin is not allowed" });
    }
    if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return sendJson(response, 415, { error: "content-type must be application/json" });
    }
    if (request.headers["x-bc-atlas-session"] !== security.token) {
      return sendJson(response, 403, { error: "valid session token is required" });
    }
    return sendJson(
      response,
      200,
      await executeCommand(root, await requestJson(request), defaults, appRoot, security.exportRoot)
    );
  }
  return sendJson(response, 404, { error: "API route not found" });
}

async function staticResponse(response, pathname) {
  const asset = WEB_ASSETS.get(pathname);
  if (asset) {
    const content = await fs.readFile(asset);
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    return response.end(content);
  }
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(WEB_ROOT, relative);
  if (!filename.startsWith(`${path.resolve(WEB_ROOT)}${path.sep}`)) {
    return sendJson(response, 404, { error: "not found" });
  }
  try {
    const content = await fs.readFile(filename);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filename)] ?? "application/octet-stream"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "not found" });
    throw error;
  }
}

export async function startDocsServer(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const appRoot = options.appRoot ? path.resolve(options.appRoot) : undefined;
  const exportRoot = path.resolve(options.exportRoot ?? appRoot ?? resolvedRoot);
  const token = randomUUID();
  const inputPath = path.relative(process.cwd(), resolvedRoot).replaceAll("\\", "/") || ".";
  let security;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        await apiResponse(request, response, url.pathname, resolvedRoot, { inputPath }, appRoot, security);
      } else {
        await staticResponse(response, url.pathname);
      }
    } catch (error) {
      sendJson(response, error instanceof SyntaxError ? 400 : 422, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  security = {
    token,
    exportRoot,
    hosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`]),
    origins: new Set([origin, `http://localhost:${port}`])
  };
  return {
    server,
    token,
    url: origin,
    browserUrl: `${origin}/#session=${encodeURIComponent(token)}`
  };
}
