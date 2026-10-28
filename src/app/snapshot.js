// The app as one offline HTML file: every page's data, the diagrams of the
// report views, the 3D explorer, and the UI-test documentation.
import { REPORT_VIEWS } from "../capabilities.js";
import { renderAppHtml } from "./page.js";

// Object pages in a compact form: every linked object once in a node table,
// links and members as arrays. The page expands them again (app.js); for the
// Base Application this shrinks the embedded data about tenfold.
function compactDetails(index) {
  const position = new Map();
  const nodes = [];
  const ref = ({ id, label, type, component, app }) => {
    if (!position.has(id)) {
      position.set(id, nodes.length);
      nodes.push([id, label, type, component ?? null, app ?? null]);
    }
    return position.get(id);
  };
  const details = {};
  for (const { id } of index.list) {
    const detail = index.detail(id);
    const members = detail.members ?? {};
    details[id] = {
      source: { file: detail.source.file, line: detail.source.line, url: detail.source.url },
      properties: detail.properties.map(({ name, value }) => [name, value]),
      uses: detail.uses.map((link) => [ref(link), link.dependency, link.kinds]),
      usedBy: detail.usedBy.map((link) => [ref(link), link.dependency, link.kinds]),
      violations: detail.violations.map(({ rule, target, targetComponent, kinds, resolution }) => ({ rule, target: ref(target), targetComponent, kinds, resolution })),
      members: [
        (members.fields ?? []).map(({ number, name, type }) => [number ?? null, name, type ?? null]),
        (members.procedures ?? []).map(({ name, signature, visibility, kind, event }) => [signature ?? name, visibility ?? null, kind ?? null, event ? 1 : 0]),
        (members.actions ?? []).map(({ name, container }) => [name, container ?? null]),
        (members.parts ?? []).map(({ name, target }) => [name, target ?? null])
      ]
    };
  }
  return { nodes, details };
}

export async function createSnapshot(workspace, { log = () => {}, history = false, last, title } = {}) {
  const overview = { ...await workspace.overview(), ...(title ? { title } : {}) };
  const [health, architecture, index, docsHtml] = await Promise.all([
    workspace.healthReport(),
    workspace.architecture(),
    workspace.objectIndex(),
    workspace.docsHtml()
  ]);
  const { nodes, details } = compactDetails(index);
  const views = [];
  const diagrams = {};
  for (const { id, summary } of workspace.views().filter(({ id }) => REPORT_VIEWS.includes(id))) {
    try {
      const diagram = await workspace.diagram({ view: id });
      if (!diagram.svg) continue;
      const { d2: _d2, ...rest } = diagram;
      diagrams[id] = rest;
      views.push({ id, summary });
      log(`Rendered ${id} view (${diagram.nodes} nodes, ${diagram.edges} edges)`);
    } catch (error) {
      log(`Skipped ${id} view: ${error.message}`);
    }
  }
  const explorerHtml = await workspace.explorer({ history, last });
  return {
    generatedAt: new Date().toISOString(),
    overview: { ...overview, live: false, root: undefined, projectRoot: undefined },
    health,
    architecture,
    objects: index.list,
    nodes,
    details,
    views,
    diagrams,
    explorerHtml,
    docsHtml
  };
}

export async function renderSnapshotHtml(workspace, options = {}) {
  const snapshot = await createSnapshot(workspace, options);
  return { html: renderAppHtml({ mode: "static", snapshot, title: `${snapshot.overview.title} · BC Atlas` }), snapshot };
}
