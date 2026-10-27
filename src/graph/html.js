import { readFileSync } from "node:fs";
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

// JSON inside <script> must not close the element or open a comment.
function embed(value) {
  return JSON.stringify(value)
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
    .replace("__DATA__", () => embed(document))
    .replace("/*__LIBRARY__*/", () => forceGraphLibrary())
    .replace("/*__APP__*/", () => read("viewer.js"));
}
