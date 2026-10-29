// Large diagrams as an overview: every group that is not expanded becomes
// one box, and the relations into, out of, and between them are bundled per
// kind with a count, so a view of thousands of objects stays readable and
// the groups can be opened one at a time.

// Above either size a view starts as the overview of its groups.
export const OVERVIEW = Object.freeze({ objects: 120, relations: 250 });

const TYPE_ORDER = ["table", "page", "codeunit", "report", "query", "xmlport", "enum", "interface"];

function summary(nodes) {
  const counts = new Map();
  for (const { type } of nodes) if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]))
    .slice(0, 3)
    .map(([type, count]) => `${count} ${type}`)
    .join(" · ");
}

/** True when a scene is large enough to start as the overview of its groups. */
export function startsCollapsed(scene) {
  const objects = scene.groups.reduce((total, { nodes }) => total + nodes.length, 0);
  return scene.groups.length > 1 && (objects > OVERVIEW.objects || scene.edges.length > OVERVIEW.relations);
}

/**
 * @param scene from buildScene
 * @param expanded the keys of the groups that stay open
 */
export function collapseScene(scene, expanded = new Set()) {
  const owner = new Map();
  const groups = [];
  const boxes = [];
  for (const group of scene.groups) {
    if (expanded.has(group.key) || group.bare) {
      groups.push(group);
      continue;
    }
    const path = `collapsed.${group.key}`;
    for (const node of group.nodes) owner.set(node.path, path);
    boxes.push({
      key: group.key,
      path,
      collapsed: group.key,
      label: `${group.label}\n${group.nodes.length === 1 ? "1 object" : `${group.nodes.length} objects`}${group.nodes.length > 1 ? `\n${summary(group.nodes)}` : ""}`,
      titleFirst: true,
      fill: group.external ? "#ffffff" : "#eef2f7",
      stroke: "#64748b",
      strokeWidth: 1.6,
      ...(group.external ? { dash: 5 } : {})
    });
  }
  if (boxes.length) groups.push({ key: "collapsed", label: "", bare: true, nodes: boxes });

  const closed = new Set(boxes.map(({ path }) => path));
  const bundles = new Map();
  for (const edge of scene.edges) {
    const from = owner.get(edge.from) ?? edge.from;
    const to = owner.get(edge.to) ?? edge.to;
    // Relations inside one closed group are part of the box.
    if (from === to && (owner.has(edge.from) || owner.has(edge.to))) continue;
    if (from === edge.from && to === edge.to) {
      bundles.set(`edge:${bundles.size}`, { edge: { ...edge } });
      continue;
    }
    // Between two closed groups one route carries every kind; to or from an
    // object, one route per kind keeps its color.
    const key = closed.has(from) && closed.has(to) ? `${from}\u0000${to}` : `${from}\u0000${to}\u0000${edge.kind}`;
    const bundle = bundles.get(key) ?? bundles.set(key, { from, to, kinds: new Map(), first: edge }).get(key);
    bundle.kinds.set(edge.kind, (bundle.kinds.get(edge.kind) ?? 0) + 1);
  }
  const edges = [...bundles.values()].map((bundle) => {
    if (bundle.edge) return bundle.edge;
    const kinds = [...bundle.kinds].sort((a, b) => b[1] - a[1]);
    const total = kinds.reduce((sum, [, count]) => sum + count, 0);
    const [kind] = kinds[0];
    // The route takes the style of its most frequent kind.
    const style = scene.edges.find((edge) => edge.kind === kind) ?? bundle.first;
    return {
      from: bundle.from,
      to: bundle.to,
      kind,
      arrow: "->",
      color: style.color,
      ...(style.dash ? { dash: style.dash } : {}),
      label: kinds.length > 1 ? `${total} relations` : total > 1 ? `${kind} (${total})` : bundle.first.label,
      width: Math.min(5, 1.2 + Math.log2(total) * 0.5),
      ...(kinds.length > 1 ? { kinds: Object.fromEntries(kinds) } : {}),
      tooltip: kinds.map(([name, count]) => `${name}: ${count}`).join("\n")
    };
  });
  return { ...scene, groups, edges };
}
