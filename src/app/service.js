// What the BC Atlas view and the editor can ask for, independent of the
// transport: the VS Code extension calls it through a worker process
// (worker.js), and tests call it directly. Every method takes one plain
// object and returns JSON.

import { LENSES } from "./atlas.js";

const GROUPINGS = ["auto", "coupling", "namespace", "folder", "module", "app"];

function positive(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^[1-9]\d*$/u.test(String(value))) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

const truthy = (value) => value === true || value === 1 || value === "1" || value === "true";

// Empty means the .bca.json setting (architecture.proposal), else the default.
function architectureSettings(params = {}) {
  const groupBy = params.groupBy || undefined;
  if (groupBy && !GROUPINGS.includes(groupBy)) throw new Error(`groupBy must be one of: ${GROUPINGS.join(", ")}`);
  const optional = (value) => value === undefined || value === null || value === "" ? undefined : value;
  return {
    propose: truthy(params.propose),
    groupBy,
    depth: positive(params.depth, "depth"),
    minObjects: positive(params.minObjects, "minObjects"),
    startFrom: optional(params.startFrom),
    ignore: optional(params.ignore),
    granularity: optional(params.granularity),
    sharedCore: optional(params.sharedCore)
  };
}

export function createService(workspace) {
  const methods = {
    overview: () => workspace.overview(),
    health: () => workspace.healthReport(),
    architecture: (params) => workspace.architecture(architectureSettings(params)),
    objects: () => workspace.objects(),
    object: async ({ id } = {}) => {
      const object = await workspace.object(String(id ?? ""));
      if (!object) throw new Error("object not found");
      return object;
    },
    battleTest: async ({ language } = {}) => {
      const report = await workspace.battleTest({ language: language || undefined });
      if (!report) throw new Error("no process tests found");
      return report;
    },
    atlas: () => workspace.atlas(),
    // What the graph can show, without analyzing anything.
    lenses: () => LENSES.map(({ id, title, summary }) => ({ id, title, summary })),
    inside: async ({ id } = {}) => {
      const inside = await workspace.inside(String(id ?? ""));
      if (!inside) throw new Error("object not found");
      return inside;
    },
    docs: async () => {
      const docs = await workspace.docs();
      return docs ? { path: docs.path, scenarios: docs.scenarios } : { scenarios: 0 };
    },
    adoptArchitecture: (params = {}) => workspace.adoptArchitecture(architectureSettings(params), { updateBaseline: params.updateBaseline !== false }),
    updateBaseline: () => workspace.updateBaseline(),
    updateProposal: (params = {}) => workspace.updateProposal({
      keep: params.keep,
      release: params.release || undefined,
      exclude: params.exclude || undefined,
      include: params.include || undefined
    }),
    refresh: () => {
      workspace.reset();
      return { generation: workspace.generation, updatedAt: workspace.updatedAt };
    }
  };
  return {
    methods: Object.keys(methods),
    async call(method, params) {
      if (!Object.hasOwn(methods, method)) throw new Error(`unknown method "${method}"`);
      return methods[method](params ?? {});
    }
  };
}
