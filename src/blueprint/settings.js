// What the architecture proposal takes into account, and how: the defaults,
// overridden by `architecture.proposal` in .bca.json, overridden by the CLI,
// the MCP tool, or the app. Every setting remembers where its value came
// from, so a proposal can say how it was made.
//
//   groupBy         auto | coupling | namespace | folder | module | app
//   depth           namespace or folder segments per component
//   minObjects      smaller components join the one they depend on most
//   startFrom       existing structures that compete with the relations as a
//                   starting point: namespace, folder (none: relations only)
//   ignore          relation kinds that never shape a component
//   granularity     community resolution: higher gives more, smaller components
//   appGranularity  the same for app candidates
//   sharedCore      pull objects that many components use into a shared core
//   keep            components you define yourself: { name, match, description }
//   exclude         objects that do not shape components; they join the
//                   component they are most coupled to afterwards
//   moves           { minGain, limit } for objects that belong elsewhere
import { COUPLING_WEIGHTS, couplingWeights } from "../graph/coupling.js";

export const GROUPINGS = Object.freeze(["auto", "coupling", "namespace", "folder", "module", "app"]);
export const STRUCTURES = Object.freeze(["namespace", "folder"]);
export const RELATION_KINDS = Object.freeze(Object.keys(COUPLING_WEIGHTS));

export const PROPOSAL_DEFAULTS = Object.freeze({
  groupBy: "auto",
  depth: undefined,
  minObjects: 1,
  startFrom: Object.freeze(["namespace", "folder"]),
  ignore: Object.freeze(["permits", "includes"]),
  granularity: 1,
  appGranularity: 0.3,
  sharedCore: true,
  keep: Object.freeze([]),
  exclude: Object.freeze([]),
  moves: Object.freeze({ minGain: 2, limit: 50 })
});

const KEYS = Object.keys(PROPOSAL_DEFAULTS);

function fail(key, message) {
  throw new Error(`architecture.proposal.${key} ${message}`);
}

const number = (key, value, { min = 0, integer = false, positive = false } = {}) => {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < min || (positive && parsed <= 0) || (integer && !Number.isInteger(parsed))) {
    fail(key, `must be ${integer ? "an integer" : "a number"} ${positive ? "above 0" : `of ${min} or more`}`);
  }
  return parsed;
};

const list = (key, value) => {
  const items = typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) fail(key, "must be a list of names");
  return items;
};

const VALIDATE = {
  groupBy: (value) => {
    if (!GROUPINGS.includes(value)) fail("groupBy", `must be one of: ${GROUPINGS.join(", ")}`);
    return value;
  },
  depth: (value) => value === undefined ? undefined : number("depth", value, { integer: true, positive: true }),
  minObjects: (value) => number("minObjects", value, { integer: true, min: 1 }),
  startFrom: (value) => {
    const items = list("startFrom", value);
    if (items.length === 1 && items[0] === "none") return [];
    for (const item of items) if (!STRUCTURES.includes(item)) fail("startFrom", `takes ${STRUCTURES.join(", ")}, or none (received "${item}")`);
    return [...new Set(items)];
  },
  ignore: (value) => {
    const items = list("ignore", value);
    for (const item of items) if (!RELATION_KINDS.includes(item)) fail("ignore", `takes relation kinds: ${RELATION_KINDS.join(", ")} (received "${item}")`);
    return [...new Set(items)];
  },
  granularity: (value) => number("granularity", value, { positive: true }),
  appGranularity: (value) => number("appGranularity", value, { positive: true }),
  sharedCore: (value) => {
    if (value === "true" || value === "false") return value === "true";
    if (typeof value !== "boolean") fail("sharedCore", "must be true or false");
    return value;
  },
  keep: (value) => {
    if (!Array.isArray(value)) fail("keep", "must list components: [{ \"name\": ..., \"match\": [...] }]");
    const names = new Set();
    return value.map((component, index) => {
      if (!component?.name || typeof component.name !== "string") fail(`keep[${index}]`, "needs a name");
      if (names.has(component.name)) fail("keep", `names "${component.name}" twice`);
      names.add(component.name);
      const match = [component.match ?? []].flat();
      if (!match.length || match.some((selector) => typeof selector !== "string")) fail(`keep[${index}]`, "needs match selectors, e.g. [\"namespace:Contoso.Sales\"]");
      return { name: component.name, match, ...(component.description ? { description: String(component.description) } : {}) };
    });
  },
  exclude: (value) => {
    const items = [value].flat();
    if (items.some((selector) => typeof selector !== "string" || !selector.trim())) fail("exclude", "must list selectors, e.g. [\"type:permissionset\"]");
    return items;
  },
  moves: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("moves", "must be { \"minGain\": number, \"limit\": number }");
    for (const key of Object.keys(value)) if (!["minGain", "limit"].includes(key)) fail("moves", `has no setting "${key}"; use minGain or limit`);
    return {
      minGain: value.minGain === undefined ? PROPOSAL_DEFAULTS.moves.minGain : number("moves.minGain", value.minGain),
      limit: value.limit === undefined ? PROPOSAL_DEFAULTS.moves.limit : number("moves.limit", value.limit, { integer: true })
    };
  }
};

/**
 * The effective proposal settings.
 * @param config `architecture` from .bca.json (proposal, couplingWeights)
 * @param values overrides from the CLI, MCP, or the app (undefined = not set)
 * @returns { ...settings, weights, sources: { setting: "default" | ".bca.json" | "option" } }
 */
export function proposalSettings(config = {}, values = {}) {
  const configured = config?.proposal ?? {};
  if (typeof configured !== "object" || Array.isArray(configured)) throw new Error("architecture.proposal must be an object");
  for (const key of Object.keys(configured)) {
    if (!KEYS.includes(key) && key !== "$comment") throw new Error(`architecture.proposal has no setting "${key}"; use ${KEYS.join(", ")}`);
  }
  const settings = {};
  const sources = {};
  for (const key of KEYS) {
    if (values[key] !== undefined) {
      settings[key] = VALIDATE[key](values[key]);
      sources[key] = "option";
    } else if (configured[key] !== undefined) {
      settings[key] = VALIDATE[key](configured[key]);
      sources[key] = ".bca.json";
    } else {
      settings[key] = PROPOSAL_DEFAULTS[key];
      sources[key] = "default";
    }
  }
  settings.weights = couplingWeights(config?.couplingWeights);
  sources.weights = config?.couplingWeights ? ".bca.json" : "default";
  settings.sources = sources;
  return settings;
}

/** The relation kinds that shape components under these settings. */
export function shapingKinds(settings = PROPOSAL_DEFAULTS) {
  const ignored = new Set(settings.ignore);
  return RELATION_KINDS.filter((kind) => !ignored.has(kind) && (settings.weights ?? COUPLING_WEIGHTS)[kind] > 0);
}
