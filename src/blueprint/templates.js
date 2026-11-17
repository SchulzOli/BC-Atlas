// Templates bundle everything that says what a good architecture is for a
// team: the goals (which criteria count, and how much), the settings of the
// proposal, the coupling weights, and how strict the layers are. BC Atlas
// ships presets; a team keeps its own in .bca.json:
//
//   "architecture": {
//     "template": "our-way",
//     "templates": {
//       "our-way": { "extends": "layered", "goals": { "weights": { "fewMoves": 3 } } },
//       "company": "../shared/bc-atlas-template.json"
//     }
//   }
//
// A template of your own starts from the defaults or from the template it
// extends and overrides parts of it. Precedence of every setting: option of
// the call, then architecture.proposal / architecture.goals in .bca.json,
// then the template, then the default.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../cli/errors.js";
import { couplingWeights } from "../graph/coupling.js";
import { DEFAULT_GOALS, goalsConfig } from "./goals.js";
import { PROPOSAL_DEFAULTS, proposalSettings } from "./settings.js";

export const DEFAULT_TEMPLATE = "balanced";

const RULE_KEYS = Object.freeze(["allowSameLayer", "strictLayers", "internalAccess"]);
const TEMPLATE_KEYS = Object.freeze(["title", "summary", "extends", "goals", "proposal", "couplingWeights", ...RULE_KEYS, "$comment"]);
const PROPOSAL_KEYS = Object.keys(PROPOSAL_DEFAULTS);

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

/** The presets BC Atlas ships. Each summary says when to use it. */
export const PRESETS = deepFreeze({
  balanced: {
    title: "Balanced",
    summary: "The default. The relations decide what a component is, namespaces and folders are a starting point, and every criterion counts with a moderate weight. Use it when you have no stronger opinion yet.",
    goals: { weights: { ...DEFAULT_GOALS.weights }, size: { ...DEFAULT_GOALS.size } },
    proposal: {}
  },
  "follow-structure": {
    title: "Follow the structure",
    summary: "Trust the namespaces and folders the team has already. Components are the namespaces (objects without one follow their relations); agreement with the structure and few moves count most. Use it when the structure is deliberate and you want to find what breaks it.",
    goals: { weights: { cohesion: 1, modularity: 2, layering: 2, acyclic: 2, ownership: 1, extractable: 1, stability: 1, size: 1, followNamespaces: 5, followFolders: 4, followApps: 2, fewMoves: 4 } },
    proposal: { groupBy: "namespace", sharedCore: false }
  },
  "by-coupling": {
    title: "By coupling",
    summary: "What works together belongs together. Only the relations shape components; namespaces and folders are ignored and do not count. Use it for code whose folders sort by object type or grew by accident, or to see what the code itself says.",
    goals: { weights: { cohesion: 4, modularity: 6, layering: 2, acyclic: 2, ownership: 3, extractable: 1, stability: 1, size: 1, followNamespaces: 0, followFolders: 0, followApps: 0, fewMoves: 0 } },
    proposal: { groupBy: "coupling", startFrom: [] }
  },
  layered: {
    title: "Layered",
    summary: "Clean direction first: no cycles, no dependencies that point the wrong way, stable components at the bottom, and no skipping of layers. Use it when the components are roughly right and the dependencies between them are the problem.",
    goals: { weights: { cohesion: 1, modularity: 3, layering: 6, acyclic: 5, ownership: 2, extractable: 2, stability: 3, size: 1, followNamespaces: 1, followFolders: 1, followApps: 1, fewMoves: 1 } },
    proposal: {},
    strictLayers: true,
    allowSameLayer: false
  },
  "modular-monolith": {
    title: "Modular monolith",
    summary: "A few coarse components that can become apps: each could be extracted, owns the tables it writes, and shares one core. Access = Internal is private to a component. Use it to prepare splitting an app, or to keep one large app in clear modules.",
    goals: { weights: { cohesion: 2, modularity: 4, layering: 3, acyclic: 4, ownership: 4, extractable: 5, stability: 2, size: 3, followNamespaces: 1, followFolders: 1, followApps: 2, fewMoves: 1 }, size: { min: 10, max: 400 } },
    proposal: { granularity: 0.6, sharedCore: true, minObjects: 5 },
    internalAccess: "component"
  },
  "small-steps": {
    title: "Small steps",
    summary: "Stay close to today and improve what is cheap. The structure of today is the starting point, few moves count most, and only objects that clearly belong elsewhere are proposed to move. Use it for a code base in production where every move costs.",
    goals: { weights: { cohesion: 1, modularity: 2, layering: 2, acyclic: 2, ownership: 1, extractable: 1, stability: 1, size: 0, followNamespaces: 3, followFolders: 3, followApps: 2, fewMoves: 8 } },
    proposal: { moves: { minGain: 4, limit: 20 } }
  }
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const toPosix = (value) => String(value).replaceAll("\\", "/");

function checkName(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9 ._-]*[A-Za-z0-9])?$/u.test(name)) {
    throw new UsageError(`"${name}" is not a template name; use letters, digits, spaces, dots, dashes, and underscores`);
  }
  return name;
}

