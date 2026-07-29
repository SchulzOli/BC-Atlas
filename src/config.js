import fs from "node:fs/promises";
import path from "node:path";

export async function loadConfig(input, explicitPath) {
  const inputPath = path.resolve(input);
  const stat = await fs.stat(inputPath);
  const base = stat.isDirectory() ? inputPath : path.dirname(inputPath);
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.join(base, ".ald2tree.json");
  try {
    const text = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(text);
    if (!config || Array.isArray(config) || typeof config !== "object") {
      throw new Error("configuration root must be an object");
    }
    return { path: configPath, values: config };
  } catch (error) {
    if (error.code === "ENOENT" && !explicitPath) return { values: {} };
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
    }
    throw error;
  }
}
