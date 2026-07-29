import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function stringArray(value, name, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  if (required && value.length === 0) throw new Error(`${name} must not be empty`);
  return value.map((item) => item.trim());
}

export function validateScenario(value, source = "scenario") {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${source} must contain a YAML object`);
  }
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw new Error(`${source}.id must use lowercase kebab-case`);
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    throw new Error(`${source}.title must be a non-empty string`);
  }
  if (typeof value.goal !== "string" || !value.goal.trim()) {
    throw new Error(`${source}.goal must be a non-empty string`);
  }

  const start = value.start ?? {};
  if (!start || Array.isArray(start) || typeof start !== "object") {
    throw new Error(`${source}.start must be an object`);
  }
  if (start.url !== undefined && (typeof start.url !== "string" || !start.url.trim())) {
    throw new Error(`${source}.start.url must be a non-empty string`);
  }

  return {
    ...value,
    id: value.id,
    title: value.title.trim(),
    goal: value.goal.trim(),
    description: typeof value.description === "string" ? value.description.trim() : "",
    start,
    prerequisites: stringArray(value.prerequisites, `${source}.prerequisites`),
    expected: stringArray(value.expected, `${source}.expected`, true),
    constraints: stringArray(value.constraints, `${source}.constraints`)
  };
}

export async function loadScenario(filename) {
  const absolutePath = path.resolve(filename);
  let value;
  try {
    value = YAML.parse(await fs.readFile(absolutePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`scenario not found: ${absolutePath}`);
    throw new Error(`cannot read scenario ${absolutePath}: ${error.message}`);
  }
  return {
    path: absolutePath,
    relativePath: path.relative(process.cwd(), absolutePath).replaceAll("\\", "/"),
    value: validateScenario(value, path.basename(absolutePath))
  };
}

export function generatedTestPath(scenario, testDirectory = "docs-tests/generated") {
  return path.resolve(testDirectory, `${scenario.id}.spec.js`);
}

