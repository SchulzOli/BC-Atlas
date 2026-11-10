// The graph of the Dashboard: any board (src/app/board.js) as a 2D or a 3D
// graph on one canvas. The same nodes, relations, filter, and selection in
// both; 3D only adds depth and a camera that turns. Nodes of one group pull
// together, relations pull their ends together, everything else pushes
// apart, so structure shows without a layout step on the server.
(function (root) {
  "use strict";

  const TAU = Math.PI * 2;
  const LINK = 70;
  const FULL_PAIRS = 700;
  const MAX_LABELS = 70;

  // The same layout for the same board, every time.
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
   * @param container the element that gets the canvas
   * @param board { nodes: [{ label, group, color }], edges: [[from, to, kind, weight]], kinds: [{ kind, color }], groups }
   * @param onInfo called with { hover, selected } (node indexes) when one changes
   * @param onOpen called with a node index on a double click
   */
  function create(container, board, { mode = "2d", onInfo = () => {}, onOpen = () => {} } = {}) {
    const { nodes, edges, kinds } = board;
    const canvas = document.createElement("canvas");
    canvas.className = "board-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${board.title ?? "Graph"}: ${nodes.length} nodes and ${edges.length} relations; the table shows the same`);
    container.prepend(canvas);
    const context = canvas.getContext("2d");
    const next = random(nodes.length + edges.length * 7);
    let points = seed(nodes, board.groups?.length ?? 1);
    const pinned = new Set();
    let visible = new Uint8Array(nodes.length).fill(1);
    let shown = new Uint8Array(Math.max(kinds.length, 1)).fill(1);
    let sizes;
    let flat = mode !== "3d";
    let alpha = 1;
    let width = 1;
    let height = 1;
    // The camera: turned by yaw and pitch (3D), scaled, and moved in the window.
    const camera = { yaw: flat ? 0 : 0.6, pitch: flat ? 0 : 0.35, zoom: 1, x: 0, y: 0 };
    let hover = -1;
    let selected = -1;
    let frame = 0;
    let destroyed = false;
    // Until someone moves or zooms the picture, it keeps everything in the window.
    let touched = false;
    const neighbors = nodes.map(() => new Set());
    const degree = new Uint32Array(nodes.length);

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

    const extent = () => {
      let far = 0;
      for (let index = 0; index < points.length; index++) {
        if (!visible[index]) continue;
        const { x, y, z } = points[index];
        far = Math.max(far, Math.hypot(x, y, flat ? 0 : z));
      }
      return far;
    };

    function frameAll() {
      camera.zoom = Math.min(3, Math.min(width, height) / 2 / (extent() * 1.08 + 46));
      camera.x = 0;
      camera.y = 0;
    }
    function fit() {
      touched = false;
      frameAll();
      redraw();
    }

    /** A point of the layout on the screen: { x, y, scale, depth }. */
    function project(point, distance) {
      const cosYaw = Math.cos(camera.yaw);
      const sinYaw = Math.sin(camera.yaw);
      const cosPitch = Math.cos(camera.pitch);
      const sinPitch = Math.sin(camera.pitch);
      const x = point.x * cosYaw + point.z * sinYaw;
      const back = -point.x * sinYaw + point.z * cosYaw;
      const y = point.y * cosPitch - back * sinPitch;
      const depth = point.y * sinPitch + back * cosPitch;
      const perspective = flat ? 1 : distance / Math.max(distance + depth, distance * 0.15);
      const scale = camera.zoom * perspective;
      return { x: width / 2 + camera.x + x * scale, y: height / 2 + camera.y + y * scale, scale, depth };
    }

    const radius = (index) => {
      const value = sizes ? sizes.values[index] : 0;
      return 4.5 + (sizes && sizes.most > 0 ? 11 * Math.sqrt(Math.max(value, 0) / sizes.most) : 0);
    };

    function theme() {
      const style = getComputedStyle(container);
      const dark = document.documentElement.dataset.theme === "dark";
      return {
        dark,
        background: dark ? "#16181d" : "#ffffff",
        text: style.getPropertyValue("--text").trim() || (dark ? "#e6e8eb" : "#1f2937"),
        font: style.fontFamily || "sans-serif"
      };
    }
    const alphaOf = (hex, opacity) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, "0")}`;

    function draw() {
      frame = 0;
      if (destroyed) return;
      if (!canvas.isConnected) return destroy();
      if (alpha > 0.012) {
        // A few steps a frame while the layout settles.
        const steps = nodes.length > 1500 ? 1 : 2;
        for (let turn = 0; turn < steps; turn++) {
          step(points, nodes, edges, visible, shown, alpha, flat, pinned, next);
          alpha *= 0.985;
        }
        if (!touched) frameAll();
        redraw();
      }
      const look = theme();
      const ratio = root.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = look.background;
      context.fillRect(0, 0, width, height);
      const distance = Math.max(extent() * 3, 400);
      const placed = points.map((point, index) => (visible[index] ? project(point, distance) : undefined));
      const lit = hover >= 0 ? hover : selected;
      const near = lit >= 0 ? neighbors[lit] : undefined;
      const fade = (index) => (lit < 0 || index === lit || near.has(index) ? 1 : 0.16);
      const depthFade = (item) => (flat ? 1 : Math.max(0.35, Math.min(1, item.scale / camera.zoom)));

      // Relations: one path per kind, the lit ones on top.
      const many = edges.length > 3000;
      const strong = [];
      for (let kind = 0; kind < kinds.length; kind++) {
        if (!shown[kind]) continue;
        context.beginPath();
        for (const edge of edges) {
          if (edge[2] !== kind) continue;
          const from = placed[edge[0]];
          const to = placed[edge[1]];
          if (!from || !to) continue;
          if (lit >= 0 && (edge[0] === lit || edge[1] === lit)) {
            strong.push(edge);
            continue;
          }
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
        }
        context.strokeStyle = alphaOf(kinds[kind].color ?? "#64748B", lit >= 0 ? 0.08 : many ? 0.16 : 0.42);
        context.lineWidth = 1;
        context.setLineDash(kinds[kind].dash ? [4, 3] : []);
        context.stroke();
      }
      context.setLineDash([]);
      const arrow = (edge, opacity, weight) => {
        const from = placed[edge[0]];
        const to = placed[edge[1]];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length < 6) return;
        const ux = (to.x - from.x) / length;
        const uy = (to.y - from.y) / length;
        const end = radius(edge[1]) * Math.min(1.6, Math.max(0.5, to.scale)) + 2;
        const tipX = to.x - ux * end;
        const tipY = to.y - uy * end;
        const color = alphaOf(kinds[edge[2]].color ?? "#64748B", opacity);
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = weight;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(tipX, tipY);
        context.stroke();
        context.beginPath();
        context.moveTo(tipX, tipY);
        context.lineTo(tipX - ux * 7 - uy * 3.2, tipY - uy * 7 + ux * 3.2);
        context.lineTo(tipX - ux * 7 + uy * 3.2, tipY - uy * 7 - ux * 3.2);
        context.fill();
      };
      // Few relations get their direction drawn.
      if (!many && lit < 0 && edges.length <= 600) {
        for (const edge of edges) if (shown[edge[2]] && placed[edge[0]] && placed[edge[1]]) arrow(edge, 0.55, 1);
      }
      for (const edge of strong) arrow(edge, 0.95, 1.8);

      // Nodes from the back to the front.
      const order = [];
      for (let index = 0; index < placed.length; index++) if (placed[index]) order.push(index);
      order.sort((a, b) => placed[b].depth - placed[a].depth);
      for (const index of order) {
        const item = placed[index];
        const size = Math.max(1.6, radius(index) * Math.min(1.6, Math.max(0.5, item.scale)));
        context.beginPath();
        context.arc(item.x, item.y, size, 0, TAU);
        context.fillStyle = alphaOf(nodes[index].color ?? "#64748B", fade(index) * depthFade(item));
        context.fill();
        // A ring of the surface keeps overlapping nodes apart.
        context.lineWidth = index === selected ? 2.5 : 1;
        context.strokeStyle = index === selected || index === hover ? look.text : look.background;
        context.stroke();
        if (pinned.has(index) && size > 4) {
          context.fillStyle = look.background;
          context.beginPath();
          context.arc(item.x, item.y, Math.max(1.2, size * 0.3), 0, TAU);
          context.fill();
        }
      }

      // Names: what is lit first, then the best connected, where there is room.
      const wanted = [];
      if (lit >= 0 && placed[lit]) wanted.push(lit, ...[...near].filter((index) => placed[index]));
      const rest = order.filter((index) => lit < 0 || (index !== lit && !near.has(index))).sort((a, b) => degree[b] - degree[a] || radius(b) - radius(a));
      if (lit < 0) wanted.push(...rest);
      const boxes = [];
      context.font = `12px ${look.font}`;
      context.textBaseline = "middle";
      context.lineJoin = "round";
      for (const index of wanted) {
        if (boxes.length >= MAX_LABELS) break;
        const item = placed[index];
        if (item.x < -40 || item.x > width + 40 || item.y < 0 || item.y > height) continue;
        const text = nodes[index].label.length > 34 ? `${nodes[index].label.slice(0, 33)}…` : nodes[index].label;
        const reach = radius(index) * Math.min(1.6, Math.max(0.5, item.scale)) + 4;
        const textWidth = context.measureText(text).width;
        const taken = (box) => boxes.some((other) => box.x < other.x + other.w + 4 && box.x + box.w + 4 > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
        // To the right of the node, or to its left when that is taken.
        let box = { x: item.x + reach, y: item.y - 8, w: textWidth, h: 16 };
        if (taken(box)) {
          const other = { x: item.x - reach - textWidth, y: item.y - 8, w: textWidth, h: 16 };
          if (!taken(other)) box = other;
        }
        // A small graph names every node; a lit node always names itself and its nearest.
        const forced = order.length <= 30 || (lit >= 0 && (index === lit || boxes.length < 24));
        if (!forced && taken(box)) continue;
        const left = box.x;
        boxes.push(box);
        context.globalAlpha = lit >= 0 ? 1 : Math.max(0.55, depthFade(item));
        context.strokeStyle = look.background;
        context.lineWidth = 3;
        context.strokeText(text, left, item.y);
        context.fillStyle = look.text;
        context.fillText(text, left, item.y);
        context.globalAlpha = 1;
      }
      draw.placed = placed;
    }
    const redraw = () => { frame ||= requestAnimationFrame(draw); };
    const reheat = (value = 0.5) => {
      alpha = Math.max(alpha, value);
      redraw();
    };

    let observer;
    let themes;
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
      if (!touched) frameAll();
      redraw();
    }

    function hit(x, y) {
      const placed = draw.placed ?? [];
      let best = -1;
      let nearest = Infinity;
      for (let index = 0; index < placed.length; index++) {
        const item = placed[index];
        if (!item) continue;
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
      container.classList.add("dragging");
      if (drag.node >= 0) {
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
      }
      redraw();
    });
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
      if (hover < 0) return;
      hover = -1;
      inform();
      redraw();
    });
    function zoom(factor, x = width / 2, y = height / 2) {
      touched = true;
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
      if (turn) {
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
      else if (event.key === "Escape") {
        selected = -1;
        inform();
        redraw();
      } else return;
      event.preventDefault();
    });

    observer = new ResizeObserver(resize);
    observer.observe(container);
    themes = new MutationObserver(redraw);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    connect();
    // The first picture is a settled one, within a short budget.
    const started = Date.now();
    for (let turn = 0; turn < 160 && Date.now() - started < 140; turn++) {
      step(points, nodes, edges, visible, shown, alpha, flat, pinned, next);
      alpha *= 0.985;
    }
    resize();

    return {
      fit,
      zoom,
      /** "2d" or "3d": the same nodes in a plane or in space. */
      mode(value) {
        flat = value !== "3d";
        camera.yaw = flat ? 0 : 0.6;
        camera.pitch = flat ? 0 : 0.35;
        if (!flat) for (const point of points) if (Math.abs(point.z) < 1) point.z = (next() - 0.5) * LINK * 2;
        touched = false;
        reheat(0.7);
      },
      /** Which nodes (by index) and which kinds of relation show. */
      show(nodeFlags, kindFlags) {
        visible = nodeFlags;
        shown = kindFlags;
        if (hover >= 0 && !visible[hover]) hover = -1;
        if (selected >= 0 && !visible[selected]) selected = -1;
        connect();
        touched = false;
        reheat(0.45);
      },
      /** Sizes the nodes by a number each, or all the same without. */
      size(values) {
        sizes = values ? { values, most: Math.max(...values, 0) } : undefined;
        redraw();
      },
      select(index) {
        selected = index;
        inform();
        redraw();
      },
      /** Starts the layout again and lets go of every node that was put somewhere. */
      relayout() {
        pinned.clear();
        points = seed(nodes, board.groups?.length ?? 1);
        touched = false;
        alpha = 1;
        redraw();
      },
      /** How many relations each node has among what shows. */
      degree: () => degree,
      image: () => new Promise((resolve) => canvas.toBlob(resolve, "image/png")),
      destroy
    };
  }

  root.BCA_BOARD = { create, seed, step, random };
})(globalThis);
