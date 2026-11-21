// What the BC Atlas view and the editor can ask for, independent of the
// transport: the VS Code extension calls it through a worker process
// (worker.js), and tests call it directly. Every method takes one plain
// object and returns JSON.

import { LENSES } from "./atlas.js";

export function createService(workspace) {
  const methods = {
    overview: () => workspace.overview(),
    health: () => workspace.healthReport(),
    objects: () => workspace.objects(),
    object: async ({ id } = {}) => {
      const object = await workspace.object(String(id ?? ""));
      if (!object) throw new Error("object not found");
      return object;
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
