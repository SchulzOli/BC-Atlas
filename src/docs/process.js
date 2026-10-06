// Process models in BPMN 2.0 terms, built from the documentation catalog:
//
//   scenario flow     start -> one user task per click -> end
//                     ([THEN] between [WHEN] phases becomes an intermediate
//                     event, a repeated block a task with a loop marker)
//   use-case process  one pool per [FEATURE], one lane per permission set,
//                     one collapsed sub-process per scenario; [NEXT] and
//                     [REQUIRES] give the sequence, [ALTERNATIVE] branches
//                     through an exclusive gateway
//
// layoutProcess() places both on a grid. The BPMN XML (render/bpmn.js) and
// the SVG preview (render/process-svg.js) share that layout, so the file a
// modeler opens looks like the picture in the documentation.
import { label, plainText } from "./phrases.js";

export const SIZE = Object.freeze({
  task: { width: 140, height: 72 },
  subprocess: { width: 160, height: 84 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 }
});

const GAP = 56;
const ROW = 128;
const BAND = 30;
const MARGIN = 24;

function text(tokens) {
  return Array.isArray(tokens) ? plainText(tokens) : String(tokens ?? "");
}

function shortOf(step) {
  return step.short ? text(step.short) : text(step.cmd).replace(/\.$/u, "");
}

function builder(prefix) {
  const nodes = [];
  const flows = [];
  let counter = 0;
  // IDs must be XML names: they start with the element kind, never a digit.
  const id = (kind) => `${kind}_${prefix}${++counter}`;
  return {
    nodes,
    flows,
    node(kind, props = {}) {
      const node = { id: props.id ?? id(kind === "subprocess" ? "Activity" : kind.charAt(0).toUpperCase() + kind.slice(1)), kind, ...props };
      nodes.push(node);
      return node;
    },
    flow(from, to, props = {}) {
      flows.push({ id: id("Flow"), from: from.id, to: to.id, ...props });
    }
  };
}

/** Clicks of a task, in order; phases contribute their items and results. */
function clickNodes(task, add) {
  const out = [];
  const click = (step) => {
    const loop = Boolean(step.items?.length);
    out.push(add("task", {
      name: shortOf(step),
      user: true,
      loop,
      documentation: [text(step.cmd), ...(step.items ?? []).map((item) => `- ${text(item.cmd)}`)].join("\n")
    }));
  };
  for (const [index, step] of task.steps.entries()) {
    if (!step.phase) {
      click(step);
      continue;
    }
    for (const item of step.items) click(item);
    if (index < task.steps.length - 1 && step.result?.length) {
      out.push(add("event", { name: step.result.join(" ") }));
    }
  }
  return out;
}

/** Linear BPMN process for one scenario. */
export function scenarioProcess(task, { prefix = "" } = {}) {
  const b = builder(prefix);
  const start = b.node("start", { name: "" });
  const middle = clickNodes(task, (kind, props) => b.node(kind, props));
  const end = b.node("end", { name: task.result.join(" ") });
  const chain = [start, ...middle, end];
  for (let index = 1; index < chain.length; index += 1) b.flow(chain[index - 1], chain[index]);
  return { id: `Process_${task.id}`, name: task.title, lanes: [], nodes: b.nodes, flows: b.flows };
}

function laneName(task, language) {
  return task.permissions.length ? [...task.permissions].sort().join(", ") : label(language, "process.user");
}