/** The names of the templates of .bca.json, with the presets: for messages. */
function known(architecture) {
  return [...Object.keys(PRESETS), ...Object.keys(isObject(architecture?.templates) ? architecture.templates : {}).filter((name) => name !== "$comment")];
}

/** Checks the parts of one template definition (not what it extends). */
function validateDefinition(definition, where) {
  if (!isObject(definition)) throw new UsageError(`${where} must be a template object or the path of a JSON file`);
  for (const key of Object.keys(definition)) {
    if (!TEMPLATE_KEYS.includes(key)) throw new UsageError(`${where} has no setting "${key}"; use ${TEMPLATE_KEYS.filter((item) => item !== "$comment").join(", ")}`);
  }
  for (const key of ["title", "summary", "extends"]) {
    if (definition[key] !== undefined && typeof definition[key] !== "string") throw new UsageError(`${where}.${key} must be text`);
  }
  try {
    if (definition.goals !== undefined) goalsConfig({ goals: definition.goals });
    if (definition.proposal !== undefined) proposalSettings({ proposal: definition.proposal });
    if (definition.couplingWeights !== undefined) couplingWeights(definition.couplingWeights);
  } catch (error) {
    throw new UsageError(`${where}: ${error.message}`);
  }
  for (const key of ["allowSameLayer", "strictLayers"]) {
    if (definition[key] !== undefined && typeof definition[key] !== "boolean") throw new UsageError(`${where}.${key} must be true or false`);
  }
  if (definition.internalAccess !== undefined && !["app", "component"].includes(definition.internalAccess)) {
    throw new UsageError(`${where}.internalAccess must be "app" or "component"`);
  }
  return definition;
}

/** One template as it is written down: a preset, an object of .bca.json, or a JSON file. */
function readDefinition(root, architecture, name) {
  const own = isObject(architecture?.templates) ? architecture.templates : {};
  if (architecture?.templates !== undefined && !isObject(architecture.templates)) {
    throw new UsageError("architecture.templates must map template names to templates or to paths of JSON files");
  }
  if (Object.hasOwn(own, name) && name !== "$comment") {
    if (Object.hasOwn(PRESETS, name)) throw new UsageError(`architecture.templates: "${name}" is a preset; give your template another name and let it extend the preset`);
    const entry = own[name];
    if (typeof entry === "string") {
      const file = path.resolve(root, entry);
      let definition;
      try {
        definition = JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        throw new UsageError(`architecture.templates.${name}: cannot read ${entry}: ${error.code === "ENOENT" ? "no such file" : error.message}`);
      }
      return { definition: validateDefinition(definition, `template "${name}" (${entry})`), origin: toPosix(entry) };
    }
    return { definition: validateDefinition(entry, `architecture.templates.${name}`), origin: ".bca.json" };
  }
  if (Object.hasOwn(PRESETS, name)) return { definition: PRESETS[name], origin: "preset" };
  throw new UsageError(`no template "${name}"; templates: ${known(architecture).join(", ")}`);
}

/** Proposal settings of a later part override; settings that are objects (moves) merge per key. */
function mergeProposal(base = {}, override = {}) {
  const proposal = { ...base, ...override };
  for (const key of Object.keys(override)) {
    if (isObject(base[key]) && isObject(override[key])) proposal[key] = { ...base[key], ...override[key] };
  }
  delete proposal.$comment;
  return proposal;
}

/** Later parts override earlier ones; weights, the size band, the proposal, its moves, and the coupling weights merge per key. */
function merge(base, definition) {
  const proposal = mergeProposal(base.proposal, definition.proposal);
  const weights = { ...base.goals?.weights, ...definition.goals?.weights };
  delete weights.$comment;
  const size = { ...base.goals?.size, ...definition.goals?.size };
  const coupling = { ...base.couplingWeights, ...definition.couplingWeights };
  return {
    goals: { weights, ...(Object.keys(size).length ? { size } : {}) },
    proposal,
    ...(Object.keys(coupling).length ? { couplingWeights: coupling } : {}),
    ...Object.fromEntries(RULE_KEYS.map((key) => [key, definition[key] ?? base[key]]).filter(([, value]) => value !== undefined))
  };
}

