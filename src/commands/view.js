// `bca view`: the view of the app without a window. Any lens, story, or
// object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG.
import fs from "node:fs/promises";
import path from "node:path";
import { renderView, VIEW_FORMATS } from "../app/view.js";
import { Workspace } from "../app/workspace.js";
import { UsageError } from "../cli/errors.js";
import { displayPath } from "../output.js";

const EXTENSIONS = { ".json": "json", ".md": "md", ".markdown": "md", ".csv": "csv", ".svg": "svg", ".png": "png", ".txt": "text" };

/**
 * Writes what the view shows for these options.
 * @returns { content, format, output?, state, scene?, atlas }
 */
export async function writeView(input, values = {}) {
  const format = values.format ?? (values.output ? EXTENSIONS[path.extname(values.output).toLowerCase()] : undefined) ?? "text";
  if (!VIEW_FORMATS.includes(format)) throw new UsageError(`--format must be one of: ${VIEW_FORMATS.join(", ")}`);
  if (format === "png" && !values.output) throw new UsageError("a PNG needs --output");
  const workspace = new Workspace(input, values, { live: false });
  const result = await renderView(workspace, { ...values, format });
  let output;
  if (values.output) {
    output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, result.content);
  }
  return { ...result, output };
}

export async function viewCommand(input, values) {
  const { content, output, scene, atlas } = await writeView(input, values);
  if (!output) {
    process.stdout.write(content);
    return;
  }
  const what = scene ? `${scene.title}: ${scene.entries.length.toLocaleString("en-US")} node(s), ${scene.edges.length.toLocaleString("en-US")} relation(s)` : atlas.title;
  console.error(`${what}\nWrote ${displayPath(output)}`);
}
