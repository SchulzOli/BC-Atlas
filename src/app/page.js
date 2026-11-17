// Assembles the one view of BC Atlas: the shared theme, its styles and
// script, and either the VS Code bridge settings or an embedded snapshot.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const read = (name) => readFileSync(new URL(`./ui/${name}`, import.meta.url), "utf8");
const theme = () => readFileSync(new URL("../ui/theme.css", import.meta.url), "utf8");
// The canvas of the builder: React Flow, built into vendor/ by scripts/build-flow-vendor.js.
const vendor = (name) => readFileSync(new URL(`../../vendor/${name}`, import.meta.url), "utf8");

const escapeHtml = (value) => String(value).replace(/[&<>"]/gu, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

// JSON inside <script> must not close the element or open a comment.
const embed = (value) => JSON.stringify(value)
  .replaceAll("<", "\\u003c")
  .replaceAll(">", "\\u003e")
  .replaceAll(" ", "\\u2028")
  .replaceAll(" ", "\\u2029");

const packed = (text) => gzipSync(text, { level: 9 }).toString("base64");

/**
 * @param mode "vscode" (a webview of the VS Code extension, which answers the
 *   page's requests), "mcp" (an MCP App in a chat client; the MCP server
 *   answers them), or "static" (one offline file)
 * @param snapshot for a static page: the atlas and the inside of its objects
 *   (snapshot.js)
 * @param csp a Content-Security-Policy for the page (the extension's webview)
 */
export function renderAppHtml({ mode, snapshot, title = "BC Atlas", csp }) {
  let boot;
  if (mode === "static") {
    boot = [
      `window.BCA_APP = ${embed({ mode, version: pkg.version })};`,
      `window.BCA_SNAPSHOT_GZIP = "${packed(JSON.stringify(snapshot))}";`
    ].join("\n");
  } else if (mode === "vscode" || mode === "mcp") {
    boot = `window.BCA_APP = ${embed({ mode, version: pkg.version })};`;
  } else {
    throw new Error(`unknown page mode "${mode}"`);
  }
  // Function replacements keep "$" sequences literal.
  return read("index.html")
    .replace('<meta charset="utf-8">', () => `<meta charset="utf-8">${csp ? `\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">` : ""}`)
    // In VS Code the page takes its colors and font from the editor's theme (src/ui/theme.css).
    .replace('<html lang="en">', () => (mode === "vscode" ? '<html lang="en" data-host="vscode">' : mode === "mcp" ? '<html lang="en" data-host="mcp">' : '<html lang="en">'))
    .replace("__TITLE__", () => escapeHtml(title))
    .replace("__GENERATOR__", () => `BC Atlas ${pkg.version}`)
    .replace("/*__STYLE__*/", () => `${vendor("flow-canvas.css")}\n${theme()}\n${read("atlas.css")}`)
    .replace("__BOOT__", () => boot)
    // The graph and the scene register themselves before the view starts.
    // As an MCP App, the host is the MCP server: its adapter (scripts/mcp-app-entry.js) comes first.
    .replace("/*__APP__*/", () => `${mode === "mcp" ? `${vendor("mcp-app.js").replaceAll("</script", "<\\/script")}\n` : ""}${vendor("flow-canvas.js").replaceAll("</script", "<\\/script")}\n${read("graph.js")}\n${read("scene.js")}\n${read("atlas.js")}`);
}
