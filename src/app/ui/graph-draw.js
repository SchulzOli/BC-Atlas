// The pictures of the graph of BC Atlas (graph.js): what the camera sees of a
// layout, drawn through a pen: on a canvas in the page, or as SVG for files
// and `bca view`. The same picture through both.
(function (root) {
  "use strict";

  const { TAU, LINK, MAX_LABELS, random, seed, step, layered } = root.BCA_GRAPH_LAYOUT;

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

  root.BCA_GRAPH_DRAW = { canvasPen, svgPen, shorten, extentOf, distanceOf, projectOn, radiusOf, frameOn, freeOf, picture, NO_ROUTES, boxWidthOf, drawing };
})(globalThis);
