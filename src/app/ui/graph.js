// The graph of BC Atlas: any part of the atlas (src/app/atlas.js) on one
// canvas, in three forms. "2d" and "3d" are the same simulation in a plane
// or in space: nodes of one group pull together, relations pull their ends
// together, everything else pushes apart. "diagram" lays the same nodes out
// in layers, as boxes, in the direction of their relations. Selection,
// highlight, filter, and export are the same in all three.
(function (root) {
  "use strict";

  const { LINK, random, seed, step, layered } = root.BCA_GRAPH_LAYOUT;
  const { canvasPen, svgPen, shorten, distanceOf, projectOn, radiusOf, frameOn, freeOf, picture, NO_ROUTES, boxWidthOf, drawing } = root.BCA_GRAPH_DRAW;

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
