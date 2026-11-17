// `bca architecture compare` and `bca architecture templates`: the architecture as it is and
// as it should be (src/blueprint/compare.js), and the templates that say what is preferred and
// how much each goal weighs (src/blueprint/templates.js, goals.js).
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../cli/errors.js";
import { displayPath } from "../output.js";
import { architectureContext } from "../blueprint/index.js";
import { compareArchitecture, formatCompareMarkdown, formatCompareText } from "../blueprint/compare.js";
import { CRITERIA, DEFAULT_GOALS } from "../blueprint/goals.js";
import { listTemplates, removeTemplate, resolveTemplate, saveTemplate, useTemplate } from "../blueprint/templates.js";

/** The options that say what is preferred, as the template functions take them. */
export function goalValues(values = {}) {
  return Object.fromEntries(["template", "weight", "weights", "size", "groupBy", "depth", "minObjects", "startFrom", "ignore", "granularity", "sharedCore"]
    .filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
}

/** `bca architecture compare`: current and target state, scored with the same goals, and the way from one to the other. */
export async function compareCommand(input, values) {
  const result = await compareArchitecture(input, values);
  const format = values.format ?? "text";
  const content = format === "json" ? `${JSON.stringify(result, null, 2)}\n` : format === "markdown" ? formatCompareMarkdown(result) : formatCompareText(result);
  if (values.output) {
    const output = path.resolve(values.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, content);
    console.error(`Wrote ${displayPath(output)}`);
  } else {
    process.stdout.write(content);
  }
  if (values.saveTemplate) {
    const context = await architectureContext(input, values);
    const saved = await saveTemplate(context.projectRoot, { name: values.saveTemplate, values: goalValues(values), config: values.config });
    console.error(`Saved the template ${saved.name} in ${displayPath(saved.templateFile ?? saved.file)}. Use it: bca architecture templates --use ${saved.name}`);
  }
  if (values.write) {
    const saved = await adoptTarget(input, values, result);
    console.error(`Saved the target architecture (${saved.components} component(s)) to ${displayPath(saved.file)}`);
  }
}

/**
 * Makes the target of a comparison the architecture of the project: what bca check enforces from then on.
 * @returns { file, components, architecture, written }
 */
export async function adoptTarget(input, values, result, { dryRun = false } = {}) {
  const context = await architectureContext(input, values);
  const file = context.config.path ?? path.join(context.projectRoot, ".bca.json");
  const config = await fs.readFile(file, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return {};
    throw error;
  });
  const { architecture } = result.sides.target;
  config.architecture = { ...(config.architecture ?? {}), ...architecture };
  if (!dryRun) await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return { file, components: architecture.components.length, architecture, written: !dryRun };
}

function templatesText(templates) {
  const lines = ["Templates: what a good architecture is for you, and how much each goal weighs.", ""];
  for (const template of templates) {
    lines.push(`${template.active ? "* " : "  "}${template.name.padEnd(18)} ${template.error ? `not valid: ${template.error}` : template.title}  (${template.origin})`);
    if (template.error) continue;
    lines.push(`    ${template.summary}`);
    const weights = Object.entries(template.goals?.weights ?? {}).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]);
    if (weights.length) lines.push(`    weighs: ${weights.map(([id, weight]) => `${id} ${weight}`).join(", ")}`);
    const proposal = Object.entries(template.proposal ?? {}).filter(([, value]) => typeof value !== "object" || Array.isArray(value));
    if (proposal.length) lines.push(`    proposes with: ${proposal.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("+") || "none" : value}`).join(", ")}`);
    lines.push("");
  }
  lines.push("Goals that can be weighed (--weight <goal>=<n>, or goals.weights in a template):", "");
  for (const criterion of CRITERIA) lines.push(`  ${criterion.id.padEnd(18)} ${String(DEFAULT_GOALS.weights[criterion.id] ?? 0).padStart(2)}  ${criterion.meaning}`);
  lines.push("", "* in use. Use one: bca architecture templates --use <name>. Save your settings as one: --save <name>.");
  return `${lines.join("\n")}\n`;
}

/** `bca architecture templates`: lists them, takes one into use, saves the settings as a new one, or removes one. */
export async function templatesCommand(input, values) {
  const context = await architectureContext(input, values);
  const root = context.projectRoot;
  const architecture = context.options.architecture ?? {};
  const json = values.format === "json";
  const say = (result, text) => {
    if (json) process.stdout.write(`${JSON.stringify({ ...result, dryRun: Boolean(values.dryRun) }, null, 2)}\n`);
    else console.log(`${values.dryRun ? "Dry run: " : ""}${text}`);
  };
  const actions = ["save", "use", "remove", "show"].filter((name) => values[name] !== undefined);
  if (actions.length > 1) throw new UsageError(`--${actions[0]} and --${actions[1]} do not go together`);
  if (values.save !== undefined) {
    const result = await saveTemplate(root, {
      name: values.save, title: values.title, summary: values.summary, from: values.from ?? "current", values: goalValues(values),
      file: values.templateFile, config: values.config, dryRun: Boolean(values.dryRun)
    });
    return say(result, `Saved the template ${result.name} in ${displayPath(result.templateFile ?? result.file)}${result.use ? ", and it is in use" : ""}.`);
  }
  if (values.use !== undefined) {
    const result = await useTemplate(root, { name: values.use || undefined, config: values.config, dryRun: Boolean(values.dryRun) });
    return say(result, result.name ? `The template ${result.name} is in use (architecture.template in ${displayPath(result.file)}).` : `No template is in use: the defaults apply (${displayPath(result.file)}).`);
  }
  if (values.remove !== undefined) {
    const result = await removeTemplate(root, { name: values.remove, config: values.config, dryRun: Boolean(values.dryRun) });
    return say(result, `Removed the template ${result.name} from ${displayPath(result.file)}${result.templateFile ? `; its file ${displayPath(result.templateFile)} stays` : ""}${result.wasInUse ? ". It was in use: the defaults apply now" : ""}.`);
  }
  if (values.show !== undefined) {
    process.stdout.write(`${JSON.stringify(resolveTemplate(root, architecture, values.show), null, 2)}\n`);
    return undefined;
  }
  const templates = listTemplates(root, architecture);
  if (json) process.stdout.write(`${JSON.stringify({ templates, criteria: CRITERIA.map(({ id, title, meaning, measured }) => ({ id, title, meaning, measured })), defaults: DEFAULT_GOALS }, null, 2)}\n`);
  else process.stdout.write(templatesText(templates));
  return undefined;
}
