import fs from "node:fs/promises";
import path from "node:path";
import { FORMATS } from "./capabilities.js";
import { buildScene, sceneToD2 } from "./d2.js";
import { MAX_DIAGRAM_NODES, renderScene } from "./diagram/index.js";

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

  // The D2 source comes along with every drawing, for D2 tooling.
  const scene = buildScene(model, renderOptions);
  await writeFile(target.d2Output, sceneToD2(scene));
  if (target.format === "d2") return { files: [target.d2Output] };
  if (model.objects.length > MAX_DIAGRAM_NODES) {
    throw new Error(`${model.objects.length} nodes are too many to draw (at most ${MAX_DIAGRAM_NODES}); wrote ${target.d2Output}. Filter with --namespace or --paths, or choose a focused view`);
  }
  await writeFile(target.finalOutput, await renderScene(scene, target.format));
  return { files: [target.finalOutput, target.d2Output] };
}
