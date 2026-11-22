// The layout of the graph of BC Atlas (graph.js): where the nodes stand. A
// simulation for "2d" and "3d" (nodes of one group pull together, relations
// pull their ends together, everything else pushes apart), and layers for
// "diagram". Deterministic: the same graph gets the same layout every time.
(function (root) {
  "use strict";

  const TAU = Math.PI * 2;
  const LINK = 70;
  const FULL_PAIRS = 700;
  const MAX_LABELS = 70;
  const BOX_HEIGHT = 30;
  const BOX_GAP = 12;
  const LAYER_GAP = 64;
  /** How far above the highest box the titles of the columns stand. */
  const HEAD_GAP = 34;

  // The same layout for the same graph, every time.
  function random(seed) {
    let state = seed >>> 0 || 1;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /**
   * Where the nodes start: each group around its own point on a sphere, so
   * the simulation only has to settle them.
   * @returns [{ x, y, z, vx, vy, vz }] by node index
   */
  function seed(nodes, groupCount) {
    const next = random(nodes.length * 31 + groupCount);
    const spread = LINK * Math.cbrt(Math.max(nodes.length, 1)) * 0.9;
    const centers = Array.from({ length: Math.max(groupCount, 1) }, (_, index) => {
      // Points spread evenly over a sphere.
      const y = groupCount > 1 ? 1 - (2 * (index + 0.5)) / groupCount : 0;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = index * 2.399963;
      return groupCount > 1 ? { x: Math.cos(angle) * ring * spread, y: y * spread, z: Math.sin(angle) * ring * spread } : { x: 0, y: 0, z: 0 };
    });
    return nodes.map((node) => {
      const center = centers[node.group ?? 0] ?? centers[0];
      const jitter = () => (next() - 0.5) * LINK * 1.6;
      return { x: center.x + jitter(), y: center.y + jitter(), z: center.z + jitter(), vx: 0, vy: 0, vz: 0 };
    });
  }

  /**
   * One step of the simulation over the visible nodes.
   * @param flat true keeps everything in one plane (2D)
   */
  function step(points, nodes, edges, visible, shown, alpha, flat, pinned, next) {
    const ids = [];
    for (let index = 0; index < points.length; index++) if (visible[index]) ids.push(index);
    const count = ids.length;
    if (!count) return;
    const push = (a, b, scale) => {
      const p = points[a];
      const q = points[b];
      let dx = p.x - q.x;
      let dy = p.y - q.y;
      let dz = flat ? 0 : p.z - q.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.01) {
        dx = next() - 0.5;
        dy = next() - 0.5;
        dz = flat ? 0 : next() - 0.5;
        d2 = dx * dx + dy * dy + dz * dz + 0.01;
      }
      const force = Math.min(2400 * alpha * scale / d2, 6) / Math.sqrt(d2);
      p.vx += dx * force;
      p.vy += dy * force;
      p.vz += dz * force;
      return force;
    };
    if (count <= FULL_PAIRS) {
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          const p = points[ids[a]];
          const q = points[ids[b]];
          const before = [p.vx, p.vy, p.vz];
          push(ids[a], ids[b], 1);
          q.vx -= p.vx - before[0];
          q.vy -= p.vy - before[1];
          q.vz -= p.vz - before[2];
        }
      }
    } else {
      // Many nodes: each is pushed by a sample, weighted as if by all.
      const sample = Math.max(24, Math.floor(260000 / count));
      for (const a of ids) {
        for (let turn = 0; turn < sample; turn++) {
          const b = ids[Math.floor(next() * count)];
          if (b !== a) push(a, b, count / sample);
        }
      }
    }
    for (const [from, to, kind] of edges) {
      if (!visible[from] || !visible[to] || !shown[kind]) continue;
      const p = points[from];
      const q = points[to];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = flat ? 0 : q.z - p.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const pull = (distance - LINK) * 0.05 * alpha / distance;
      p.vx += dx * pull;
      p.vy += dy * pull;
      p.vz += dz * pull;
      q.vx -= dx * pull;
      q.vy -= dy * pull;
      q.vz -= dz * pull;
    }
    // A group holds together, and everything stays near the middle.
    const centers = new Map();
    for (const index of ids) {
      const group = nodes[index].group ?? 0;
      const center = centers.get(group) ?? centers.set(group, { x: 0, y: 0, z: 0, count: 0 }).get(group);
      center.x += points[index].x;
      center.y += points[index].y;
      center.z += points[index].z;
      center.count++;
    }
    for (const index of ids) {
      const point = points[index];
      if (pinned.has(index)) {
        point.vx = point.vy = point.vz = 0;
        continue;
      }
      const center = centers.get(nodes[index].group ?? 0);
      const hold = centers.size > 1 ? 0.035 * alpha : 0;
      point.vx += (center.x / center.count - point.x) * hold - point.x * 0.012 * alpha;
      point.vy += (center.y / center.count - point.y) * hold - point.y * 0.012 * alpha;
      point.vz += (center.z / center.count - point.z) * hold - point.z * 0.012 * alpha;
      point.vx *= 0.62;
      point.vy *= 0.62;
      point.vz *= 0.62;
      point.x += point.vx;
      point.y += point.vy;
      point.z = flat ? point.z * 0.8 : point.z + point.vz;
    }
  }

  /**
   * The diagram: the visible nodes in layers from left to right, in the
   * direction of their relations, as boxes that do not overlap. Relations
   * that would close a circle are turned for the layering only. A relation
   * that passes layers gets a point in each, so it runs between the boxes
   * and not behind them. Nodes without a relation stand in rows below.
   * @param widthOf the width of the box of a node, by index
   * @returns { boxes: [{ x, y, w, h }] by node index (the middle of each box; undefined for hidden nodes),
   *   routes: Map "from>to" -> [{ x, y }] the points a relation passes }
   */
  function layered(nodes, edges, visible, shown, widthOf, heads) {
    const ids = [];
    for (let index = 0; index < nodes.length; index++) if (visible[index]) ids.push(index);
    // Nodes that name their column (rank) stand in it: the picture has fixed columns, with a title each.
    const ranked = ids.some((index) => nodes[index].rank !== undefined);
    const rankOf = (index) => nodes[index].rank ?? 0;
    const out = new Map(ids.map((index) => [index, new Set()]));
    const into = new Map(ids.map((index) => [index, new Set()]));
    for (const [from, to, kind] of edges) {
      if (from === to || !visible[from] || !visible[to] || !shown[kind]) continue;
      if (ranked && rankOf(from) === rankOf(to)) continue;
      // The second of two opposite relations follows the first.
      if (out.get(to).has(from)) continue;
      out.get(from).add(to);
      into.get(to).add(from);
    }
    const byName = (a, b) => (nodes[a].group ?? 0) - (nodes[b].group ?? 0) || String(nodes[a].label).localeCompare(String(nodes[b].label)) || a - b;
    const connected = ids.filter((index) => ranked || out.get(index).size || into.get(index).size).sort(byName);
    const alone = ranked ? [] : ids.filter((index) => !out.get(index).size && !into.get(index).size).sort(byName);

    // Depth first: a relation back to a node on the way closes a circle.
    const state = new Map();
    const back = new Set();
    const roots = connected.slice().sort((a, b) => into.get(a).size - into.get(b).size || byName(a, b));
    // In columns a relation runs from the column on the left to the one on the right.
    if (ranked) for (const from of connected) for (const to of out.get(from)) if (rankOf(from) > rankOf(to)) back.add(`${from}>${to}`);
    for (const start of roots) {
      if (ranked || state.has(start)) continue;
      const stack = [[start, [...out.get(start)].sort(byName), 0]];
      state.set(start, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top[2] < top[1].length) {
          const target = top[1][top[2]++];
          if (!state.has(target)) {
            state.set(target, 1);
            stack.push([target, [...out.get(target)].sort(byName), 0]);
          } else if (state.get(target) === 1) back.add(`${top[0]}>${target}`);
        } else {
          state.set(top[0], 2);
          stack.pop();
        }
      }
    }
    // The relations as they run through the layers: [from, to, turned].
    const flow = [];
    const after = new Map(connected.map((index) => [index, []]));
    const before = new Map(connected.map((index) => [index, []]));
    for (const from of connected) {
      for (const to of out.get(from)) {
        const turned = back.has(`${from}>${to}`);
        const [a, b] = turned ? [to, from] : [from, to];
        flow.push([a, b, turned]);
        after.get(a).push(b);
        before.get(b).push(a);
      }
    }
    // The longest way to a node gives its layer.
    const layer = new Map(connected.map((index) => [index, 0]));
    const waiting = new Map(connected.map((index) => [index, before.get(index).length]));
    const ready = connected.filter((index) => !waiting.get(index));
    const order = [];
    while (ready.length) {
      const from = ready.shift();
      order.push(from);
      for (const to of after.get(from)) {
        if (layer.get(to) < layer.get(from) + 1) layer.set(to, layer.get(from) + 1);
        waiting.set(to, waiting.get(to) - 1);
        if (!waiting.get(to)) ready.push(to);
      }
    }
    // What nothing points at stands right before what it points at.
    for (const from of order.slice().reverse()) {
      if (!before.get(from).length && after.get(from).length) layer.set(from, Math.min(...after.get(from).map((to) => layer.get(to))) - 1);
    }
    const lowest = Math.min(0, ...layer.values());
    for (const index of connected) layer.set(index, layer.get(index) - lowest);
    const ranks = [...new Set(connected.map(rankOf))].sort((a, b) => a - b);
    if (ranked) for (const index of connected) layer.set(index, ranks.indexOf(rankOf(index)));

    // Columns of items: a node (its index) or a point of a long relation (below zero).
    const columns = [];
    const left = new Map();
    const right = new Map();
    const link = (a, b) => {
      (right.get(a) ?? right.set(a, []).get(a)).push(b);
      (left.get(b) ?? left.set(b, []).get(b)).push(a);
    };
    for (const index of connected) (columns[layer.get(index)] ??= []).push(index);
    for (let column = 0; column < columns.length; column++) columns[column] ??= [];
    // A column whose nodes name their order keeps it: the steps of a process, top to bottom.
    const ordered = columns.map((column) => column.length > 0 && column.every((index) => nodes[index].order !== undefined));
    columns.forEach((column, at) => { if (ordered[at]) column.sort((a, b) => nodes[a].order - nodes[b].order); });
    const routing = connected.length <= 600;
    const passes = [];
    let points = 0;
    for (const [from, to, turned] of flow) {
      const span = layer.get(to) - layer.get(from);
      if (span <= 1 || !routing) {
        link(from, to);
        continue;
      }
      const chain = [];
      let previous = from;
      for (let column = layer.get(from) + 1; column < layer.get(to); column++) {
        const point = -1 - points++;
        columns[column].push(point);
        chain.push(point);
        link(previous, point);
        previous = point;
      }
      link(previous, to);
      passes.push([turned ? `${to}>${from}` : `${from}>${to}`, turned ? chain.slice().reverse() : chain]);
    }

    // Fewer crossings: each item moves to the middle of its neighbors in the column before, then after.
    const rank = new Map();
    columns.forEach((column) => column.forEach((item, at) => rank.set(item, at)));
    const tie = (a, b) => (a < 0 || b < 0 ? a - b : byName(a, b));
    for (let sweep = 0; sweep < 8; sweep++) {
      const forward = sweep % 2 === 0;
      const turn = forward ? columns.slice(1) : columns.slice(0, -1).reverse();
      for (const column of turn) {
        if (ordered[columns.indexOf(column)]) continue;
        const wanted = new Map(column.map((item) => {
          const near = (forward ? left : right).get(item) ?? [];
          return [item, near.length ? near.reduce((sum, other) => sum + rank.get(other), 0) / near.length : rank.get(item)];
        }));
        column.sort((a, b) => wanted.get(a) - wanted.get(b) || tie(a, b));
        column.forEach((item, at) => rank.set(item, at));
      }
    }

    // Places: a column with very many nodes takes several.
    const most = ranked ? 30 : Math.max(14, Math.ceil(Math.sqrt(connected.length) * 1.8));
    const spot = new Map();
    const heightOf = (item) => (item < 0 ? 8 : BOX_HEIGHT);
    const parts = [];
    let x = 0;
    const spans = [];
    for (const column of columns) {
      spans.push([x, x]);
      for (let start = 0; start < column.length; start += most) {
        const part = column.slice(start, start + most);
        const width = Math.max(24, ...part.map((item) => (item < 0 ? 0 : widthOf(item))));
        let y = 0;
        for (const item of part) {
          y += heightOf(item) / 2;
          spot.set(item, { x: x + width / 2, y });
          y += heightOf(item) / 2 + BOX_GAP;
        }
        const shift = (y - BOX_GAP) / 2;
        for (const item of part) spot.get(item).y -= shift;
        parts.push(part);
        part.left = x;
        part.width = width;
        spans.at(-1)[1] = x + width;
        x += width + LAYER_GAP;
      }
    }
    // Each item moves toward the middle of what it is related to, keeping its place in the column.
    for (let pass = 0; pass < 6; pass++) {
      for (const part of pass % 2 === 0 ? parts : parts.slice().reverse()) {
        const wanted = part.map((item) => {
          const near = [...(left.get(item) ?? []), ...(right.get(item) ?? [])];
          return near.length ? near.reduce((sum, other) => sum + spot.get(other).y, 0) / near.length : spot.get(item).y;
        });
        const apart = (at) => (heightOf(part[at]) + heightOf(part[at - 1])) / 2 + BOX_GAP;
        // Pushed down from the top and up from the bottom; the middle of both keeps the distance.
        const down = [];
        for (let at = 0; at < part.length; at++) down.push(at ? Math.max(wanted[at], down[at - 1] + apart(at)) : wanted[at]);
        let following;
        for (let at = part.length - 1; at >= 0; at--) {
          following = at === part.length - 1 ? wanted[at] : Math.min(wanted[at], following - apart(at + 1));
          spot.get(part[at]).y = (down[at] + following) / 2;
        }
      }
    }
    // Many layers in a row are a ribbon nobody can read: they break into lines, like text.
    const reach = (part) => {
      let low = Infinity;
      let high = -Infinity;
      for (const item of part) {
        low = Math.min(low, spot.get(item).y - heightOf(item) / 2);
        high = Math.max(high, spot.get(item).y + heightOf(item) / 2);
      }
      return [low, high];
    };
    const tall = parts.reduce((most, part) => Math.max(most, reach(part)[1] - reach(part)[0]), BOX_HEIGHT);
    const lines = parts.length > 12 && x / tall > 3.2 ? Math.ceil(Math.sqrt(x / tall / 1.7)) : 1;
    if (lines > 1) {
      const lineWidth = x / lines;
      let start = 0;
      let down = 0;
      let line = [];
      const close = () => {
        const [low, high] = line.reduce(([a, b], part) => [Math.min(a, reach(part)[0]), Math.max(b, reach(part)[1])], [Infinity, -Infinity]);
        for (const part of line) {
          for (const item of part) {
            const place = spot.get(item);
            place.x -= start;
            place.y += down - low;
          }
        }
        down += high - low + (BOX_HEIGHT + BOX_GAP) * 2.5;
        line = [];
      };
      for (const part of parts) {
        if (line.length && part.left + part.width - start > lineWidth) {
          close();
          start = part.left;
        }
        line.push(part);
      }
      close();
      x = lineWidth + LAYER_GAP;
    }
    const boxes = new Array(nodes.length);
    let top = Infinity;
    let bottom = -Infinity;
    for (const index of connected) {
      const { x: centerX, y } = spot.get(index);
      boxes[index] = { x: centerX, y, w: widthOf(index), h: BOX_HEIGHT };
      top = Math.min(top, y - BOX_HEIGHT / 2);
      bottom = Math.max(bottom, y + BOX_HEIGHT / 2);
    }
    if (!connected.length) top = bottom = 0;

    // Nodes without a relation: rows below, as wide as the layers above.
    if (alone.length) {
      const pitch = BOX_HEIGHT + BOX_GAP;
      const total = Math.max(x - LAYER_GAP, 640);
      let across = 0;
      let y = bottom + (connected.length ? pitch * 1.5 : 0) + BOX_HEIGHT / 2;
      for (const node of alone) {
        const width = widthOf(node);
        if (across && across + width > total) {
          across = 0;
          y += pitch;
        }
        boxes[node] = { x: across + width / 2, y, w: width, h: BOX_HEIGHT };
        across += width + BOX_GAP * 1.5;
      }
      bottom = y + BOX_HEIGHT / 2;
    }
    // Around the middle.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const node of ids) {
      minX = Math.min(minX, boxes[node].x - boxes[node].w / 2);
      maxX = Math.max(maxX, boxes[node].x + boxes[node].w / 2);
    }
    const shiftX = ids.length ? (minX + maxX) / 2 : 0;
    const shiftY = ids.length ? (top + bottom) / 2 : 0;
    for (const node of ids) {
      boxes[node].x -= shiftX;
      boxes[node].y -= shiftY;
    }
    const routes = new Map(passes.map(([key, chain]) => [key, chain.map((point) => ({ x: spot.get(point).x - shiftX, y: spot.get(point).y - shiftY }))]));
    // The title of each column, above the highest box.
    const titles = ranked && heads?.length
      ? ranks.map((rank, at) => ({ title: heads.find((head) => head.rank === rank)?.title, count: columns[at].filter((item) => item >= 0).length, x: (spans[at][0] + spans[at][1]) / 2 - shiftX, y: top - shiftY - HEAD_GAP })).filter(({ title }) => title)
      : undefined;
    return { boxes, routes, heads: titles };
  }

  root.BCA_GRAPH_LAYOUT = { TAU, LINK, MAX_LABELS, random, seed, step, layered };
})(globalThis);
