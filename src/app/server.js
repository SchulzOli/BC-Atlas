// The BC Atlas app server: serves the browser UI and a small JSON API on the
// loopback interface, re-analyzes when AL files change, and tells open pages
// to refresh.
import { randomBytes } from "node:crypto";
import { watch as fsWatch } from "node:fs";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { renderAppHtml } from "./page.js";

const JSON_TYPE = "application/json; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";
const WATCHED = /\.al$|(^|[\\/])(app\.json|\.bca\.json|\.bca-architecture-baseline\.json)$/iu;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(request, response, status, body, type) {
  const headers = {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
  let payload = Buffer.from(body);
  if (payload.length > 32 * 1024 && /\bgzip\b/u.test(request.headers["accept-encoding"] ?? "")) {
    payload = gzipSync(payload);
    headers["content-encoding"] = "gzip";
  }
  headers["content-length"] = payload.length;
  response.writeHead(status, headers);
  response.end(payload);
}

const sendJson = (request, response, value, status = 200) => send(request, response, status, JSON.stringify(value), JSON_TYPE);

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body must be JSON");
  }
}

const flag = (value) => value === "1" || value === "true";

// A route result sent as is (HTML) rather than as JSON.
class Page {
  constructor(body) {
    this.body = body;
  }
}

function architectureSettings(source) {
  const read = (name) => (source instanceof URLSearchParams ? source.get(name) : source?.[name]) ?? undefined;
  const number = (name) => {
    const value = read(name);
    if (value === undefined || value === null || value === "") return undefined;
    if (!/^\d+$/u.test(String(value))) throw new HttpError(400, `${name} must be a positive integer`);
    return Number(value);
  };
  const groupBy = read("groupBy") || "auto";
  if (!["auto", "namespace", "folder", "module", "app"].includes(groupBy)) throw new HttpError(400, "unsupported groupBy");
  return { propose: flag(String(read("propose") ?? "")), groupBy, depth: number("depth"), minObjects: number("minObjects") };
}

/**
 * Starts the app for one workspace. Resolves with the server, its URL, and a
 * close function once it listens.
 */
export async function startAppServer(workspace, { port = 0, host = "127.0.0.1", watch = true, log = () => {} } = {}) {
  // Write requests need this token, so other websites cannot change files
  // through the browser; the Host check stops DNS rebinding.
  const token = randomBytes(16).toString("hex");
  const clients = new Set();
  let address;

  const allowedHost = (value) => {
    if (!value) return false;
    const hostname = value.replace(/:\d+$/u, "").replace(/^\[|\]$/gu, "");
    return ["127.0.0.1", "localhost", "::1", host].includes(hostname);
  };

  const routes = {
    "GET /": async () => new Page(renderAppHtml({ mode: "live", token })),
    "GET /api/overview": () => workspace.overview(),
    "GET /api/health": () => workspace.healthReport(),
    "GET /api/architecture": (url) => workspace.architecture(architectureSettings(url.searchParams)),
    "GET /api/objects": () => workspace.objects(),
    "GET /api/object": async (url) => {
      const object = await workspace.object(url.searchParams.get("id") ?? "");
      if (!object) throw new HttpError(404, "object not found");
      return object;
    },
    "GET /api/views": () => workspace.views(),
    "GET /api/diagram": (url) => workspace.diagram(Object.fromEntries(url.searchParams)),
    "GET /api/docs": async () => {
      const docs = await workspace.docs();
      return docs ? { path: docs.path, scenarios: docs.scenarios } : { scenarios: 0 };
    },
    "GET /explorer": async (url) => {
      const history = url.searchParams.get("history") || undefined;
      if (history && !["commits", "prs", "releases", "1"].includes(history)) throw new HttpError(400, "history must be commits, prs, or releases");
      const last = url.searchParams.get("last") || undefined;
      if (last && !/^[1-9]\d*$/u.test(last)) throw new HttpError(400, "last must be a positive integer");
      return new Page(await workspace.explorer({
        propose: flag(url.searchParams.get("propose")),
        history: history === "1" ? "commits" : history ?? false,
        last: last ? Number(last) : undefined
      }));
    },
    "GET /docs": async () => {
      const html = await workspace.docsHtml();
      if (!html) throw new HttpError(404, "no UI-test documentation found");
      return new Page(html);
    },
    "POST /api/architecture/adopt": async (_url, body) => workspace.adoptArchitecture(architectureSettings(body), { updateBaseline: body.updateBaseline !== false }),
    "POST /api/architecture/baseline": () => workspace.updateBaseline(),
    "POST /api/refresh": async () => {
      workspace.reset();
      notify();
      return { generation: workspace.generation };
    }
  };

  function notify() {
    const message = `event: changed\ndata: ${JSON.stringify({ generation: workspace.generation, updatedAt: workspace.updatedAt })}\n\n`;
    for (const client of clients) client.write(message);
  }

  async function handle(request, response) {
    if (!allowedHost(request.headers.host)) throw new HttpError(403, "unexpected Host header");
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      response.write(`event: hello\ndata: ${JSON.stringify({ generation: workspace.generation })}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) throw new HttpError(request.method === "GET" || request.method === "POST" ? 404 : 405, "not found");
    let body;
    if (request.method === "POST") {
      if (request.headers["x-bca-token"] !== token) throw new HttpError(403, "missing or wrong app token");
      body = await readBody(request);
    }
    const result = await route(url, body);
    if (result instanceof Page) return send(request, response, 200, result.body, HTML_TYPE);
    sendJson(request, response, result ?? null);
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = error instanceof HttpError ? error.status : 400;
      if (!(error instanceof HttpError)) log(`bca app: ${error.message}`);
      if (!response.headersSent) sendJson(request, response, { error: error.message }, status);
      else response.end();
    });
  });

  let watcher;
  let timer;
  if (watch) {
    const root = await workspace.projectRoot().catch(() => workspace.input);
    try {
      watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
        if (filename && !WATCHED.test(filename)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          workspace.reset();
          log(`Source changed; re-analyzing ${root}`);
          notify();
        }, 300);
      });
      watcher.on("error", (error) => log(`bca app: watcher error: ${error.message}`));
    } catch (error) {
      log(`bca app: cannot watch ${root} (${error.message}); use Refresh in the app`);
    }
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  address = server.address();
  const shownHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    server,
    token,
    url: `http://${shownHost}:${address.port}/`,
    close: () => new Promise((resolve) => {
      watcher?.close();
      clearTimeout(timer);
      for (const client of clients) client.end();
      server.close(() => resolve());
    })
  };
}