function reachable(adjacency, from, to, skip) {
  const stack = [from];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    for (const next of adjacency.get(current) ?? []) {
      if (current === from && next === skip) continue;
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * BPMN collaboration for one use case. Each scenario is a collapsed
 * sub-process whose children are that scenario's clicks.
 */
export function useCaseProcess(useCase, catalog) {
  const { language } = catalog;
  const order = new Map(catalog.tasks.map((task, index) => [task.id, index]));
  const members = [...useCase.main, ...useCase.alternatives]
    .filter((task, index, all) => all.findIndex(({ id }) => id === task.id) === index)
    .sort((left, right) => order.get(left.id) - order.get(right.id));
  const ids = new Set(members.map(({ id }) => id));
  const position = new Map(members.map((task, index) => [task.id, index]));

  // Sequence between scenarios: [NEXT] a -> b, b [REQUIRES] a. Only forward
  // edges in catalog order, so the process is always acyclic.
  const edges = new Map(members.map(({ id }) => [id, new Set()]));
  const addEdge = (from, to) => {
    if (from !== to && ids.has(from) && ids.has(to) && position.get(from) < position.get(to)) edges.get(from).add(to);
  };
  for (const task of members) {
    for (const { id } of task.links.next) addEdge(task.id, id);
    for (const { id } of task.requires) addEdge(id, task.id);
  }
  // An alternative takes the same place in the process as the scenario it replaces.
  for (const task of members) {
    for (const { id: alternative } of task.links.alternative) {
      if (!ids.has(alternative) || alternative === task.id) continue;
      for (const [from, targets] of edges) {
        if (targets.has(task.id) && from !== alternative) targets.add(alternative);
      }
      for (const target of edges.get(task.id)) if (target !== alternative) edges.get(alternative).add(target);
    }
  }
  // Transitive reduction keeps the diagram readable.
  for (const [from, targets] of edges) {
    for (const to of [...targets]) if (reachable(edges, from, to, to)) targets.delete(to);
  }

  const b = builder("");
  const lanes = [];
  const laneOf = new Map();
  for (const task of members) {
    const name = laneName(task, language);
    if (!laneOf.has(name)) {
      const lane = { id: `Lane_${lanes.length + 1}`, name };
      lanes.push(lane);
      laneOf.set(name, lane);
    }
  }
  const nodeOf = new Map();
  const start = b.node("start", { name: "" });
  for (const task of members) {
    nodeOf.set(task.id, b.node("subprocess", {
      id: `Activity_${task.id}`,
      name: task.title,
      lane: laneOf.get(laneName(task, language)).id,
      task,
      documentation: task.goal,
      child: scenarioProcess(task, { prefix: `${task.id}_` })
    }));
  }
  const end = b.node("end", { name: "" });

  const outgoing = new Map();
  const incoming = new Map();
  const connect = (from, to) => {
    if (!outgoing.has(from)) outgoing.set(from, []);
    if (!incoming.has(to)) incoming.set(to, []);
    outgoing.get(from).push(to);
    incoming.get(to).push(from);
  };
  for (const [from, targets] of edges) for (const to of targets) connect(nodeOf.get(from), nodeOf.get(to));
  for (const task of members) {
    const node = nodeOf.get(task.id);
    if (!incoming.has(node)) connect(start, node);
    if (!outgoing.has(node)) connect(node, end);
  }
  // A choice between paths becomes an exclusive gateway.
  for (const source of [start, ...members.map(({ id }) => nodeOf.get(id))]) {
    const targets = outgoing.get(source) ?? [];
    if (targets.length < 2) {
      for (const target of targets) b.flow(source, target);
      continue;
    }
    const gateway = b.node("gateway", { name: "", lane: source.lane });
    b.flow(source, gateway);
    for (const target of targets) b.flow(gateway, target);
  }
  return {
    id: `Process_${useCase.id}`,
    name: useCase.title,
    participant: `Participant_${useCase.id}`,
    lanes,
    nodes: b.nodes,
    flows: b.flows
  };
}

function ranks(process) {
  const incoming = new Map(process.nodes.map(({ id }) => [id, 0]));
  const outgoing = new Map(process.nodes.map(({ id }) => [id, []]));
  for (const flow of process.flows) {
    incoming.set(flow.to, incoming.get(flow.to) + 1);
    outgoing.get(flow.from).push(flow.to);
  }
  const rank = new Map(process.nodes.map(({ id }) => [id, 0]));
  const queue = process.nodes.filter(({ id }) => incoming.get(id) === 0).map(({ id }) => id);
  while (queue.length) {
    const current = queue.shift();
    for (const next of outgoing.get(current)) {
      rank.set(next, Math.max(rank.get(next), rank.get(current) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  return rank;
}

/** Lane of events and gateways: the lane of the work they lead to or follow. */
function assignLanes(process) {
  if (!process.lanes.length) return;
  const byId = new Map(process.nodes.map((node) => [node.id, node]));
  const successors = (id) => process.flows.filter(({ from }) => from === id).map(({ to }) => byId.get(to));
  const predecessors = (id) => process.flows.filter(({ to }) => to === id).map(({ from }) => byId.get(from));
  const find = (node, step, seen = new Set()) => {
    if (node.lane) return node.lane;
    if (seen.has(node.id)) return undefined;
    seen.add(node.id);
    for (const next of step(node.id)) {
      const lane = find(next, step, seen);
      if (lane) return lane;
    }
    return undefined;
  };
  for (const node of process.nodes.filter(({ lane }) => !lane)) {
    node.lane = (node.kind === "start" ? find(node, successors) : find(node, predecessors) ?? find(node, successors))
      ?? process.lanes[0].id;
  }
}

/**
 * Places nodes on a grid: columns by longest path from the start, rows by
 * lane. Returns bounds for every node, waypoints for every flow, and the pool
 * and lane rectangles.
 */
export function layoutProcess(process, { perRow = 6 } = {}) {
  assignLanes(process);
  const rank = ranks(process);
  const pooled = process.lanes.length > 0;
  if (!pooled) return layoutRows(process, rank, perRow);
  const lanes = pooled ? process.lanes : [{ id: "", name: "" }];
  const laneKey = (node) => (pooled ? node.lane : "");

  const columns = Math.max(...process.nodes.map(({ id }) => rank.get(id))) + 1;
  const widths = Array.from({ length: columns }, () => 0);
  for (const node of process.nodes) widths[rank.get(node.id)] = Math.max(widths[rank.get(node.id)], sizeOf(node).width);
  const left = MARGIN + (pooled ? BAND * 2 : 0) + (pooled ? 24 : 0);
  const columnX = [];
  let x = left;
  for (const width of widths) {
    columnX.push(x);
    x += width + GAP;
  }
  const contentRight = x - GAP + (pooled ? 24 : 0);

  const cells = new Map();
  for (const node of process.nodes) {
    const key = `${laneKey(node)}\u0000${rank.get(node.id)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(node);
  }
  const laneRows = new Map(lanes.map((lane) => [lane.id, 1]));
  for (const [key, members] of cells) {
    const lane = key.split("\u0000")[0];
    laneRows.set(lane, Math.max(laneRows.get(lane), members.length));
  }

  const laneBounds = [];
  let y = MARGIN;
  for (const lane of lanes) {
    const height = laneRows.get(lane.id) * ROW;
    laneBounds.push({ ...lane, x: MARGIN + (pooled ? BAND : 0), y, width: contentRight - MARGIN - (pooled ? BAND : 0), height });
    y += height;
  }
  const laneTop = new Map(laneBounds.map((lane) => [lane.id, lane]));

  const bounds = new Map();
  for (const [key, members] of cells) {
    const [laneId, column] = key.split("\u0000");
    const lane = laneTop.get(laneId);
    members.forEach((node, index) => {
      const size = sizeOf(node);
      const centerX = columnX[Number(column)] + widths[Number(column)] / 2;
      const centerY = lane.y + lane.height / 2 + (index - (members.length - 1) / 2) * ROW;
      bounds.set(node.id, {
        x: Math.round(centerX - size.width / 2),
        y: Math.round(centerY - size.height / 2),
        width: size.width,
        height: size.height
      });
    });
  }

  const byId = new Map(process.nodes.map((node) => [node.id, node]));
  const waypoints = new Map();
  for (const flow of process.flows) {
    const source = bounds.get(flow.from);
    const target = bounds.get(flow.to);
    const sy = source.y + source.height / 2;
    const ty = target.y + target.height / 2;
    const tx = target.x;
    if (Math.abs(sy - ty) < 1) {
      waypoints.set(flow.id, [[source.x + source.width, sy], [tx, ty]]);
    } else if (byId.get(flow.from).kind === "gateway") {
      // Leave a split gateway from its top or bottom corner.
      const cx = source.x + source.width / 2;
      waypoints.set(flow.id, [[cx, ty < sy ? source.y : source.y + source.height], [cx, ty], [tx, ty]]);
    } else if (byId.get(flow.to).kind === "gateway" || byId.get(flow.to).kind === "end") {
      const cx = target.x + target.width / 2;
      waypoints.set(flow.id, [[source.x + source.width, sy], [cx, sy], [cx, ty < sy ? target.y + target.height : target.y]]);
    } else {
      const mid = source.x + source.width + GAP / 2;
      waypoints.set(flow.id, [[source.x + source.width, sy], [mid, sy], [mid, ty], [tx, ty]]);
    }
  }

  const height = y + MARGIN + (pooled ? 0 : 28);
  const pool = pooled
    ? { x: MARGIN, y: MARGIN, width: contentRight - MARGIN, height: y - MARGIN }
    : undefined;
  return {
    process,
    bounds,
    waypoints,
    lanes: pooled ? laneBounds : [],
    pool,
    width: contentRight + MARGIN,
    height
  };
}

function sizeOf(node) {
  return SIZE[node.kind === "start" || node.kind === "end" ? "event" : node.kind];
}

/**
 * A flow without lanes reads like text: left to right, wrapping into a new
 * row after `perRow` elements so long scenarios stay legible on a page.
 */
function layoutRows(process, rank, perRow) {
  const columns = Math.min(perRow, Math.max(...process.nodes.map(({ id }) => rank.get(id))) + 1);
  const widths = Array.from({ length: columns }, () => 0);
  for (const node of process.nodes) {
    const column = rank.get(node.id) % perRow;
    widths[column] = Math.max(widths[column], sizeOf(node).width);
  }
  const columnX = [];
  let x = MARGIN;
  for (const width of widths) {
    columnX.push(x);
    x += width + GAP;
  }
  const rowHeight = 132;
  const bounds = new Map();
  let rows = 0;
  for (const node of process.nodes) {
    const size = sizeOf(node);
    const row = Math.floor(rank.get(node.id) / perRow);
    const column = rank.get(node.id) % perRow;
    rows = Math.max(rows, row + 1);
    const centerX = columnX[column] + widths[column] / 2;
    const centerY = MARGIN + 44 + row * rowHeight;
    bounds.set(node.id, {
      x: Math.round(centerX - size.width / 2),
      y: Math.round(centerY - size.height / 2),
      width: size.width,
      height: size.height
    });
  }
  const waypoints = new Map();
  for (const flow of process.flows) {
    const source = bounds.get(flow.from);
    const target = bounds.get(flow.to);
    const sy = source.y + source.height / 2;
    const ty = target.y + target.height / 2;
    if (Math.abs(sy - ty) < 1) {
      waypoints.set(flow.id, [[source.x + source.width, sy], [target.x, ty]]);
    } else {
      // Line break: out to the right, down below the row and its labels,
      // back to the first column, and into the next element from above.
      const right = source.x + source.width + GAP / 2;
      const tx = target.x + target.width / 2;
      const turn = Math.round(target.y - 18);
      waypoints.set(flow.id, [[source.x + source.width, sy], [right, sy], [right, turn], [tx, turn], [tx, target.y]]);
    }
  }
  const labelRoom = 48;
  return {
    process,
    bounds,
    waypoints,
    lanes: [],
    pool: undefined,
    width: x - GAP + MARGIN + labelRoom,
    height: MARGIN + 44 + (rows - 1) * rowHeight + 36 + labelRoom + MARGIN
  };
}
