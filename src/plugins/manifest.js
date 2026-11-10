// The plugin manifest (plugin.json): what a plugin contributes, readable without running its code.
// BC Atlas builds help, the CLI catalog, generated docs, MCP tool lists, task validation and the
// order of tasks from manifests; plugin code runs only when one of its contributions is used.
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod/v4";

export const PLUGIN_API_VERSION = 1;

/** Hook events BC Atlas emits to plugins. */
export const PLUGIN_EVENTS = Object.freeze({
  "run:before": "Before bca run executes the tasks of a trigger ({ trigger, tasks })",
  "task:after": "After each task of bca run ({ task, ok, summary })",
  "run:after": "After bca run, before the sync mode is applied ({ trigger, results, outputs })",
  "check:after": "After the architecture health check, before plugin rules ({ report })"
});

const ID = /^[a-z][a-z0-9-]*$/u;
const id = z.string().regex(ID, "lowercase letters, digits and hyphens, starting with a letter");

const option = z.object({
  type: z.enum(["string", "boolean"]).default("string"),
  description: z.string().min(1),
  enum: z.array(z.string()).optional(),
  default: z.union([z.string(), z.boolean()]).optional(),
  repeatable: z.boolean().optional(),
  value: z.string().optional()
});

const command = z.object({
  name: id,
  purpose: z.string().min(1),
  argv: z.string().optional(), // positional token, default "[app-root]"
  options: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/u, "camelCase option name"), option).default({}),
  output: z.string().optional(), // result schema name for --format json
  rules: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([])
});

const task = z.object({
  id,
  summary: z.string().min(1),
  before: z.array(z.string()).default([]), // run before these tasks (e.g. "docs")
  after: z.array(z.string()).default([])
});

const healthRule = z.object({
  id,
  severity: z.enum(["error", "warning", "info"]),
  summary: z.string().min(1)
});

const mcpTool = z.object({
  name: z.string().regex(/^bc_atlas_[a-z0-9_]+$/u, "MCP tool names start with bc_atlas_"),
  description: z.string().min(1),
  input: z.record(z.string(), z.object({
    type: z.enum(["string", "boolean", "number"]),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    optional: z.boolean().optional()
  })).default({}),
  readOnly: z.boolean().default(true)
});

const extensionPoint = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u, "<plugin>.<point>"),
  summary: z.string().min(1)
});

export const manifestSchema = z.object({
  id,
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  apiVersion: z.number().int(),
  main: z.string().default("src/index.js"),
  area: z.enum(["start", "analyze", "export", "integrate"]).default("integrate"),
  configKey: z.string().regex(/^[a-z][A-Za-z0-9]*$/u).optional(),
  homepage: z.string().optional(),
  contributes: z.object({
    commands: z.array(command).default([]),
    tasks: z.array(task).default([]),
    healthRules: z.array(healthRule).default([]),
    mcpTools: z.array(mcpTool).default([]),
    hooks: z.array(z.enum(Object.keys(PLUGIN_EVENTS))).default([]),
    extensionPoints: z.array(extensionPoint).default([]),
    // Contributions to extension points of other plugins: { "<plugin>.<point>": ["<item id>", ...] }
    extends: z.record(z.string(), z.array(z.string())).default({})
  }).default({})
});

/** Validates a parsed manifest; errors name the plugin and the offending field. */
export function parseManifest(value, origin = "plugin.json") {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`${origin}: invalid plugin manifest: ${issues}`);
  }
  const manifest = result.data;
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`${origin}: plugin "${manifest.id}" targets plugin API ${manifest.apiVersion}; this BC Atlas supports ${PLUGIN_API_VERSION}`);
  }
  for (const point of manifest.contributes.extensionPoints) {
    if (!point.id.startsWith(`${manifest.id}.`)) throw new Error(`${origin}: extension point "${point.id}" must start with "${manifest.id}."`);
  }
  return { ...manifest, configKey: manifest.configKey ?? manifest.id };
}

export async function readManifest(dir) {
  const file = path.join(dir, "plugin.json");
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${dir}: no plugin.json`);
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
  return parseManifest(parsed, file);
}
