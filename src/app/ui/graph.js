// The graph of BC Atlas: any part of the atlas (src/app/atlas.js) on one
// canvas, in three forms. "2d" and "3d" are the same simulation in a plane
// or in space: nodes of one group pull together, relations pull their ends
// together, everything else pushes apart. "diagram" lays the same nodes out
// in layers, as boxes, in the direction of their relations. Selection,
// highlight, filter, and export are the same in all three.
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

  // ------------------------------------------------------------------ pens
  // A picture is drawn through a pen, so the canvas and the SVG export show the same.
  function canvasPen(context) {
    const rgba = (hex, opacity) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0")}`;
    return {
      clear(width, height, color) {
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
      },
      lines(points, color, opacity, width, dash) {
        if (!points.length) return;
        context.beginPath();
        for (let position = 0; position < points.length; position += 4) {
          context.moveTo(points[position], points[position + 1]);
          context.lineTo(points[position + 2], points[position + 3]);
        }
        context.strokeStyle = rgba(color, opacity);
        context.lineWidth = width;
        context.setLineDash(dash ? [4, 3] : []);
        context.stroke();
        context.setLineDash([]);
      },
      curves(points, color, opacity, width, dash) {
        if (!points.length) return;
        context.beginPath();
        for (let position = 0; position < points.length; position += 8) {
          context.moveTo(points[position], points[position + 1]);
          context.bezierCurveTo(points[position + 2], points[position + 3], points[position + 4], points[position + 5], points[position + 6], points[position + 7]);
        }
        context.strokeStyle = rgba(color, opacity);
        context.lineWidth = width;
        context.setLineDash(dash ? [4, 3] : []);
        context.stroke();
        context.setLineDash([]);
      },
      triangle(ax, ay, bx, by, cx, cy, color, opacity) {
        context.beginPath();
        context.moveTo(ax, ay);
        context.lineTo(bx, by);
        context.lineTo(cx, cy);
        context.fillStyle = rgba(color, opacity);
        context.fill();
      },
      circle(x, y, radius, fill, opacity, stroke, strokeWidth) {
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        if (fill) {
          context.fillStyle = rgba(fill, opacity);
          context.fill();
        }
        if (stroke) {
          context.lineWidth = strokeWidth;
          context.strokeStyle = stroke;
          context.stroke();
        }
      },
      ring(x, y, radius, color, opacity, width) {
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.lineWidth = width;
        context.strokeStyle = rgba(color, opacity);
        context.stroke();
      },
      box(x, y, width, height, radius, fill, opacity, stroke, strokeWidth, bar) {
        context.globalAlpha = opacity;
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        if (fill !== "none") {
          context.fillStyle = fill;
          context.fill();
        }
        if (bar) {
          context.save();
          context.clip();
          context.fillStyle = bar;
          context.fillRect(x, y, Math.max(3, height * 0.13), height);
          context.restore();
          context.beginPath();
          context.roundRect(x, y, width, height, radius);
        }
        context.lineWidth = strokeWidth;
        context.strokeStyle = stroke;
        context.stroke();
        context.globalAlpha = 1;
      },
      text(text, x, y, size, color, opacity, halo, font, anchor) {
        context.font = `${size}px ${font}`;
        context.textBaseline = "middle";
        context.textAlign = anchor === "middle" ? "center" : "left";
        context.globalAlpha = opacity;
        if (halo) {
          context.lineJoin = "round";
          context.strokeStyle = halo;
          context.lineWidth = 3;
          context.strokeText(text, x, y);
        }
        context.fillStyle = color;
        context.fillText(text, x, y);
        context.globalAlpha = 1;
        context.textAlign = "left";
      }
    };
  }

  function svgPen(parts) {
    const number = (value) => Math.round(value * 10) / 10;
    const escape = (value) => String(value).replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
    const stroke = (color, opacity, width, dash) => `fill="none" stroke="${color.slice(0, 7)}" stroke-opacity="${number(opacity * 100) / 100}" stroke-width="${width}"${dash ? ' stroke-dasharray="4 3"' : ""}`;
    return {
      clear(width, height, color) {
        parts.push(`<rect width="${number(width)}" height="${number(height)}" fill="${color}"/>`);
      },
      lines(points, color, opacity, width, dash) {
        if (!points.length) return;
        let path = "";
        for (let position = 0; position < points.length; position += 4) path += `M${number(points[position])} ${number(points[position + 1])}L${number(points[position + 2])} ${number(points[position + 3])}`;
        parts.push(`<path d="${path}" ${stroke(color, opacity, width, dash)}/>`);
      },
      curves(points, color, opacity, width, dash) {
        if (!points.length) return;
        let path = "";
        for (let position = 0; position < points.length; position += 8) path += `M${number(points[position])} ${number(points[position + 1])}C${number(points[position + 2])} ${number(points[position + 3])} ${number(points[position + 4])} ${number(points[position + 5])} ${number(points[position + 6])} ${number(points[position + 7])}`;
        parts.push(`<path d="${path}" ${stroke(color, opacity, width, dash)}/>`);
      },
      triangle(ax, ay, bx, by, cx, cy, color, opacity) {
        parts.push(`<path d="M${number(ax)} ${number(ay)}L${number(bx)} ${number(by)}L${number(cx)} ${number(cy)}Z" fill="${color.slice(0, 7)}" fill-opacity="${number(opacity * 100) / 100}"/>`);
      },
      circle(x, y, radius, fill, opacity, strokeColor, strokeWidth) {
        parts.push(`<circle cx="${number(x)}" cy="${number(y)}" r="${number(radius)}" fill="${fill ? fill.slice(0, 7) : "none"}"${fill ? ` fill-opacity="${number(opacity * 100) / 100}"` : ""}${strokeColor ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}"` : ""}/>`);
      },
      ring(x, y, radius, color, opacity, width) {
        parts.push(`<circle cx="${number(x)}" cy="${number(y)}" r="${number(radius)}" ${stroke(color, opacity, width)}/>`);
      },
      box(x, y, width, height, radius, fill, opacity, strokeColor, strokeWidth, bar) {
        parts.push(`<g opacity="${number(opacity * 100) / 100}"><rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="${number(radius)}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>${bar ? `<rect x="${number(x)}" y="${number(y + radius / 2)}" width="${number(Math.max(3, height * 0.13))}" height="${number(height - radius)}" fill="${bar}"/>` : ""}</g>`);
      },
      text(text, x, y, size, color, opacity, halo, font, anchor) {
        parts.push(`<text x="${number(x)}" y="${number(y)}" font-size="${number(size)}" font-family="${escape(font)}" fill="${color}" fill-opacity="${number(opacity * 100) / 100}" dominant-baseline="central"${anchor === "middle" ? ' text-anchor="middle"' : ""}${halo ? ` stroke="${halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"` : ""}>${escape(text)}</text>`);
      }
    };
  }

  // ------------------------------------------------------------ the picture
  // Everything a picture needs is in one object, so the canvas of the page
  // and a drawing made without a browser are the same picture:
  // { nodes, edges, kinds, labels, visible, shown, form, points, boxes, routes,
  //   camera, width, height, hover, selected, highlight, rings, sizes, pinned,
  //   degree, neighbors, look, measure, place? }
  // place(index) says where a node is drawn while it glides from one layout to another.
  const shorten = (label) => (String(label).length > 34 ? `${String(label).slice(0, 33)}…` : String(label));

  /** How far the visible nodes reach from the middle of the layout. */
  function extentOf(v) {
    const flat = v.form !== "3d";
    let far = 0;
    for (let index = 0; index < v.points.length; index++) {
      if (!v.visible[index]) continue;
      const { x, y, z } = v.points[index];
      far = Math.max(far, Math.hypot(x, y, flat ? 0 : z));
    }
    return far;
  }

  /**
   * How far the eye is from the middle of the layout. In space it stands close, so what is in front
   * is clearly larger than what is behind.
   */
  const distanceOf = (v) => (v.form === "3d" ? Math.max(extentOf(v) * 2.2, 320) : Math.max(extentOf(v) * 3, 400));

  /** A point of the layout on the screen: { x, y, scale, depth }. */
  function projectOn(v, point, distance, view = v.camera) {
    const cosYaw = Math.cos(view.yaw);
    const sinYaw = Math.sin(view.yaw);
    const cosPitch = Math.cos(view.pitch);
    const sinPitch = Math.sin(view.pitch);
    const x = point.x * cosYaw + point.z * sinYaw;
    const back = -point.x * sinYaw + point.z * cosYaw;
    const y = point.y * cosPitch - back * sinPitch;
    const depth = point.y * sinPitch + back * cosPitch;
    const perspective = v.form !== "3d" ? 1 : distance / Math.max(distance + depth, distance * 0.15);
    const scale = view.zoom * perspective;
    return { x: v.width / 2 + view.x + x * scale, y: v.height / 2 + view.y + y * scale, scale, depth };
  }

  const radiusOf = (v, index) => {
    const value = v.sizes ? v.sizes.values[index] : 0;
    return 4.5 + (v.sizes && v.sizes.most > 0 ? 11 * Math.sqrt(Math.max(value, 0) / v.sizes.most) : 0);
  };

  /** What stands out: the node under the pointer, else the highlight, else the selection. */
  function emphasisOf(v) {
    // The pointer on the selected node leaves what the selection lights up as it is.
    if (v.hover >= 0 && !(v.highlight && v.hover === v.selected)) return { center: v.hover, has: (index) => index === v.hover || v.neighbors[v.hover].has(index) };
    if (v.highlight) return { has: (index) => v.highlight.has(index) };
    if (v.selected >= 0) return { center: v.selected, has: (index) => index === v.selected || v.neighbors[v.selected].has(index) };
    return undefined;
  }

  /** Moves the camera so that everything visible is in the window. */
  function frameOn(v) {
    const free = freeOf(v);
    if (v.form === "diagram") {
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (let index = 0; index < v.nodes.length; index++) {
        const box = v.visible[index] && v.boxes[index];
        if (!box) continue;
        left = Math.min(left, box.x - box.w / 2);
        right = Math.max(right, box.x + box.w / 2);
        top = Math.min(top, box.y - box.h / 2);
        bottom = Math.max(bottom, box.y + box.h / 2);
      }
      if (left === Infinity) left = right = top = bottom = 0;
      // The titles of the columns belong to the picture.
      for (const head of v.heads ?? []) top = Math.min(top, head.y - 12);
      v.camera.zoom = Math.min(1.4, (free.width - 48) / Math.max(right - left, 1), (free.height - 48) / Math.max(bottom - top, 1));
      v.camera.x = free.x - ((left + right) / 2) * v.camera.zoom;
      v.camera.y = free.y - ((top + bottom) / 2) * v.camera.zoom;
      return;
    }
    if (v.form === "3d") {
      // In space the floor under the graph belongs to the picture.
      v.camera.zoom = Math.min(3, Math.min(free.width, free.height) / 2 / (extentOf(v) * 1.32 + 46));
      v.camera.x = free.x;
      v.camera.y = free.y - extentOf(v) * 0.1 * v.camera.zoom;
      return;
    }
    v.camera.zoom = Math.min(3, Math.min(free.width, free.height) / 2 / (extentOf(v) * 1.08 + 46));
    v.camera.x = free.x;
    v.camera.y = free.y;
  }

  /** The part of the window nothing floats on (v.room: what is taken at each side), and where its middle is. */
  function freeOf(v) {
    const { left = 0, right = 0, top = 0, bottom = 0 } = v.room ?? {};
    const width = Math.max(v.width - left - right, v.width / 3);
    const height = Math.max(v.height - top - bottom, v.height / 3);
    return { width, height, x: width < v.width - left - right + 1 ? (left - right) / 2 : 0, y: height < v.height - top - bottom + 1 ? (top - bottom) / 2 : 0 };
  }

  /** Draws the picture as it is now through a pen. */
  function picture(pen, v) {
    const { look } = v;
    const flat = v.form !== "3d";
    pen.clear(v.width, v.height, look.background);
    const distance = distanceOf(v);
    const boxed = v.form === "diagram";
    const placed = v.nodes.map((_, index) => (v.visible[index] && (!boxed || v.boxes[index]) ? projectOn(v, v.place ? v.place(index) : boxed ? { x: v.boxes[index].x, y: v.boxes[index].y, z: 0 } : v.points[index], distance) : undefined));
    const focus = emphasisOf(v);
    const lit = (index) => !focus || focus.has(index);
    // In space: how much larger (in front) or smaller (behind) something is than in the middle.
    const near = (item) => (flat ? 1 : item.scale / v.camera.zoom);
    // What is behind fades into the background.
    const depthFade = (item) => (flat ? 1 : Math.max(0.3, Math.min(1, (near(item) - 0.5) / 0.55)));
    // The size of a node on the screen: the zoom within limits, and in space its depth.
    const grown = (item) => Math.min(1.6, Math.max(0.5, flat ? item.scale : v.camera.zoom)) * (flat ? 1 : Math.min(2.4, Math.max(0.45, near(item))));

    // In space the graph stands over a floor: rings and spokes that show where is front, back, and below.
    if (!flat) {
      const extent = Math.max(extentOf(v), 120);
      const floor = extent * 0.8;
      const ground = [];
      const on = (x, z) => projectOn(v, { x, y: floor, z }, distance);
      for (const radius of [0.35, 0.65, 0.95]) {
        let before = on(radius * extent, 0);
        for (let part = 1; part <= 48; part++) {
          const angle = (part / 48) * Math.PI * 2;
          const next = on(Math.cos(angle) * radius * extent, Math.sin(angle) * radius * extent);
          ground.push(before.x, before.y, next.x, next.y);
          before = next;
        }
      }
      for (let spoke = 0; spoke < 12; spoke++) {
        const angle = (spoke / 12) * Math.PI * 2;
        const from = on(Math.cos(angle) * 0.35 * extent, Math.sin(angle) * 0.35 * extent);
        const to = on(Math.cos(angle) * 0.95 * extent, Math.sin(angle) * 0.95 * extent);
        ground.push(from.x, from.y, to.x, to.y);
      }
      pen.lines(ground, look.muted ?? "#64748B", 0.26, 1);
    }

    // Where a relation meets its nodes: a line, or in the diagram curves from side to side
    // through the points it passes.
    const anchors = (edge) => {
      const from = placed[edge[0]];
      const to = placed[edge[1]];
      if (!boxed) return [from.x, from.y, to.x, to.y];
      const scale = v.camera.zoom;
      const middle = (v.routes.get(`${edge[0]}>${edge[1]}`) ?? []).map((point) => projectOn(v, { x: point.x, y: point.y, z: 0 }, distance));
      const next = middle[0] ?? to;
      const last = middle.at(-1) ?? from;
      const start = { x: from.x + (next.x >= from.x ? 1 : -1) * (v.boxes[edge[0]].w / 2) * scale, y: from.y };
      const end = { x: to.x + (last.x <= to.x ? -1 : 1) * (v.boxes[edge[1]].w / 2) * scale, y: to.y };
      const stops = [start, ...middle, end];
      const path = [];
      for (let at = 1; at < stops.length; at++) {
        const a = stops[at - 1];
        const b = stops[at];
        // Leaves and arrives level, also when it has to turn back.
        const reach = Math.max(22 * scale, Math.abs(b.x - a.x) / 2);
        const leave = at === 1 ? (next.x >= from.x ? 1 : -1) : Math.sign(b.x - a.x) || 1;
        const arrive = at === stops.length - 1 ? (last.x <= to.x ? 1 : -1) : Math.sign(b.x - a.x) || 1;
        path.push(a.x, a.y, a.x + leave * reach, a.y, b.x - arrive * reach, b.y, b.x, b.y);
      }
      return path;
    };

    // Relations: one path per kind, the ones that stand out on top.
    const many = v.edges.length > 3000;
    const strong = [];
    for (let kind = 0; kind < v.kinds.length; kind++) {
      if (!v.shown[kind]) continue;
      const path = [];
      // In space: relations behind, in the middle, and in front, each fainter or stronger.
      const behind = [];
      const front = [];
      for (const edge of v.edges) {
        if (edge[2] !== kind || !placed[edge[0]] || !placed[edge[1]]) continue;
        if (focus && lit(edge[0]) && lit(edge[1]) && (focus.center === undefined || edge[0] === focus.center || edge[1] === focus.center)) {
          strong.push(edge);
          continue;
        }
        // A very large graph keeps one stroke per kind.
        const depth = flat || many ? 1 : (near(placed[edge[0]]) + near(placed[edge[1]])) / 2;
        const into = depth < 0.88 ? behind : depth > 1.2 ? front : path;
        for (const value of anchors(edge)) into.push(value);
      }
      // In the overview relations stay in the background until something is selected.
      const opacity = focus ? (v.quiet ? 0.07 : 0.1) : many ? 0.16 : v.quiet ? (v.kinds[kind].color ? 0.75 : 0.34) : boxed ? 0.55 : 0.42;
      const color = v.kinds[kind].color ?? (v.quiet ? look.muted ?? "#64748B" : "#64748B");
      if (boxed) pen.curves(path, color, opacity, 1, v.kinds[kind].dash);
      else {
        if (behind.length) pen.lines(behind, color, opacity * 0.45, 0.8, v.kinds[kind].dash);
        pen.lines(path, color, opacity, 1, v.kinds[kind].dash);
        if (front.length) pen.lines(front, color, Math.min(1, opacity * 1.5), 1.6, v.kinds[kind].dash);
      }
    }
    const arrow = (edge, opacity, weight) => {
      const color = v.kinds[edge[2]].color ?? (v.quiet ? look.text : "#64748B");
      const line = anchors(edge);
      let tipX;
      let tipY;
      let ux;
      let uy;
      if (boxed) {
        pen.curves(line, color, opacity, weight, v.kinds[edge[2]].dash);
        tipX = line.at(-2);
        tipY = line.at(-1);
        ux = Math.sign(tipX - line.at(-4)) || 1;
        uy = 0;
      } else {
        const length = Math.hypot(line[2] - line[0], line[3] - line[1]);
        if (length < 6) return;
        ux = (line[2] - line[0]) / length;
        uy = (line[3] - line[1]) / length;
        const end = radiusOf(v, edge[1]) * grown(placed[edge[1]]) + 2;
        tipX = line[2] - ux * end;
        tipY = line[3] - uy * end;
        pen.lines([line[0], line[1], tipX, tipY], color, opacity, weight, v.kinds[edge[2]].dash);
      }
      pen.triangle(tipX, tipY, tipX - ux * 7 - uy * 3.2, tipY - uy * 7 + ux * 3.2, tipX - ux * 7 + uy * 3.2, tipY - uy * 7 - ux * 3.2, color, opacity);
    };
    // Few relations get their direction drawn.
    if (!many && !focus && !v.quiet && v.edges.length <= 600) {
      for (const edge of v.edges) if (v.shown[edge[2]] && placed[edge[0]] && placed[edge[1]]) arrow(edge, boxed ? 0.7 : 0.55, 1);
    }
    for (const edge of strong) arrow(edge, 0.95, 1.8);

    // The titles of the columns of a diagram that has them.
    if (boxed) {
      for (const head of v.heads ?? []) {
        const at = projectOn(v, { x: head.x, y: head.y, z: 0 }, distance);
        const size = Math.max(9, Math.min(15, 13 * v.camera.zoom));
        pen.text(String(head.title).toUpperCase(), at.x, at.y, size, look.muted ?? "#64748B", 0.95, undefined, look.font, "middle");
      }
    }

    // Nodes from the back to the front.
    const order = [];
    for (let index = 0; index < placed.length; index++) if (placed[index]) order.push(index);
    order.sort((a, b) => placed[b].depth - placed[a].depth);
    const reaches = new Float32Array(v.nodes.length);
    for (const index of order) {
      const item = placed[index];
      const marked = index === v.selected || index === v.hover;
      const opacity = (lit(index) ? 1 : 0.26) * depthFade(item);
      const color = v.nodes[index].color ?? "#64748B";
      if (boxed) {
        const box = v.boxes[index];
        const w = box.w * v.camera.zoom;
        const h = box.h * v.camera.zoom;
        if (v.rings?.[index]) pen.box(item.x - w / 2 - 3, item.y - h / 2 - 3, w + 6, h + 6, 7 * v.camera.zoom + 3, "none", opacity, v.rings[index].color, v.rings[index].width);
        pen.box(item.x - w / 2, item.y - h / 2, w, h, 7 * v.camera.zoom, look.surface, opacity, marked ? look.text : color, marked ? 2 : 1.2, color);
        if (12 * v.camera.zoom >= 5) pen.text(v.labels[index], item.x + 3 * v.camera.zoom, item.y, 12 * v.camera.zoom, look.text, opacity, undefined, look.font, "middle");
        continue;
      }
      const size = Math.max(1.6, radiusOf(v, index) * grown(item));
      reaches[index] = size;
      if (v.rings?.[index]) pen.ring(item.x, item.y, size + 3.5, v.rings[index].color, opacity, v.rings[index].width);
      // A ring of the surface keeps overlapping v.nodes apart.
      pen.circle(item.x, item.y, size, color, opacity, marked ? look.text : look.background, index === v.selected ? 2.5 : 1);
      // In space a node is a ball: light falls on it from the upper left.
      if (!flat && size > 3 && order.length <= 1500) pen.circle(item.x - size * 0.3, item.y - size * 0.32, size * 0.36, "#FFFFFF", 0.34 * opacity);
      if (v.pinned.has(index) && size > 4) pen.circle(item.x, item.y, Math.max(1.2, size * 0.3), look.background, 1);
    }

    // Names: what stands out first, then the best connected, where there is room.
    if (!boxed) {
      const wanted = [];
      if (focus) wanted.push(...order.filter(lit).sort((a, b) => (b === focus.center) - (a === focus.center) || v.degree[b] - v.degree[a]));
      else wanted.push(...order.slice().sort((a, b) => v.degree[b] - v.degree[a] || radiusOf(v, b) - radiusOf(v, a)));
      const taken = [];
      for (const index of wanted) {
        if (taken.length >= MAX_LABELS) break;
        const item = placed[index];
        if (item.x < -40 || item.x > v.width + 40 || item.y < 0 || item.y > v.height) continue;
        const reach = reaches[index] + 4;
        // In space a name in front is larger than one behind.
        const letters = flat ? 12 : Math.round(12 * Math.min(1.35, Math.max(0.82, near(item))) * 2) / 2;
        const textWidth = v.measure(v.labels[index]) * (letters / 12);
        const overlaps = (box) => taken.some((other) => box.x < other.x + other.w + 4 && box.x + box.w + 4 > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
        // To the right of the node, or to its left when that is taken.
        let box = { x: item.x + reach, y: item.y - 8, w: textWidth, h: 16 };
        if (overlaps(box)) {
          const other = { x: item.x - reach - textWidth, y: item.y - 8, w: textWidth, h: 16 };
          if (!overlaps(other)) box = other;
        }
        // A small graph names every node; what stands out always names itself.
        const forced = order.length <= 30 || (focus && taken.length < 24);
        if (!forced && overlaps(box)) continue;
        taken.push(box);
        pen.text(v.labels[index], box.x, item.y, letters, look.text, focus ? 1 : Math.max(0.55, depthFade(item)), look.background, look.font);
      }
    }
    return placed;
  }

  const NO_ROUTES = new Map();
  const boxWidthOf = (textWidth) => Math.min(260, Math.max(64, textWidth + 30));

  /**
   * A picture without a page: the scene laid out and drawn as SVG. The same
   * layouts and the same picture as on the canvas, settled before it is
   * drawn, so the same scene gives the same drawing every time.
   * @param scene { title, nodes: [{ label, group, color }], edges, kinds, groups }
   * @param options { form: "2d" | "diagram" | "3d", width, height, visible, shown, highlight, rings, sizes, selected,
   *   look: { background, surface, text, muted, font }, measure: (text) => width of the text at 12px }
   * @returns an SVG document as text
   */
  function drawing(scene, { form = "2d", width = 1440, height = 900, visible, shown, highlight, rings, sizes, selected = -1, look, measure } = {}) {
    const { nodes, edges, kinds } = scene;
    const v = {
      nodes,
      edges,
      kinds,
      labels: nodes.map(({ label }) => shorten(label)),
      visible: visible ?? new Uint8Array(nodes.length).fill(1),
      shown: shown?.length ? shown : new Uint8Array(Math.max(kinds.length, 1)).fill(1),
      form,
      points: seed(nodes, scene.groups?.length ?? 1),
      boxes: [],
      routes: new Map(),
      camera: { yaw: form === "3d" ? 0.6 : 0, pitch: form === "3d" ? 0.35 : 0, zoom: 1, x: 0, y: 0 },
      width,
      height,
      hover: -1,
      selected,
      highlight: highlight?.size ? highlight : undefined,
      rings,
      sizes: sizes ? { values: sizes, most: Math.max(...sizes, 0) } : undefined,
      pinned: new Set(),
      degree: new Uint32Array(nodes.length),
      neighbors: nodes.map(() => new Set()),
      look: { background: "#ffffff", surface: "#ffffff", text: "#141414", muted: "#6b6b6b", font: "sans-serif", ...look },
      measure: measure ?? ((text) => String(text).length * 6.4)
    };
    for (const [from, to, kind] of edges) {
      if (!v.visible[from] || !v.visible[to] || !v.shown[kind]) continue;
      v.neighbors[from].add(to);
      v.neighbors[to].add(from);
      v.degree[from]++;
      v.degree[to]++;
    }
    v.quiet = Boolean(scene.flow);
    if (form === "diagram") Object.assign(v, layered(nodes, edges, v.visible, v.shown, (index) => boxWidthOf(v.measure(v.labels[index])), scene.columns));
    else {
      const next = random(nodes.length + edges.length * 7);
      const flat = form !== "3d";
      if (!flat) for (const point of v.points) if (Math.abs(point.z) < 1) point.z = (next() - 0.5) * LINK * 2;
      // Until the layout has settled; fewer steps for very many nodes.
      const turns = nodes.length > 4000 ? 120 : nodes.length > 1500 ? 220 : 420;
      let alpha = 1;
      for (let turn = 0; turn < turns; turn++) {
        step(v.points, nodes, edges, v.visible, v.shown, alpha, flat, v.pinned, next);
        alpha *= 0.985;
      }
    }
    frameOn(v);
    const parts = [];
    picture(svgPen(parts), v);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" width="${Math.round(width)}" height="${Math.round(height)}" role="img" aria-label="${String(scene.title ?? "Graph").replace(/[&<>"]/gu, "")}">${parts.join("")}</svg>`;
  }

  /**
   * @param container the element that gets the canvas
   * @param scene { title, nodes: [{ label, group, color }], edges: [[from, to, kind, weight]], kinds: [{ kind, color, dash }], groups }
   * @param from the picture before this one (snapshot() of its graph): nodes that were in it start
   *   where they were and glide to their new places, and the camera moves on from where it stood
   * @param room { left, right, top, bottom }: what floats on the window at each side; the picture fits in the rest
   * @param onInfo called with { hover, selected } (node indexes) when one changes
   * @param onOpen called with a node index on a double click
   */
  function create(container, scene, { mode = "2d", from, room: taken, onInfo = () => {}, onOpen = () => {} } = {}) {
    const { nodes, edges, kinds } = scene;
    const canvas = document.createElement("canvas");
    canvas.className = "graph-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${scene.title ?? "Graph"}: ${nodes.length} nodes and ${edges.length} relations`);
    container.prepend(canvas);
    const context = canvas.getContext("2d");
    const next = random(nodes.length + edges.length * 7);
    let points = seed(nodes, scene.groups?.length ?? 1);
    let boxes;
    let routes = new Map();
    let heads;
    const pinned = new Set();
    let visible = new Uint8Array(nodes.length).fill(1);
    let shown = new Uint8Array(Math.max(kinds.length, 1)).fill(1);
    let sizes;
    let form = mode;
    let flat = form !== "3d";
    let alpha = 1;
    let width = 1;
    let height = 1;
    // The camera: turned by yaw and pitch (3D), scaled, and moved in the window.
    const camera = { yaw: flat ? 0 : 0.6, pitch: flat ? 0 : 0.35, zoom: 1, x: 0, y: 0 };
    let glide;
    // Nodes on their way from one layout to another: { from: [{ x, y, z }], start, duration }.
    let morph;
    // What floats on the window at each side, and whether the camera is on its way to fit the picture in the rest.
    let room = taken ?? {};
    let following = true;
    // In space the graph turns slowly by itself, until someone turns it or the pointer is on it.
    let orbit = true;
    let over = false;
    // The camera on its way from one angle to another (2D to 3D and back).
    let turn;
    let hover = -1;
    let selected = -1;
    let highlight;
    let rings;
    let frame = 0;
    let destroyed = false;
    // Until someone moves or zooms the picture, it keeps everything in the window.
    let touched = false;
    const neighbors = nodes.map(() => new Set());
    const degree = new Uint32Array(nodes.length);
    const labels = nodes.map(({ label }) => shorten(label));
    const diagram = () => form === "diagram";
    /** The picture as it is now (see picture). */
    const state = () => ({ nodes, edges, kinds, labels, visible, shown, form, points, boxes, routes: morph ? NO_ROUTES : routes, heads: morph || !diagram() ? undefined : heads, quiet: Boolean(scene.flow), camera, width, height, room, hover, selected, highlight, rings, sizes, pinned, degree, neighbors, place: morph ? current : undefined });

    function connect() {
      for (const set of neighbors) set.clear();
      degree.fill(0);
      for (const [from, to, kind] of edges) {
        if (!visible[from] || !visible[to] || !shown[kind]) continue;
        neighbors[from].add(to);
        neighbors[to].add(from);
        degree[from]++;
        degree[to]++;
      }
    }

    function theme() {
      const style = getComputedStyle(container);
      const value = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
      return {
        background: value("--canvas", "#ffffff"),
        surface: value("--surface", "#ffffff"),
        text: value("--text", "#1f2937"),
        muted: value("--muted", "#64748b"),
        font: style.fontFamily || "sans-serif"
      };
    }

    const measure = (text) => {
      context.font = `12px ${theme().font}`;
      return context.measureText(text).width;
    };
    const boxWidth = (index) => boxWidthOf(measure(labels[index]));
    function arrange() {
      ({ boxes, routes, heads } = layered(nodes, edges, visible, shown, boxWidth, scene.columns));
    }
    const place = (index) => (diagram() ? { x: boxes[index].x, y: boxes[index].y, z: 0 } : points[index]);
    /** Someone who asked for less motion gets the next picture at once. */
    const still = () => Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    /** Where a node is drawn now: on its way, or in its place. */
    const current = (index) => {
      const to = place(index);
      const start = morph?.from[index];
      if (!start) return to;
      const progress = Math.min(1, (performance.now() - morph.start) / morph.duration);
      const ease = 1 - (1 - progress) ** 3;
      return { x: start.x + (to.x - start.x) * ease, y: start.y + (to.y - start.y) * ease, z: start.z + (to.z - start.z) * ease };
    };
    /** Lets the nodes glide from where they are drawn now to where they belong next. */
    const depart = () => nodes.map((_, index) => (visible[index] && (!diagram() || boxes[index]) ? current(index) : undefined));
    const arrive = (before) => {
      morph = still() ? undefined : { from: before, start: performance.now(), duration: 460 };
      redraw();
    };

    const extent = () => extentOf(state());
    const frameAll = () => frameOn(state());
    /** Where the camera stands when everything is in the window. */
    const framed = () => {
      const copy = { ...state(), camera: { ...camera }, place: undefined };
      frameOn(copy);
      return copy.camera;
    };
    /** Moves the camera a part of the way to where everything is in the window; true when it is there. */
    function follow() {
      const target = framed();
      const zoom = target.zoom - camera.zoom;
      const x = target.x - camera.x;
      const y = target.y - camera.y;
      if (still() || (Math.abs(zoom) < camera.zoom * 0.002 && Math.abs(x) < 0.5 && Math.abs(y) < 0.5)) {
        Object.assign(camera, { zoom: target.zoom, x: target.x, y: target.y });
        return true;
      }
      camera.zoom += zoom * 0.18;
      camera.x += x * 0.18;
      camera.y += y * 0.18;
      return false;
    }
    /** The camera goes to where the picture fits, without a jump. */
    function settle() {
      touched = false;
      glide = undefined;
      following = true;
      orbit = true;
      redraw();
    }
    const fit = settle;

    const project = (point, distance, view = camera) => projectOn(state(), point, distance, view);
    const radius = (index) => radiusOf({ sizes }, index);

    /** Draws the picture as it is now through a pen. */
    const paint = (pen) => picture(pen, { ...state(), look: theme(), measure });

    function draw(time) {
      frame = 0;
      if (destroyed) return;
      if (!canvas.isConnected) return destroy();
      if (glide) {
        const progress = Math.min(1, (time - glide.start) / glide.duration);
        const ease = 1 - (1 - progress) ** 3;
        camera.zoom = glide.from.zoom + (glide.to.zoom - glide.from.zoom) * ease;
        camera.x = glide.from.x + (glide.to.x - glide.from.x) * ease;
        camera.y = glide.from.y + (glide.to.y - glide.from.y) * ease;
        if (progress >= 1) glide = undefined;
        redraw();
      }
      if (turn) {
        const progress = still() ? 1 : Math.min(1, (time - turn.start) / turn.duration);
        const ease = 1 - (1 - progress) ** 3;
        camera.yaw = turn.from.yaw + (turn.to.yaw - turn.from.yaw) * ease;
        camera.pitch = turn.from.pitch + (turn.to.pitch - turn.from.pitch) * ease;
        if (progress >= 1) turn = undefined;
        redraw();
      }
      if (morph) {
        if (time - morph.start >= morph.duration) morph = undefined;
        redraw();
      }
      if (!diagram() && alpha > 0.012) {
        // A few steps a frame while the layout settles.
        const steps = nodes.length > 1500 ? 1 : 2;
        for (let count = 0; count < steps; count++) {
          step(points, nodes, edges, visible, shown, alpha, flat, pinned, next);
          alpha *= 0.985;
        }
        redraw();
      }
      if (!flat && orbit && !over && !turn && !drag && selected < 0 && nodes.length <= 2500 && !still()) {
        camera.yaw += 0.0026;
        redraw();
      }
      // Until someone moves the picture, the camera follows it to where it fits, without a jump.
      if (!touched && !glide && following) {
        if (!follow()) redraw();
        else if (!morph && (diagram() || alpha <= 0.012)) following = false;
      }
      const ratio = root.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw.placed = paint(canvasPen(context));
    }
    const redraw = () => { frame ||= requestAnimationFrame(draw); };
    const reheat = (value = 0.5) => {
      alpha = Math.max(alpha, value);
      redraw();
    };

    let observer;
    let themes;
    let started = false;
    function destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      themes?.disconnect();
      canvas.remove();
    }

    function resize() {
      const box = container.getBoundingClientRect();
      const ratio = root.devicePixelRatio || 1;
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // The first picture stands at once; later the camera follows.
      if (!touched && !started) frameAll();
      started = true;
      following = true;
      redraw();
    }

    function hit(x, y) {
      const placed = draw.placed ?? [];
      let best = -1;
      let nearest = Infinity;
      for (let index = 0; index < placed.length; index++) {
        const item = placed[index];
        if (!item) continue;
        if (diagram()) {
          const box = boxes[index];
          if (Math.abs(x - item.x) <= (box.w / 2) * camera.zoom && Math.abs(y - item.y) <= (box.h / 2) * camera.zoom) best = index;
          continue;
        }
        const reach = Math.max(6, radius(index) * Math.min(1.6, Math.max(0.5, item.scale)) + 3);
        const distance = Math.hypot(item.x - x, item.y - y);
        // Among those under the pointer, the one in front.
        if (distance <= reach && distance - item.depth * 0.001 < nearest) {
          nearest = distance - item.depth * 0.001;
          best = index;
        }
      }
      return best;
    }

    const inform = () => onInfo({ hover, selected });
    const local = (event) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    let drag;
    canvas.addEventListener("pointerdown", (event) => {
      const { x, y } = local(event);
      drag = { x, y, moved: 0, node: hit(x, y), pan: flat || event.shiftKey || event.button === 2 };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      const { x, y } = local(event);
      if (!drag) {
        const found = hit(x, y);
        if (found !== hover) {
          hover = found;
          canvas.style.cursor = hover >= 0 ? "pointer" : "";
          inform();
          redraw();
        }
        return;
      }
      const dx = x - drag.x;
      const dy = y - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = x;
      drag.y = y;
      if (drag.moved <= 4) return;
      touched = true;
      glide = undefined;
      container.classList.add("dragging");
      if (drag.node >= 0 && diagram()) {
        boxes[drag.node].x += dx / camera.zoom;
        boxes[drag.node].y += dy / camera.zoom;
      } else if (drag.node >= 0) {
        // A node follows the pointer in the plane of the window and stays where it is put.
        const item = draw.placed?.[drag.node];
        const scale = item?.scale || camera.zoom;
        const mx = dx / scale;
        const my = dy / scale;
        const cosYaw = Math.cos(camera.yaw);
        const sinYaw = Math.sin(camera.yaw);
        const cosPitch = Math.cos(camera.pitch);
        const sinPitch = Math.sin(camera.pitch);
        const point = points[drag.node];
        point.x += mx * cosYaw + my * sinPitch * sinYaw;
        point.y += my * cosPitch;
        point.z += flat ? 0 : mx * sinYaw - my * sinPitch * cosYaw;
        pinned.add(drag.node);
        reheat(0.25);
      } else if (drag.pan) {
        camera.x += dx;
        camera.y += dy;
      } else {
        camera.yaw += dx * 0.008;
        camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + dy * 0.008));
        // Whoever turns the graph keeps the angle they chose.
        orbit = false;
      }
      redraw();
    });
    canvas.addEventListener("pointerenter", () => { over = true; });
    canvas.addEventListener("pointerup", (event) => {
      const done = drag;
      drag = undefined;
      container.classList.remove("dragging");
      if (!done || done.moved > 4) return;
      const { x, y } = local(event);
      selected = hit(x, y);
      inform();
      redraw();
    });
    canvas.addEventListener("dblclick", (event) => {
      const { x, y } = local(event);
      const found = hit(x, y);
      if (found >= 0) onOpen(found);
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerleave", () => {
      over = false;
      redraw();
      if (hover < 0) return;
      hover = -1;
      inform();
    });
    function zoom(factor, x = width / 2, y = height / 2) {
      touched = true;
      glide = undefined;
      const cx = x - width / 2;
      const cy = y - height / 2;
      camera.zoom *= factor;
      camera.x = cx - (cx - camera.x) * factor;
      camera.y = cy - (cy - camera.y) * factor;
      redraw();
    }
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const { x, y } = local(event);
      zoom(Math.exp(-event.deltaY * (event.deltaMode ? 0.05 : 0.0016)), x, y);
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      const turn = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[event.key];
      if (turn && !event.altKey && !event.metaKey && !event.ctrlKey) {
        touched = true;
        if (flat) {
          camera.x -= turn[0] * 300;
          camera.y -= turn[1] * 300;
        } else {
          camera.yaw += turn[0];
          camera.pitch = Math.max(-1.5, Math.min(1.5, camera.pitch + turn[1]));
        }
        redraw();
      } else if (event.key === "+" || event.key === "=") zoom(1.3);
      else if (event.key === "-") zoom(1 / 1.3);
      else if (event.key === "0" || event.key === "Home") fit();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });

    /** Moves the camera so that these nodes fill the window, without turning it. */
    function center(indexes, { animate = true } = {}) {
      const wanted = indexes.filter((index) => visible[index] && (!diagram() || boxes[index]));
      if (!wanted.length) return;
      const unit = { ...camera, zoom: 1, x: 0, y: 0 };
      const distance = distanceOf(state());
      const free = freeOf(state());
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const index of wanted) {
        const item = project(place(index), distance, unit);
        const reachX = diagram() ? boxes[index].w / 2 : 30;
        const reachY = diagram() ? boxes[index].h / 2 : 30;
        left = Math.min(left, item.x - width / 2 - reachX);
        right = Math.max(right, item.x - width / 2 + reachX);
        top = Math.min(top, item.y - height / 2 - reachY);
        bottom = Math.max(bottom, item.y - height / 2 + reachY);
      }
      const most = diagram() ? 1.4 : 2.2;
      // One node comes to the middle as large as the picture is, or large enough to read; several fill the window.
      const target = wanted.length === 1
        ? Math.min(most, Math.max(camera.zoom, diagram() ? 0.8 : 1))
        : Math.max(0.05, Math.min(most, (free.width * 0.62) / Math.max(right - left, 1), (free.height * 0.56) / Math.max(bottom - top, 1)));
      const to = { zoom: target, x: free.x - ((left + right) / 2) * target, y: free.y - ((top + bottom) / 2) * target };
      touched = true;
      if (!animate) {
        Object.assign(camera, to);
        glide = undefined;
      } else glide = { start: performance.now(), duration: 520, from: { zoom: camera.zoom, x: camera.x, y: camera.y }, to };
      redraw();
    }

    observer = new ResizeObserver(resize);
    observer.observe(container);
    themes = new MutationObserver(redraw);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    connect();
    arrange();
    // What was in the picture before stays where it was; what is new starts next to what it is related to.
    const known = new Set();
    if (from?.positions) {
      nodes.forEach((node, index) => {
        const before = node.id === undefined ? undefined : from.positions.get(node.id);
        if (!before) return;
        points[index] = { x: before.x, y: before.y, z: flat ? 0 : Math.abs(before.z) < 1 ? (next() - 0.5) * LINK * 2 : before.z, vx: 0, vy: 0, vz: 0 };
        known.add(index);
      });
    }
    if (known.size) {
      const placed = new Set(known);
      for (let pass = 0; pass < 3; pass++) {
        for (const [a, b] of edges) {
          for (const [here, there] of [[a, b], [b, a]]) {
            if (placed.has(here) || !placed.has(there)) continue;
            const near = points[there];
            points[here] = { x: near.x + (next() - 0.5) * LINK, y: near.y + (next() - 0.5) * LINK, z: flat ? 0 : near.z + (next() - 0.5) * LINK, vx: 0, vy: 0, vz: 0 };
            placed.add(here);
          }
        }
      }
      // The camera goes on from where it stood, and the layout only has to settle.
      Object.assign(camera, { zoom: from.camera.zoom, x: from.camera.x, y: from.camera.y });
      if (!flat && from.form === "3d") Object.assign(camera, { yaw: from.camera.yaw, pitch: from.camera.pitch });
      alpha = known.size * 2 >= nodes.length ? 0.5 : 0.9;
      started = true;
      if (diagram()) arrive(nodes.map((_, index) => (known.has(index) ? { ...points[index], z: 0 } : undefined)));
    } else {
      // The first picture is a settled one, within a short budget.
      const begun = Date.now();
      for (let count = 0; count < 160 && Date.now() - begun < 140; count++) {
        step(points, nodes, edges, visible, shown, alpha, flat, pinned, next);
        alpha *= 0.985;
      }
    }
    resize();

    return {
      fit,
      zoom,
      center,
      /** "2d", "diagram", or "3d": the same nodes in a plane, in layers, or in space. */
      mode(value) {
        const before = depart();
        form = value;
        flat = value !== "3d";
        // The camera turns to its new angle, and the nodes glide to their new places.
        turn = { from: { yaw: camera.yaw, pitch: camera.pitch }, to: { yaw: flat ? 0 : 0.6, pitch: flat ? 0 : 0.35 }, start: performance.now(), duration: 520 };
        if (!flat) for (const point of points) if (Math.abs(point.z) < 1) point.z = (next() - 0.5) * LINK * 2;
        settle();
        if (diagram()) arrange();
        else reheat(0.7);
        arrive(before);
      },
      /** Which nodes (by index) and which kinds of relation show. */
      show(nodeFlags, kindFlags) {
        visible = nodeFlags;
        shown = kindFlags;
        if (hover >= 0 && !visible[hover]) hover = -1;
        if (selected >= 0 && !visible[selected]) selected = -1;
        const before = depart();
        connect();
        arrange();
        settle();
        if (diagram()) arrive(before.map((start, index) => (start && boxes[index] ? start : undefined)));
        else reheat(0.45);
      },
      /** Sizes the nodes by a number each, or all the same without. */
      size(values) {
        sizes = values ? { values, most: Math.max(...values, 0) } : undefined;
        redraw();
      },
      /** New colors for the nodes, by index. */
      colors(values) {
        values.forEach((color, index) => { nodes[index].color = color; });
        redraw();
      },
      select(index) {
        selected = index;
        inform();
        redraw();
      },
      selected: () => selected,
      /** The nodes that stand out (a Set of indexes), or none: a story step, a search. */
      highlight(indexes) {
        highlight = indexes?.size ? indexes : undefined;
        redraw();
      },
      /** A ring around nodes, by index: { color, width }, or nothing. */
      rings(values) {
        rings = values;
        redraw();
      },
      /** Starts the layout again and lets go of every node that was put somewhere. */
      relayout() {
        const before = depart();
        pinned.clear();
        points = seed(nodes, scene.groups?.length ?? 1);
        arrange();
        settle();
        alpha = 1;
        arrive(before);
      },
      /** What floats on the window at each side; with follow, the picture moves to fit in the rest. */
      room(value, { follow: move = false } = {}) {
        const changed = ["left", "right", "top", "bottom"].some((side) => (value?.[side] ?? 0) !== (room[side] ?? 0));
        room = value ?? {};
        if (changed && move && !touched) settle();
      },
      /** Where every node is drawn and where the camera stands, for the picture that follows this one (see `from`). */
      snapshot() {
        const positions = new Map();
        nodes.forEach((node, index) => {
          if (node.id !== undefined && visible[index] && (!diagram() || boxes[index])) positions.set(node.id, { ...current(index) });
        });
        return { positions, camera: { ...camera }, form };
      },
      /** How many relations each node has among what shows. */
      degree: () => degree,
      neighbors: (index) => neighbors[index],
      image: () => new Promise((resolve) => {
        draw(performance.now());
        canvas.toBlob(resolve, "image/png");
      }),
      /** The picture as it is now, as an SVG document. */
      svg() {
        const parts = [];
        paint(svgPen(parts));
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" width="${Math.round(width)}" height="${Math.round(height)}" role="img" aria-label="${String(scene.title ?? "Graph").replace(/[&<>"]/gu, "")}">${parts.join("")}</svg>`;
      },
      destroy
    };
  }

  root.BCA_GRAPH = { create, drawing, seed, step, random, layered };
})(globalThis);