/**
 * A template with everything it extends merged in.
 * @param root the project root; paths of template files are relative to it
 * @param architecture `architecture` from .bca.json (templates)
 * @param name a preset or a template of .bca.json (default: balanced)
 * @returns { name, title, summary, origin: "preset" | ".bca.json" | file path, extends?, chain: [names, base first],
 *   goals: { weights, size? }, proposal, couplingWeights?, allowSameLayer?, strictLayers?, internalAccess? }
 *   holding only what the template and its bases set; templateSettings adds defaults, .bca.json, and options
 */
export function resolveTemplate(root, architecture = {}, name = DEFAULT_TEMPLATE) {
  const chain = [];
  const definitions = [];
  let current = name;
  while (current !== undefined) {
    if (chain.includes(current)) throw new UsageError(`template "${name}" extends itself: ${[...chain, current].join(" -> ")}`);
    chain.push(current);
    const read = readDefinition(root, architecture, current);
    definitions.push(read);
    current = read.definition.extends;
  }
  const merged = definitions.reverse().reduce((base, { definition }) => merge(base, definition), {});
  const { definition, origin } = definitions.at(-1);
  return {
    name,
    title: definition.title ?? name,
    summary: definition.summary ?? "",
    origin,
    ...(definition.extends ? { extends: definition.extends } : {}),
    chain: chain.reverse(),
    ...merged
  };
}

/**
 * The presets and the templates of .bca.json, presets first.
 * @returns [{ name, title, summary, origin, extends?, chain, goals, proposal, ..., active }];
 *   a template that cannot be read has { name, origin, error } instead
 */
export function listTemplates(root, architecture = {}) {
  const active = architecture?.template ?? DEFAULT_TEMPLATE;
  const own = isObject(architecture?.templates) ? Object.keys(architecture.templates).filter((name) => name !== "$comment" && !Object.hasOwn(PRESETS, name)) : [];
  return [...Object.keys(PRESETS), ...own].map((name) => {
    try {
      return { ...resolveTemplate(root, architecture, name), active: name === active };
    } catch (error) {
      const entry = architecture.templates?.[name];
      return { name, origin: typeof entry === "string" ? toPosix(entry) : ".bca.json", error: error.message, active: name === active };
    }
  });
}

/**
 * Everything the template in use, .bca.json, and the options of a call say
 * about what a good architecture is.
 * @param root the project root
 * @param architecture `architecture` from .bca.json (template, templates, goals, proposal, couplingWeights, the layer rules)
 * @param values options of the call (undefined = not set): template, weights, size, and the proposal settings
 * @returns {
 *   template: { name, title, summary, origin, chain, source },
 *   goals,            // goalsConfig: { weights, size, sources }
 *   settings,         // proposalSettings, ready for proposeArchitecture; sources name the template
 *   proposalConfig,   // what was handed to proposalSettings as config: { proposal, couplingWeights }
 *   proposalValues,   // what was handed to it as values
 *   couplingWeights,  // overrides of template and .bca.json, or undefined
 *   rules,            // { allowSameLayer?, strictLayers?, internalAccess? }: .bca.json, else the template
 *   templateRules,    // the same from the template only
 *   sources: { template, goals, proposal, rules }
 * }
 */
