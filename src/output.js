import fs from "node:fs/promises";
import path from "node:path";
import { FORMATS } from "./capabilities.js";
import { sceneToD2 } from "./d2.js";
import { MAX_DIAGRAM_NODES, prepareScene, renderScene } from "./diagram/index.js";

/**
 * Resolves the final output path and format. When --format conflicts with the
 * requested extension the format wins and the extension is replaced.
 */
export function resolveOutput({ output, format, fallbackFormat = "d2", toStdout = false }) {
  const requested = output ? path.resolve(output) : undefined;
  const inferred = requested ? path.extname(requested).slice(1).toLowerCase() : "";
  const resolvedFormat = (format ?? (inferred || fallbackFormat)).toLowerCase();
  if (!FORMATS.includes(resolvedFormat)) {
    throw new Error(`unsupported format: ${resolvedFormat} (use ${FORMATS.join(", ")})`);
  }

  let finalOutput = requested ?? (toStdout ? undefined : path.resolve(`bc-atlas.${resolvedFormat}`));
  if (finalOutput && inferred !== resolvedFormat) {
    finalOutput = inferred && FORMATS.includes(inferred)
      ? `${finalOutput.slice(0, -path.extname(finalOutput).length)}.${resolvedFormat}`
      : `${finalOutput}.${resolvedFormat}`;
  }
  const d2Output = finalOutput && resolvedFormat !== "json"
    ? finalOutput.replace(/\.[^.\\/]+$/u, ".d2")
    : undefined;
  return { format: resolvedFormat, finalOutput, d2Output };
}

/** Shows a path relative to the working directory when it is inside it. */
export function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (!relative) return ".";
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative.replaceAll("\\", "/");
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/** Writes an architecture model in the requested format; returns the files written. */
export async function writeArchitecture(architecture, target) {
  const { model, renderOptions } = architecture;
  if (target.format === "json") {
    const json = `${JSON.stringify(model, null, 2)}\n`;
    if (!target.finalOutput) {
      process.stdout.write(json);
      return { files: [] };
    }
    await writeFile(target.finalOutput, json);
    return { files: [target.finalOutput] };
  }

  // Files show every object; a view too large for that shows its groups as
  // boxes. The D2 source, with every object, comes along for D2 tooling.
  const prepared = prepareScene(model, renderOptions, { expand: model.objects.length > MAX_DIAGRAM_NODES ? "none" : "all" });
  await writeFile(target.d2Output, sceneToD2(prepared.full));
  if (target.format === "d2") return { files: [target.d2Output] };
  const scene = prepared.collapsed
    ? { ...prepared.scene, title: `${prepared.scene.title} (overview: ${model.objects.length} objects in ${prepared.groups.length} groups)` }
    : prepared.scene;
  await writeFile(target.finalOutput, await renderScene(scene, target.format));
  return { files: [target.finalOutput, target.d2Output], overview: prepared.collapsed };
}
