// The BC Atlas engine as a child process for editors: analyzes one project
// and answers requests over the Node IPC channel, so the editor stays
// responsive while large apps are analyzed.
//
//   fork("src/app/worker.js", [projectPath, JSON.stringify(options)])
//   -> { id, method, params }   <- { id, result } or { id, error }
import { createService } from "./service.js";
import { Workspace } from "./workspace.js";

const [input = ".", options = "{}"] = process.argv.slice(2);
// The AL compiler runs in the background; new results start a new generation
// and tell the editor to refresh, like a changed file does.
const workspace = new Workspace(input, JSON.parse(options), {
  onAlUpdate: () => {
    workspace.reset();
    process.send?.({ event: "changed", reason: "al-compiler" });
  }
});
const service = createService(workspace);

process.on("message", async (message) => {
  if (!message || typeof message !== "object" || message.id === undefined) return;
  const { id, method, params } = message;
  try {
    const result = await service.call(method, params);
    process.send({ id, result: result ?? null });
  } catch (error) {
    process.send({ id, error: error?.message ?? String(error) });
  }
});
process.on("disconnect", () => process.exit(0));
process.send({ ready: true, methods: service.methods });