export function templateSettings(root, architecture = {}, values = {}) {
  const config = architecture ?? {};
  const name = values.template ?? config.template ?? DEFAULT_TEMPLATE;
  if (typeof name !== "string") throw new UsageError("architecture.template must name a template");
  const template = resolveTemplate(root, config, name);
  const source = `template ${name}`;
  const goals = goalsConfig(config, values, { goals: template.goals, source });

  const configured = config.proposal ?? {};
  if (!isObject(configured)) throw new UsageError("architecture.proposal must be an object");
  const proposal = mergeProposal(template.proposal, configured);
  const coupling = template.couplingWeights || config.couplingWeights ? { ...template.couplingWeights, ...config.couplingWeights } : undefined;
  const proposalConfig = { proposal, ...(coupling ? { couplingWeights: coupling } : {}) };
  const proposalValues = Object.fromEntries(PROPOSAL_KEYS.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  let settings;
  try {
    settings = proposalSettings(proposalConfig, proposalValues);
  } catch (error) {
    throw error instanceof UsageError ? error : new UsageError(error.message);
  }
  // proposalSettings only knows .bca.json and options; say what came from the template.
  for (const key of PROPOSAL_KEYS) {
    if (settings.sources[key] === ".bca.json" && configured[key] === undefined) settings.sources[key] = source;
  }
  if (coupling && !config.couplingWeights) settings.sources.weights = source;

  const rules = {};
  const templateRules = {};
  const ruleSources = {};
  for (const key of RULE_KEYS) {
    if (template[key] !== undefined) templateRules[key] = template[key];
    const value = config[key] ?? template[key];
    if (value === undefined) continue;
    rules[key] = value;
    ruleSources[key] = config[key] !== undefined ? ".bca.json" : source;
  }
  const templateSource = values.template !== undefined ? "option" : config.template !== undefined ? ".bca.json" : "default";
  return {
    template: { name, title: template.title, summary: template.summary, origin: template.origin, chain: template.chain, source: templateSource },
    goals,
    settings,
    proposalConfig,
    proposalValues,
    couplingWeights: coupling,
    rules,
    templateRules,
    sources: { template: templateSource, goals: goals.sources, proposal: settings.sources, rules: ruleSources }
  };
}

/**
 * An architecture with the coupling weights and layer rules of the settings.
 * For a proposed architecture only the rules of the template apply (rules of
 * .bca.json belong to the configured components); `all` applies both, so that
 * two architectures are checked with the same rules.
 */
export function withTemplateRules(architecture, settings, { proposed = false, all = false } = {}) {
  return {
    ...architecture,
    ...(proposed && !all ? settings.templateRules : settings.rules),
    ...(settings.couplingWeights ? { couplingWeights: settings.couplingWeights } : {})
  };
}

/** The effective settings as one template that stands on its own (extends nothing). */
function currentDefinition(settings, { title, summary }) {
  const proposal = Object.fromEntries(PROPOSAL_KEYS
    .filter((key) => settings.settings.sources[key] !== "default" && settings.settings[key] !== undefined)
    .map((key) => [key, settings.settings[key]]));
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    goals: { weights: { ...settings.goals.weights }, size: { ...settings.goals.size } },
    proposal,
    ...(settings.couplingWeights ? { couplingWeights: { ...settings.couplingWeights } } : {}),
    ...settings.rules
  };
}

