import test from "node:test";
import assert from "node:assert/strict";

await import("../src/app/ui/board.js");
const { seed, step, random } = globalThis.BCA_BOARD;

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

test("the same board starts in the same place every time", () => {
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
