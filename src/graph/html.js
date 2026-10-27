import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import path from "node:path";

const read = (name) => readFileSync(new URL(`./viewer/${name}`, import.meta.url), "utf8");

let library;
/** The 3d-force-graph browser bundle (MIT, includes three.js). */
function forceGraphLibrary() {
  if (!library) {
    const entry = createRequire(import.meta.url).resolve("3d-force-graph");
    library = readFileSync(path.join(path.dirname(entry), "3d-force-graph.min.js"), "utf8");
  }
  return library;
}

// Larger graphs are embedded gzip-compressed (base64) and inflated by the
// browser's DecompressionStream; a Base Application graph shrinks about 10x.
const COMPRESS_ABOVE = 2 * 1024 * 1024;

function dataScript(document) {
  const json = JSON.stringify(document);
  if (json.length < COMPRESS_ABOVE) return `window.BCA_GRAPH = ${embed(json)};`;
  return `window.BCA_GRAPH_GZIP = "${gzipSync(json, { level: 9 }).toString("base64")}";`;
}

// JSON inside <script> must not close the element or open a comment.
function embed(json) {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/gu, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

/** Renders a graph document as one self-contained, offline HTML explorer. */
export function renderExplorerHtml(document) {
  // Function replacements keep "$" sequences in the bundle literal.
  return read("template.html")
    .replace("__TITLE__", () => escapeHtml(document.title))
    .replace("__GENERATOR__", () => escapeHtml(document.generator))
    .replace("/*__STYLE__*/", () => read("viewer.css"))
    .replace("__DATA__", () => dataScript(document))
    .replace("/*__LIBRARY__*/", () => forceGraphLibrary())
    .replace("/*__APP__*/", () => read("viewer.js"));
}
