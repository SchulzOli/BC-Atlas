import fs from "node:fs/promises";
import path from "node:path";
import { createGraphDocument } from "../graph/document.js";
import { renderExplorerHtml } from "../graph/html.js";

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
export async function writeExplorer(input, values = {}, { onFrame } = {}) {
  const target = exploreTarget(values.output, values.format);
  const document = await createGraphDocument(input, values, { onFrame });
  const content = target.format === "json"
    ? `${JSON.stringify(document, null, 2)}\n`
    : renderExplorerHtml(document);
  await fs.mkdir(path.dirname(target.file), { recursive: true });
  await fs.writeFile(target.file, content);
  return { document, file: target.file, format: target.format };
}
