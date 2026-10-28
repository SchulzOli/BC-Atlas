import { spawn } from "node:child_process";
import { Workspace } from "../app/workspace.js";
import { startAppServer } from "../app/server.js";
import { displayPath } from "../output.js";

const DEFAULT_PORT = 4317;

function openBrowser(url) {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}

async function listen(workspace, { port, log }) {
  // Try the requested port, then the next few, then any free one.
  const candidates = port === undefined
    ? [...Array.from({ length: 10 }, (_, index) => DEFAULT_PORT + index), 0]
    : [port];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await startAppServer(workspace, { port: candidate, log });
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function appCommand(input, values) {
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("--port must be a number from 0 to 65535");
  const workspace = new Workspace(input, values);
  const log = (message) => console.error(message);
  console.log(`Analyzing ${displayPath(workspace.input)}…`);
  // Analyze before listening, so the first page opens on finished data and
  // configuration errors stop the command.
  const overview = await workspace.overview();
  const app = await listen(workspace, { port, log });
  console.log(`${overview.title}: ${overview.summary.objects} object(s) in ${overview.summary.apps.length} app(s).`);
  console.log(`BC Atlas is running at ${app.url}`);
  console.log("It re-analyzes when AL files change. Press Ctrl+C to stop.");
  if (!values.noOpen) openBrowser(app.url);
  await new Promise((resolve) => {
    const stop = () => app.close().then(resolve);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
