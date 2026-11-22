// The user guides in the one graph: every documented AL UI test is a node,
// linked to the pages its steps use (src/guides.js), and every end-to-end
// journey ([JOURNEY]) is a story that walks through its stages.

export const GUIDE_COLOR = "#7C3AED";
// The lens that shows the guides, next to the pages they use.
export const GUIDE_LENS = "pages";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const slug = (value) => String(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "journey";

/** Adds a node per guide and a `documents` relation to every page it uses; a page counts its guides. */
export function addGuides(graph, linked) {
  if (!linked?.guides.length) return;
  for (const guide of linked.guides) {
    const id = `guide::${guide.id}`;
    graph.node(Object.fromEntries(Object.entries({
      id,
      kind: "guide",
      type: "guide",
      label: guide.title,
      color: GUIDE_COLOR,
      about: guide.goal === guide.title || guide.goal === `${guide.title}.` ? undefined : guide.goal,
      features: guide.features.join(", ") || undefined,
      journeys: guide.journeys.join(", ") || undefined,
      roles: guide.roles.join(", ") || undefined,
      permissions: guide.permissions.join(", ") || undefined,
      actions: [...new Set(guide.pages.flatMap(({ actions }) => actions))].join(", ") || undefined,
      document: guide.id,
      file: guide.file,
      line: guide.line
    }).filter(([, value]) => value !== undefined)));
    for (const page of guide.pages) {
      if (!graph.has(page.key)) continue;
      graph.edge(id, page.key, "documents", page.steps);
      const node = graph.nodes[graph.at(page.key)];
      node.guides = (node.guides ?? 0) + 1;
    }
  }
}

/** The lens of the pages also shows the guides and what they document. */
export function withGuides(lenses, graph) {
  if (!graph.nodes.some(({ kind }) => kind === "guide")) return lenses;
  return lenses.map((lens) => lens.id !== GUIDE_LENS ? lens : {
    ...lens,
    summary: `${lens.summary} The user guides from the AL UI tests show which pages they document.`,
    reads: `${lens.reads}, and the documented AL UI tests`,
    kinds: [...lens.kinds, "guide"],
    relations: [...lens.relations, "documents"],
    from: lens.from && [...lens.from, "guide"]
  });
}

/** The stages of a journey in the order of their links: what is required, and what comes before, first. */
function inOrder(stages) {
  const ids = new Set(stages.map(({ id }) => id));
  const before = new Map(stages.map(({ id }) => [id, new Set()]));
  for (const stage of stages) {
    for (const id of stage.requires) if (ids.has(id)) before.get(stage.id).add(id);
    for (const id of stage.next) if (ids.has(id)) before.get(id).add(stage.id);
  }
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const ordered = [];
  const state = new Map();
  const visit = (id) => {
    if (state.has(id)) return;
    state.set(id, "visiting");
    for (const previous of [...before.get(id)].sort()) visit(previous);
    ordered.push(byId.get(id));
  };
  for (const { id } of [...stages].sort((a, b) => a.id.localeCompare(b.id))) visit(id);
  return ordered;
}

/** A story per end-to-end journey: one step per stage, on its guide and the pages it uses. */
export function journeyStories(graph, linked) {
  const journeys = new Map();
  for (const guide of linked?.guides ?? []) {
    for (const name of guide.journeys) (journeys.get(name) ?? journeys.set(name, []).get(name)).push(guide);
  }
  return [...journeys].sort(([a], [b]) => a.localeCompare(b)).map(([name, unordered]) => [name, inOrder(unordered)]).map(([name, stages]) => ({
    id: `journey-${slug(name)}`,
    kind: "journey",
    title: name,
    summary: `The end-to-end journey "${name}": ${plural(stages.length, "stage")}, each a user guide and the pages it uses.`,
    steps: stages.map((guide) => {
      const who = [...guide.roles, ...guide.permissions];
      const pages = guide.pages.filter(({ key }) => graph.has(key));
      return {
        title: guide.title,
        text: `${guide.goal}${who.length ? ` Performed by ${who.join(", ")}.` : ""}`,
        lens: GUIDE_LENS,
        nodes: [graph.at(`guide::${guide.id}`), ...pages.map(({ key }) => graph.at(key))]
      };
    })
  }));
}
