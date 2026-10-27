function edgeSignature(edge) {
  return JSON.stringify(Object.entries(edge.kinds ?? {}).sort()) + (edge.declared ? "|declared" : "");
}

function nodeSignature(node) {
  return [node.type, node.label, node.namespace, node.file, node.app].join("|");
}

function itemTracker({ signature, touched }) {
  const merged = new Map();
  return {
    add(items, frame, index) {
      const present = new Set();
      for (const item of items) {
        present.add(item.id);
        const entry = merged.get(item.id);
        if (!entry) {
          merged.set(item.id, { item, presence: [[index, null]], changes: [], signature: signature(item) });
          continue;
        }
        const open = entry.presence.at(-1)[1] === null;
        if (!open) entry.presence.push([index, null]);
        else if (entry.signature !== signature(item) || touched?.(item, frame)) entry.changes.push(index);
        entry.item = item;
        entry.signature = signature(item);
      }
      for (const [id, entry] of merged) {
        const span = entry.presence.at(-1);
        if (span[1] === null && !present.has(id)) span[1] = index;
      }
    },
    result() {
      return [...merged.values()].map(({ item, presence, changes }) => ({ ...item, presence, changes }));
    }
  };
}

/**
 * Merges lens results frame by frame into one temporal graph. Every node and
 * edge gets `presence` spans ([first frame, end frame or null]) and the frames
 * in which it changed, so a viewer can replay how the graph grew. Frames are
 * added one at a time, so a long history never holds more than one frame.
 */
export function createTemporalGraph() {
  const levels = new Map();
  let index = -1;
  const trackers = (level) => {
    if (!levels.has(level)) {
      levels.set(level, {
        nodes: itemTracker({
          signature: nodeSignature,
          touched: (node, frame) => Boolean(node.file && frame.changedFiles?.has(node.file))
        }),
        edges: itemTracker({ signature: edgeSignature })
      });
    }
    return levels.get(level);
  };
  return {
    add(frame) {
      index++;
      for (const level of Object.keys(frame.levels)) trackers(level);
      for (const [level, tracker] of levels) {
        tracker.nodes.add(frame.levels[level]?.nodes ?? [], frame, index);
        tracker.edges.add(frame.levels[level]?.edges ?? [], frame, index);
      }
    },
    result() {
      return Object.fromEntries([...levels].map(([level, tracker]) =>
        [level, { nodes: tracker.nodes.result(), edges: tracker.edges.result() }]));
    }
  };
}

export function mergeFrames(frames) {
  const temporal = createTemporalGraph();
  for (const frame of frames) temporal.add(frame);
  return temporal.result();
}

/** Adds per-frame counts of present, added, removed, and changed items. */
export function frameStatistics(levels, frameCount) {
  const statistics = Array.from({ length: frameCount }, () => ({
    nodes: 0, edges: 0, addedNodes: 0, removedNodes: 0, changedNodes: 0, addedEdges: 0, removedEdges: 0
  }));
  const level = levels.object ?? Object.values(levels)[0];
  for (const [items, prefix] of [[level.nodes, "Nodes"], [level.edges, "Edges"]]) {
    for (const item of items) {
      for (const [start, end] of item.presence) {
        statistics[start][`added${prefix}`]++;
        if (end !== null) statistics[end][`removed${prefix}`]++;
        for (let index = start; index < (end ?? frameCount); index++) statistics[index][prefix.toLowerCase()]++;
      }
      if (prefix === "Nodes") for (const index of item.changes) statistics[index].changedNodes++;
    }
  }
  return statistics;
}
