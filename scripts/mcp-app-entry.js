// The BC Atlas view as an MCP App: the same page the VS Code extension shows, in a chat client
// that renders MCP Apps (Claude, ChatGPT, VS Code, ...). The view talks to its host through
// one small interface, { postMessage({ type: "request", id, method, params }) }, answered with
// a "response" message; here the host is the MCP server, reached with the official SDK
// (@modelcontextprotocol/ext-apps): a request becomes a call of the tool bc_atlas_app_call.
//
// The tool that opened the view (bc_atlas_app) says which project it is and what to show.
import { App } from "@modelcontextprotocol/ext-apps";

const CALL_TOOL = "bc_atlas_app_call";
const app = new App({ name: "BC Atlas", version: window.BCA_APP?.version ?? "0" }, {});

// The project and the address to show, known once the tool that opened the view has its arguments or its result.
let started;
const project = new Promise((resolve) => { started = resolve; });
let known = false;
function start(values) {
  if (!values || typeof values !== "object") return;
  if (!known && typeof values.path === "string") {
    known = true;
    started(values.path);
  }
  // Show what the tool asked for, as the extension does when a command opens a view.
  if (typeof values.address === "string" && values.address) window.postMessage({ type: "navigate", hash: values.address }, "*");
}
app.ontoolinput = ({ arguments: values }) => start(values);
app.ontoolresult = (result) => start(result?.structuredContent);

// The view follows the theme of the chat client, as it follows the editor's in VS Code.
function theme(context) {
  if (!context?.theme) return;
  document.body.classList.toggle("vscode-light", context.theme === "light");
  document.body.classList.toggle("vscode-dark", context.theme !== "light");
}
app.onhostcontextchanged = (context) => theme(context);

const text = (result) => (result?.content ?? []).filter(({ type }) => type === "text").map((item) => item.text).join("");
const reply = (id, answer) => window.postMessage({ type: "response", id, ...answer }, "*");

window.BCA_MCP_HOST = {
  postMessage(message) {
    // What the view shows: the model is told, so that it can answer about it.
    if (message?.type === "state") {
      const shown = [message.lens ? `the lens "${message.lens}"` : "", message.story ? `the story "${message.story}"` : ""].filter(Boolean).join(" and ");
      if (shown) this.context(`The BC Atlas view shows ${shown}.`);
      return;
    }
    if (message?.type !== "request") return;
    project.then((path) => app.callServerTool({ name: CALL_TOOL, arguments: { path, method: message.method, params: message.params ?? {} } })).then((result) => {
      if (result.isError) return reply(message.id, { error: text(result) || "the request failed" });
      const answer = result.structuredContent && "result" in result.structuredContent ? result.structuredContent.result : JSON.parse(text(result) || "null");
      return reply(message.id, { result: answer });
    }).catch((error) => reply(message.id, { error: error?.message ?? String(error) }));
  },
  // Tells the model what the user is looking at, so it can answer about it.
  context(textForModel) {
    return app.updateModelContext({ content: [{ type: "text", text: textForModel }] }).catch(() => undefined);
  }
};

app.connect().then(() => theme(app.getHostContext())).catch(() => {
  // Not inside a host that speaks MCP Apps: the view says so instead of waiting forever.
  window.postMessage({ type: "host-missing" }, "*");
});
