import test from "node:test";
import assert from "node:assert/strict";

// The graph of the view (src/app/ui/graph.js): its simulation and its diagram layout.
await import("../src/app/ui/graph.js");
const { seed, step, random, layered } = globalThis.BCA_GRAPH;

// Two groups of three, each a triangle, joined by one relation.
const nodes = [0, 0, 0, 1, 1, 1].map((group, index) => ({ label: `n${index}`, group }));
const edges = [[0, 1, 0, 1], [1, 2, 0, 1], [2, 0, 0, 1], [3, 4, 0, 1], [4, 5, 0, 1], [5, 3, 0, 1], [2, 3, 0, 1]];

function settle({ flat, visible = new Uint8Array(nodes.length).fill(1), shown = new Uint8Array([1]) }) {
  const points = seed(nodes, 2);
  const next = random(7);
  let alpha = 1;
  for (let turn = 0; turn < 400; turn++) {
    step(points, nodes, edges, visible, shown, alpha, flat, new Set(), next);
    alpha *= 0.985;
  }
  return points;
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const center = (points, ids) => ({
  x: ids.reduce((sum, id) => sum + points[id].x, 0) / ids.length,
  y: ids.reduce((sum, id) => sum + points[id].y, 0) / ids.length,
  z: ids.reduce((sum, id) => sum + points[id].z, 0) / ids.length
});

test("the same graph starts in the same place every time", () => {
  assert.deepEqual(seed(nodes, 2), seed(nodes, 2));
  assert.notDeepEqual(seed(nodes, 2)[0], seed(nodes, 2)[3], "groups start apart");
});

test("a 3D layout keeps groups together, related nodes near, and nothing on top of another", () => {
  const points = settle({ flat: false });
  assert.ok(points.every(({ x, y, z }) => [x, y, z].every(Number.isFinite)));
  const within = distance(points[0], points[1]);
  const between = distance(center(points, [0, 1, 2]), center(points, [3, 4, 5]));
  assert.ok(between > within, `groups (${between.toFixed(0)}) are further apart than neighbors (${within.toFixed(0)})`);
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) assert.ok(distance(points[a], points[b]) > 8, "no two nodes on the same spot");
  }
  assert.ok(points.some(({ z }) => Math.abs(z) > 5), "3D uses the depth");
});

test("a 2D layout is the same graph in one plane", () => {
  const points = settle({ flat: true });
  assert.ok(points.every(({ z }) => Math.abs(z) < 0.5), "everything settles into the plane");
  assert.ok(distance(points[2], points[3]) < distance(points[0], points[5]) * 1.5, "the relation between the groups holds them near");
});

test("hidden nodes and kinds of relation take no part in the layout", () => {
  const visible = new Uint8Array([1, 1, 1, 0, 0, 0]);
  const before = seed(nodes, 2);
  const points = settle({ flat: true, visible });
  assert.deepEqual(points.slice(3), before.slice(3), "a hidden node stays where it was");
  const apart = settle({ flat: true, shown: new Uint8Array([0]) });
  const joined = settle({ flat: true });
  assert.ok(distance(apart[2], apart[3]) > distance(joined[2], joined[3]), "without the relation between them, nothing pulls the two groups together");
});

// ------------------------------------------------------------- the diagram
const all = (count) => new Uint8Array(count).fill(1);
const named = (names) => names.map((label) => ({ label, group: 0 }));
const width = () => 100;
const overlap = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

test("a diagram puts the nodes in layers, in the direction of their relations", () => {
  // page -> codeunit -> table, and a second codeunit -> table
  const graph = named(["Page", "Codeunit", "Table", "Other"]);
  const { boxes, routes } = layered(graph, [[0, 1, 0, 1], [1, 2, 0, 1], [3, 2, 0, 1]], all(4), all(1), width);
  assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x, "what is used stands to the right of what uses it");
  assert.equal(boxes[3].x, boxes[1].x, "what nothing points at stands right before what it points at");
  assert.equal(routes.size, 0, "neighbors need no points in between");
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(!overlap(boxes[a], boxes[b]), "no two boxes overlap");
  // Around the middle, so the camera finds it.
  const xs = boxes.flatMap(({ x, w }) => [x - w / 2, x + w / 2]);
  assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs)) < 1);
});

test("a relation that passes a layer runs through a point in it, between the boxes", () => {
  // A -> B -> C and A -> C: the long relation gets a point in the layer of B.
  const { boxes, routes } = layered(named(["A", "B", "C"]), [[0, 1, 0, 1], [1, 2, 0, 1], [0, 2, 0, 1]], all(3), all(1), width);
  const route = routes.get("0>2");
  assert.equal(route.length, 1);
  assert.equal(route[0].x, boxes[1].x, "in the layer of B");
  assert.ok(Math.abs(route[0].y - boxes[1].y) >= boxes[1].h / 2, "above or below B, not behind it");
});

test("a circle of relations does not stop the layout", () => {
  const { boxes } = layered(named(["A", "B", "C"]), [[0, 1, 0, 1], [1, 2, 0, 1], [2, 0, 0, 1]], all(3), all(1), width);
  assert.ok(boxes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(new Set(boxes.map(({ x }) => x)).size, 3, "the relation that closes the circle is turned, so every node has its layer");
});

test("nodes without a relation stand in rows below, and hidden nodes take no place", () => {
  const graph = named(["A", "B", "Alone 1", "Alone 2", "Hidden"]);
  const visible = new Uint8Array([1, 1, 1, 1, 0]);
  const { boxes } = layered(graph, [[0, 1, 0, 1], [0, 4, 0, 1]], visible, all(1), width);
  assert.equal(boxes[4], undefined);
  assert.ok(boxes[2].y > Math.max(boxes[0].y, boxes[1].y) && boxes[3].y === boxes[2].y, "one row below the layers");
  assert.ok(!overlap(boxes[2], boxes[3]));
  // A kind of relation that is switched off connects nothing.
  const off = layered(graph, [[0, 1, 0, 1]], visible, new Uint8Array([0]), width);
  assert.equal(new Set([0, 1, 2, 3].map((index) => off.boxes[index].y)).size, 1, "all four in one row");
});

test("a large graph is laid out without boxes on top of each other", () => {
  const next = random(11);
  const count = 400;
  const graph = named(Array.from({ length: count }, (_, index) => `Node ${index}`));
  const edges = Array.from({ length: 900 }, () => [Math.floor(next() * count), Math.floor(next() * count), 0, 1]).filter(([from, to]) => from !== to);
  const { boxes } = layered(graph, edges, all(count), all(1), () => 80);
  const byColumn = new Map();
  for (const box of boxes) (byColumn.get(box.x) ?? byColumn.set(box.x, []).get(box.x)).push(box);
  for (const column of byColumn.values()) {
    column.sort((a, b) => a.y - b.y);
    for (let index = 1; index < column.length; index++) assert.ok(column[index].y - column[index - 1].y >= column[index].h - 0.001, "boxes of one column keep their distance");
  }
});
