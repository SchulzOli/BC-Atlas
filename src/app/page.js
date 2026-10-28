// Assembles the BC Atlas pages: the shared theme, the styles and script, and
// either the VS Code bridge settings or an embedded snapshot.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const read = (name) => readFileSync(new URL(`./ui/${name}`, import.meta.url), "utf8");
const theme = () => readFileSync(new URL("../ui/theme.css", import.meta.url), "utf8");

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
 *   page's requests) or "static" (one offline file)
 * @param snapshot for static pages: the data every page reads, plus the
 *   explorer and documentation pages as HTML strings
 * @param csp a Content-Security-Policy for the page (the extension's webview)
 */
export function renderAppHtml({ mode, snapshot, title = "BC Atlas", csp }) {
  let boot;
  if (mode === "static") {
    const { explorerHtml, docsHtml, ...data } = snapshot;
    boot = [
      `window.BCA_APP = ${embed({ mode, version: pkg.version })};`,
      `window.BCA_SNAPSHOT_GZIP = "${packed(JSON.stringify(data))}";`,
      explorerHtml ? `window.BCA_EXPLORER_GZIP = "${packed(explorerHtml)}";` : "",
      docsHtml ? `window.BCA_DOCS_GZIP = "${packed(docsHtml)}";` : ""
    ].join("\n");
  } else if (mode === "vscode") {
    boot = `window.BCA_APP = ${embed({ mode, version: pkg.version })};`;
  } else {
    throw new Error(`unknown page mode "${mode}"`);
  }
  // Function replacements keep "$" sequences literal.
  return read("index.html")
    .replace('<meta charset="utf-8">', () => `<meta charset="utf-8">${csp ? `\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">` : ""}`)
    .replace("__TITLE__", () => escapeHtml(title))
    .replace("__GENERATOR__", () => `BC Atlas ${pkg.version}`)
    .replace("/*__STYLE__*/", () => `${theme()}\n${read("app.css")}`)
    .replace("__BOOT__", () => boot)
    .replace("/*__APP__*/", () => read("app.js"));
}