async function readConfigFile(file) {
  try {
    const config = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isObject(config)) throw new UsageError(`${file}: the configuration root must be an object`);
    return config;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new UsageError(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
}

const configFile = (root, config) => config ? path.resolve(config) : path.join(path.resolve(root), ".bca.json");

/** Writes the configuration when it changed; the rest of the file keeps its content. */
async function writeConfig(file, before, next, dryRun) {
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  const written = changed && !dryRun;
  if (written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { changed, written };
}

/**
 * Saves a template of your own in .bca.json (architecture.templates), or in
 * a JSON file that .bca.json points to, so several repositories can share it.
 * @param root the project root
 * @param options {
 *   name, title, summary,
 *   from: "current" (default: the effective settings as they are now, with `values`) or the name of a template to copy,
 *   template: a template object to save as it is (may extend another one); instead of `from`,
 *   values: options of the call that count for "current" (template, weights, size, proposal settings),
 *   file: path of a JSON file for the template, relative to the project,
 *   use: also make it the template in use,
 *   config: path of the configuration file (default: .bca.json of the project), dryRun }
 * @returns { name, template (what was saved), resolved (as resolveTemplate reads it back), file (the configuration),
 *   templateFile?, use, changed, written }
 */
export async function saveTemplate(root, { name, title, summary, from = "current", template: given, values = {}, file: templateFile, use = false, config: configPath, dryRun = false } = {}) {
  checkName(name);
  if (Object.hasOwn(PRESETS, name)) throw new UsageError(`"${name}" is a preset and cannot be overwritten; save your template under another name`);
  const projectRoot = path.resolve(root);
  const file = configFile(projectRoot, configPath);
  const before = await readConfigFile(file);
  const architecture = before.architecture ?? {};
  if (!isObject(architecture)) throw new UsageError("architecture in .bca.json must be an object");

  let definition;
  if (given !== undefined) {
    definition = { ...given, ...(title ? { title } : {}), ...(summary ? { summary } : {}) };
  } else if (from === "current") {
    definition = currentDefinition(templateSettings(projectRoot, architecture, values), { title, summary });
  } else {
    const { name: _name, origin: _origin, chain: _chain, extends: _extends, title: sourceTitle, summary: sourceSummary, ...parts } = resolveTemplate(projectRoot, architecture, from);
    definition = { title: title ?? sourceTitle, summary: summary ?? sourceSummary, ...JSON.parse(JSON.stringify(parts)) };
  }
  validateDefinition(definition, `template "${name}"`);

  const relative = templateFile === undefined ? undefined : toPosix(path.relative(projectRoot, path.resolve(projectRoot, templateFile)));
  const next = {
    ...before,
    architecture: {
      ...architecture,
      ...(use ? { template: name } : {}),
      templates: { ...(isObject(architecture.templates) ? architecture.templates : {}), [name]: relative ?? definition }
    }
  };
  // What is not valid never reaches the file: the template must resolve (what it extends exists, no circle) and give valid settings.
  const check = { ...next.architecture, templates: { ...next.architecture.templates, [name]: definition } };
  const resolved = resolveTemplate(projectRoot, check, name);
  templateSettings(projectRoot, { ...check, template: name }, {});

  const result = await writeConfig(file, before, next, dryRun);
  let fileChanged = false;
  if (relative !== undefined) {
    const target = path.resolve(projectRoot, relative);
    const content = `${JSON.stringify(definition, null, 2)}\n`;
    let existing;
    try {
      existing = await fs.readFile(target, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    fileChanged = existing !== content;
    if (fileChanged && !dryRun) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
  }
  return {
    name,
    template: definition,
    resolved: { ...resolved, origin: relative ?? ".bca.json" },
    file,
    ...(relative === undefined ? {} : { templateFile: relative }),
    use: Boolean(use),
    changed: result.changed || fileChanged,
    written: (result.changed || fileChanged) && !dryRun
  };
}

/**
 * Makes a template the one in use (architecture.template in .bca.json).
 * Without a name the entry is removed and the default (balanced) applies.
 * @returns { name, template (resolved), file, changed, written }
 */
export async function useTemplate(root, { name, config: configPath, dryRun = false } = {}) {
  const projectRoot = path.resolve(root);
  const file = configFile(projectRoot, configPath);
  const before = await readConfigFile(file);
  const architecture = { ...(before.architecture ?? {}) };
  if (name === undefined || name === null || name === "") delete architecture.template;
  else architecture.template = name;
  // Fails for a name that is neither a preset nor a template of .bca.json, and for settings that do not fit together.
  const settings = templateSettings(projectRoot, architecture, {});
  const next = { ...before, architecture };
  if (!Object.keys(architecture).length && before.architecture === undefined) delete next.architecture;
  return { name: settings.template.name, template: resolveTemplate(projectRoot, architecture, settings.template.name), file, ...await writeConfig(file, before, next, dryRun) };
}

/**
 * Removes a template of your own from .bca.json. A template file it points
 * to stays where it is. When the template was the one in use, the default
 * applies again.
 * @returns { name, file, templateFile?, wasInUse, changed, written }
 */
export async function removeTemplate(root, { name, config: configPath, dryRun = false } = {}) {
  const projectRoot = path.resolve(root);
  const file = configFile(projectRoot, configPath);
  const before = await readConfigFile(file);
  if (Object.hasOwn(PRESETS, name ?? "")) throw new UsageError(`"${name}" is a preset and cannot be removed`);
  const own = isObject(before.architecture?.templates) ? before.architecture.templates : {};
  if (!Object.hasOwn(own, name ?? "")) throw new UsageError(`no template "${name}" in .bca.json; your templates: ${Object.keys(own).join(", ") || "none"}`);
  const dependents = Object.keys(own).filter((other) => {
    if (other === name || other === "$comment") return false;
    try {
      return readDefinition(projectRoot, before.architecture, other).definition.extends === name;
    } catch {
      return false;
    }
  });
  if (dependents.length) throw new UsageError(`template "${name}" is extended by ${dependents.join(", ")}; remove or change them first`);
  const { [name]: removed, ...templates } = own;
  const architecture = { ...before.architecture, templates };
  if (!Object.keys(templates).length) delete architecture.templates;
  const wasInUse = architecture.template === name;
  if (wasInUse) delete architecture.template;
  return {
    name,
    file,
    ...(typeof removed === "string" ? { templateFile: toPosix(removed) } : {}),
    wasInUse,
    ...await writeConfig(file, before, { ...before, architecture }, dryRun)
  };
}
