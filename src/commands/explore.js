import fs from "node:fs/promises";
import path from "node:path";
import { createGraphDocument } from "../graph/document.js";
import { renderExplorerHtml } from "../graph/html.js";
import { displayPath } from "../output.js";

export const EXPLORE_FORMATS = Object.freeze(["html", "json"]);

/** Resolves the output path; --format wins over the extension. */
function exploreTarget(output = "bc-atlas-explorer.html", format) {
  const requested = path.resolve(output);
  const inferred = path.extname(requested).slice(1).toLowerCase();
  const resolved = (format ?? (EXPLORE_FORMATS.includes(inferred) ? inferred : "html")).toLowerCase();
  if (!EXPLORE_FORMATS.includes(resolved)) {
    throw new Error(`unsupported format: ${resolved} (use ${EXPLORE_FORMATS.join(", ")})`);
  }
  const file = inferred === resolved
    ? requested
    : `${EXPLORE_FORMATS.includes(inferred) ? requested.slice(0, -inferred.length - 1) : requested}.${resolved}`;
  return { file, format: resolved };
}

/** Writes the interactive explorer (HTML) or the temporal graph document (JSON). */
export async function writeExplorer(input, values = {}) {
  const target = exploreTarget(values.output, values.format);
  const document = await createGraphDocument(input, values);
  const content = target.format === "json"
    ? `${JSON.stringify(document, null, 2)}\n`
    : renderExplorerHtml(document);
  await fs.mkdir(path.dirname(target.file), { recursive: true });
  await fs.writeFile(target.file, content);
  return { document, file: target.file, format: target.format };
}

export async function exploreCommand(input, values) {
  const { document, file } = await writeExplorer(input, values);
  const objects = document.levels.object;
  const crossApp = objects.edges.filter(({ scope }) => scope === "inter-app").length;
  const undeclared = document.levels.app.edges.filter(({ dependency }) => dependency === "undeclared").length;
  const frames = document.timeline.frames.length;
  console.log(
    `${document.lens.title}: ${objects.nodes.length} object(s), ${objects.edges.length} dependency edge(s), ` +
    `${crossApp} across apps, ${document.levels.app.nodes.length} app(s)` +
    `${undeclared ? `, ${undeclared} undeclared app dependency(ies)` : ""}` +
    `${frames > 1 ? `; ${frames} frame(s) from ${document.timeline.commits} commit(s)` : ""}.`
  );
  console.log(`Wrote ${displayPath(file)}`);
}
