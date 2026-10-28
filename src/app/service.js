// What the BC Atlas pages can ask for, independent of the transport: the VS
// Code extension calls it through a worker process (worker.js), and tests
// call it directly. Every method takes one plain object and returns JSON or,
// for the explorer and the docs, an HTML page as a string.

const HISTORY = ["commits", "prs", "releases"];
const GROUPINGS = ["auto", "namespace", "folder", "module", "app"];

function positive(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!/^[1-9]\d*$/u.test(String(value))) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

const truthy = (value) => value === true || value === 1 || value === "1" || value === "true";

function architectureSettings(params = {}) {
  const groupBy = params.groupBy || "auto";
  if (!GROUPINGS.includes(groupBy)) throw new Error(`groupBy must be one of: ${GROUPINGS.join(", ")}`);
  return { propose: truthy(params.propose), groupBy, depth: positive(params.depth, "depth"), minObjects: positive(params.minObjects, "minObjects") };
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
    views: () => workspace.views(),
    diagram: (params = {}) => workspace.diagram(params),
    docs: async () => {
      const docs = await workspace.docs();
      return docs ? { path: docs.path, scenarios: docs.scenarios } : { scenarios: 0 };
    },
    explorer: ({ propose, history, last } = {}) => {
      if (history && !HISTORY.includes(history)) throw new Error(`history must be one of: ${HISTORY.join(", ")}`);
      return workspace.explorer({ propose: truthy(propose), history: history || false, last: positive(last, "last") });
    },
    docsHtml: async () => {
      const html = await workspace.docsHtml();
      if (!html) throw new Error("no UI-test documentation found");
      return html;
    },
    adoptArchitecture: (params = {}) => workspace.adoptArchitecture(architectureSettings(params), { updateBaseline: params.updateBaseline !== false }),
    updateBaseline: () => workspace.updateBaseline(),
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
