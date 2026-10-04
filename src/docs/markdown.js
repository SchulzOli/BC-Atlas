import fs from "node:fs/promises";
import path from "node:path";
import { generatedDocumentationPath } from "./al-ui-source.js";
import { renderGuide, renderTestCase } from "./render/markdown.js";
import { buildTask } from "./task.js";

/**
 * Renders one scenario as Markdown.
 * @param options { catalog, language, captions, mode: "guide" | "testcase" }
 */
export function renderDocumentation(source, options = {}) {
  const task = buildTask(source, options);
  return options.mode === "testcase" ? renderTestCase(task) : renderGuide(task);
}

export async function writeDocumentation(source, outputDirectory, options = {}) {
  const filename = generatedDocumentationPath(
    source.value,
    outputDirectory ?? process.env.BC_DOCS_OUTPUT ?? "docs/generated"
  );
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, renderDocumentation(source, options));
  return filename;
}

/** Writes Markdown guides, use-case pages, and the index for a whole corpus. */
export async function writeCorpusDocumentation(corpus, outputDirectory, options = {}) {
  const { exportDocumentation } = await import("./export.js");
  const result = await exportDocumentation(corpus, { ...options, outputDirectory, formats: ["markdown"] });
  return result.files;
}
