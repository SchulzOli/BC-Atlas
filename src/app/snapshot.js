// The app as one offline HTML file: the atlas of the project (every node,
// relation, lens, finding, and story) and, for projects that are not huge,
// the inside of every object.
import { renderAppHtml } from "./page.js";

// Above this many objects an export leaves the insides out; VS Code reads them on demand.
const MAX_INSIDES = 2500;

/**
 * @returns { generatedAt, atlas, inside: { [object id]: inside } }
 */
export async function createSnapshot(workspace, { log = () => {}, title } = {}) {
  const atlas = { ...await workspace.atlas(), live: false, ...(title ? { title } : {}) };
  const objects = atlas.nodes.filter((node) => node.kind === "object" && !node.external);
  const inside = {};
  if (objects.length <= MAX_INSIDES) {
    for (const { id } of objects) {
      const found = await workspace.inside(id);
      if (found?.nodes.length) inside[id] = found;
    }
  } else {
    log(`${objects.length.toLocaleString("en-US")} objects: the export leaves out what is inside each object (at most ${MAX_INSIDES.toLocaleString("en-US")}).`);
  }
  log(`Read ${atlas.nodes.length.toLocaleString("en-US")} nodes, ${atlas.edges.length.toLocaleString("en-US")} relations, ${atlas.lenses.length} lenses, ${atlas.stories.length} stories`);
  return { generatedAt: new Date().toISOString(), atlas, inside };
}

export async function renderSnapshotHtml(workspace, options = {}) {
  const snapshot = await createSnapshot(workspace, options);
  return { html: renderAppHtml({ mode: "static", snapshot, title: `${snapshot.atlas.title} · BC Atlas` }), snapshot };
}
