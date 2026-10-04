import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { FORMATS } from "./capabilities.js";
import { renderD2 } from "./d2.js";
import { renderSvg } from "./svg.js";

function runD2Executable(source, output, options) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (options.layout) args.push("--layout", options.layout);
    if (options.theme !== undefined) args.push("--theme", String(options.theme));
    args.push(source, output);
    const child = spawn("d2", args, { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      reject(error.code === "ENOENT"
        ? new Error("PNG and PDF output need the d2 executable on PATH; use svg or install D2 from https://d2lang.com")
        : error);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`d2 exited with code ${code}`));
    });
  });
}

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
  const { model, options, renderOptions } = architecture;
  if (target.format === "json") {
    const json = `${JSON.stringify(model, null, 2)}\n`;
    if (!target.finalOutput) {
      process.stdout.write(json);
      return { files: [] };
    }
    await writeFile(target.finalOutput, json);
    return { files: [target.finalOutput] };
  }

  const source = renderD2(model, renderOptions);
  await writeFile(target.d2Output, source);
  if (target.format === "d2") return { files: [target.d2Output] };
  if (target.format === "svg") {
    await writeFile(target.finalOutput, await renderSvg(source, options));
  } else {
    await fs.mkdir(path.dirname(target.finalOutput), { recursive: true });
    await runD2Executable(target.d2Output, target.finalOutput, options);
  }
  return { files: [target.finalOutput, target.d2Output] };
}
