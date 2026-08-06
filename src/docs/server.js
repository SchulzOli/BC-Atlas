import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const WEB_COMMANDS = ["list", "show", "validate", "generate", "set", "unset", "glossary", "automation"];

async function executeCommand(root, body, defaults = {}) {
  if (!WEB_COMMANDS.includes(body.command)) throw new Error(`unsupported command: ${body.command}`);
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
    const files = await writeCorpusDocumentation(corpus, body.outputDirectory);
    return { files };
  }

  if (!body.id) throw new Error("document ID is required");
  const scenario = corpus.byId.get(body.id);
  if (!scenario) throw new Error(`document ID "${body.id}" was not found`);
  if (body.command === "show") return scenarioDetails(scenario, corpus);
  if (!body.tag) throw new Error("tag is required");

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

async function apiResponse(request, response, pathname, root, defaults) {
  if (request.method === "GET" && pathname === "/api/commands") {
    return sendJson(response, 200, WEB_COMMANDS);
  }
  if (request.method === "POST" && pathname === "/api/commands") {
    return sendJson(response, 200, await executeCommand(root, await requestJson(request), defaults));
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
  const inputPath = path.relative(process.cwd(), resolvedRoot).replaceAll("\\", "/") || ".";
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        await apiResponse(request, response, url.pathname, resolvedRoot, { inputPath });
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
  return { server, url: `http://127.0.0.1:${port}` };
}