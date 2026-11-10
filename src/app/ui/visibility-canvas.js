// The visibility canvas of the Diagrams page: every data point of the
// analyzed apps (src/visibility.js) as a circle in the color of its level.
// Graphs in graphs: an app holds its objects, an object its members, and a
// member the data points it uses and that use it, which open again, without
// an end. In every circle what is local sits at the core and what is public
// at the rim. The view re-roots on the circle that fills the window, so
// zooming never runs out of numbers.
(function (root) {
  "use strict";

  const LEVELS = ["public", "internal", "local"];
  const REACH = ["other apps", "this app", "this object"];
  const COLORS = { light: ["#D55E00", "#0072B2", "#009E73"], dark: ["#d95926", "#3987e5", "#199e70"] };
  const TAU = Math.PI * 2;
  // A circle shows what is inside from this radius on (pixels), and its links from the second.
  const OPEN = 16;
  const LINKS = 70;
  const MAX_LINKS = 2500;
  const MAX_PAINTED = 30000;

  /** The compact payload as points with children and uses in both directions. */
  function index(data) {
    const points = data.points.map(([kind, parent, name, type, level, canBe, why, page, declared], id) =>
      ({ id, kind, parent, name, type, level, canBe, why, page, declared, children: [], out: [], in: [], size: 1 }));
    for (const point of points) if (point.parent >= 0) points[point.parent].children.push(point.id);
    for (const [from, to, level, weight] of data.uses) {
      points[from].out.push({ to, level, weight });
      points[to].in.push({ from, level, weight });
    }
    // The area of a circle: its members, so a large object is a large circle.
    for (let id = points.length - 1; id >= 0; id--) {
      const point = points[id];
      if (point.kind === "field") point.size = 0.6;
      if (point.children.length) point.size = 1.5 + point.children.reduce((total, child) => total + points[child].size, 0) * 1.25;
    }
    return { points, roots: points.filter(({ parent }) => parent < 0).map(({ id }) => id) };
  }

  /**
   * Circles along one spiral from the center outward, in the given order,
   * none overlapping. @returns [{ x, y, r }] inside the unit circle
   */
  function pack(radii) {
    const count = radii.length;
    if (!count) return [];
    const cell = 2 * Math.max(...radii) * 1.08;
    const grid = new Map();
    const circles = [];
    const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const free = (x, y, r) => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let ix = cx - 1; ix <= cx + 1; ix++) {
        for (let iy = cy - 1; iy <= cy + 1; iy++) {
          for (const other of grid.get(`${ix},${iy}`) ?? []) {
            const distance = (r + other.r) * 1.08;
            if ((x - other.x) ** 2 + (y - other.y) ** 2 < distance * distance) return false;
          }
        }
      }
      return true;
    };
    let theta = 0;
    let rho = 0;
    for (const r of radii) {
      for (;;) {
        const x = rho * Math.cos(theta);
        const y = rho * Math.sin(theta);
        if (free(x, y, r)) {
          const circle = { x, y, r };
          circles.push(circle);
          const slot = key(x, y);
          if (!grid.has(slot)) grid.set(slot, []);
          grid.get(slot).push(circle);
          break;
        }
        const step = r * 0.4;
        const turn = step / Math.max(rho, step);
        theta += turn;
        rho += 2.16 * r * turn / TAU;
      }
    }
    // The circle around them all: its center moves toward whatever is farthest out.
    let mx = 0;
    let my = 0;
    const reach = ({ x, y, r }) => Math.hypot(x - mx, y - my) + r;
    for (let round = 1; round <= 60; round++) {
      const far = circles.reduce((a, b) => (reach(b) > reach(a) ? b : a));
      const distance = Math.hypot(far.x - mx, far.y - my);
      if (distance < 1e-9) break;
      const move = reach(far) / (round + 1) / distance;
      mx += (far.x - mx) * move;
      my += (far.y - my) * move;
    }
    const extent = Math.max(...circles.map(reach));
    const scale = (count === 1 ? 0.62 : 0.93) / extent;
    return circles.map(({ x, y, r }) => ({ x: (x - mx) * scale, y: (y - my) * scale, r: r * scale }));
  }

  /**
   * @param container the element that gets the canvas
   * @param data the compact visibility analysis (compactVisibility)
   * @param onInfo called with { path, hover, selected } whenever one changes
   */
  function create(container, data, { onInfo = () => {} } = {}) {
    const { points, roots } = index(data);
    const canvas = document.createElement("canvas");
    canvas.className = "vis-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Every data point as a circle in the color of its level; scroll to zoom into graphs inside graphs");
    container.prepend(canvas);
    const context = canvas.getContext("2d");
    const node = (pid, parent, direction) => ({ pid, parent, direction, x: 0, y: 0, r: 1, kids: undefined, links: undefined });
    const universe = node(-1, null);
    let width = 1;
    let height = 1;
    let frame = universe;
    // screen = position in the frame's unit circle * k + (tx, ty)
    let k = 1;
    let tx = 0;
    let ty = 0;
    let hover;
    let selected;
    let showCanBe = true;
    let active = new Set(LEVELS.keys());
    let animation = 0;
    let scheduled = 0;
    let painted = 0;
    let destroyed = false;

    // What a circle holds: an app its objects, an object its members, a
    // member the points it uses and that use it.
    function kidsOf(view) {
      if (view.kids) return view.kids;
      const point = points[view.pid];
      let ids;
      const directions = new Map();
      if (!point) ids = roots;
      else if (point.kind === "app" || point.kind === "object") ids = point.children;
      else {
        for (const { from } of point.in) directions.set(from, "in");
        for (const { to } of point.out) directions.set(to, directions.has(to) ? "both" : "out");
        ids = [...directions.keys()];
      }
      // Local at the core, public at the rim; inside a level the large ones first.
      const ordered = [...ids].sort((a, b) => points[b].level - points[a].level || points[b].size - points[a].size || a - b);
      const circles = pack(ordered.map((id) => Math.sqrt(points[id].size)));
      view.kids = ordered.map((id, position) => Object.assign(node(id, view, directions.get(id)), circles[position]));
      return view.kids;
    }

    // Uses between the circles inside one circle: a use of anything in A by
    // anything in B is one link from B to A, as wide as its widest use.
    function linksOf(view) {
      if (view.links) return view.links;
      const kids = kidsOf(view);
      const position = new Map(kids.map((kid, at) => [kid.pid, at]));
      const owner = (id) => {
        for (let at = id; at >= 0; at = points[at].parent) if (position.has(at)) return position.get(at);
        return -1;
      };
      const found = new Map();
      const collect = (id, from) => {
        for (const { to, level } of points[id].out) {
          const target = owner(to);
          if (target < 0 || target === from) continue;
          const slot = from * kids.length + target;
          found.set(slot, Math.min(found.get(slot) ?? 2, level));
        }
        for (const child of points[id].children) collect(child, from);
      };
      kids.forEach((kid, at) => collect(kid.pid, at));
      view.links = [...found].slice(0, MAX_LINKS).map(([slot, level]) => ({ from: Math.floor(slot / kids.length), to: slot % kids.length, level }));
      return view.links;
    }

    const hasKids = (view) => {
      const point = points[view.pid];
      return !point || (point.kind === "app" || point.kind === "object" ? point.children.length > 0 : point.in.length + point.out.length > 0);
    };
    const diagonal = () => Math.hypot(width, height) / 2;
    const covers = (cx, cy, r) => r - Math.hypot(cx - width / 2, cy - height / 2) > diagonal();

    // The frame is the smallest circle that fills the window, so the numbers stay small.
    function reframe() {
      for (let guard = 0; guard < 80; guard++) {
        const inside = hasKids(frame) ? kidsOf(frame).find((kid) => covers(kid.x * k + tx, kid.y * k + ty, kid.r * k)) : undefined;
        if (inside) {
          tx += inside.x * k;
          ty += inside.y * k;
          k *= inside.r;
          frame = inside;
        } else if (frame.parent && !covers(tx, ty, k)) {
          k /= frame.r;
          tx -= frame.x * k;
          ty -= frame.y * k;
          frame = frame.parent;
        } else break;
      }
      // Nothing is outside the universe, and nothing inside a point without uses.
      const least = Math.min(width, height) * 0.2;
      if (frame === universe && k < least) {
        tx = width / 2 + (tx - width / 2) * least / k;
        ty = height / 2 + (ty - height / 2) * least / k;
        k = least;
      }
      const most = Math.max(width, height) * 3;
      if (!hasKids(frame) && k > most) {
        tx = width / 2 + (tx - width / 2) * most / k;
        ty = height / 2 + (ty - height / 2) * most / k;
        k = most;
      }
    }

    /** Where a view is on the screen, whatever the frame. */
    function circleOf(target) {
      const above = new Set();
      for (let view = frame; view; view = view.parent) above.add(view);
      const down = [];
      let common = target;
      while (!above.has(common)) {
        down.push(common);
        common = common.parent;
      }
      let x = tx;
      let y = ty;
      let r = k;
      for (let view = frame; view !== common; view = view.parent) {
        r /= view.r;
        x -= view.x * r;
        y -= view.y * r;
      }
      for (const view of down.reverse()) {
        x += view.x * r;
        y += view.y * r;
        r *= view.r;
      }
      return { x, y, r };
    }

    function theme() {
      const style = getComputedStyle(container);
      const value = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
      const dark = document.documentElement.dataset.theme === "dark";
      return {
        colors: dark ? COLORS.dark : COLORS.light,
        background: dark ? "#16181d" : "#ffffff",
        text: value("--text", dark ? "#e6e8eb" : "#1f2937"),
        muted: value("--muted", dark ? "#9aa3af" : "#6b7280")
      };
    }

    const alpha = (hex, opacity) => `${hex}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`;

    function fitted(text, limit) {
      if (context.measureText(text).width <= limit) return text;
      let cut = text.length;
      while (cut > 1 && context.measureText(`${text.slice(0, cut)}…`).width > limit) cut--;
      return cut > 1 ? `${text.slice(0, cut)}…` : "";
    }

    function label(view, cx, cy, r, look, opened) {
      const point = points[view.pid];
      if (!point || r < (opened ? 44 : 24) || r > Math.max(width, height) * 1.5) return;
      const arrow = view.direction === "in" ? "← " : view.direction === "out" ? "→ " : view.direction === "both" ? "↔ " : "";
      const size = Math.max(10, Math.min(15, r * 0.2));
      // An open circle wears its name on the rim; a closed one in its middle.
      context.font = `600 ${size}px ${look.font}`;
      const limit = opened ? r * 1.1 : r * 1.75;
      // An object that does not fit with its type and ID shows its name alone.
      const whole = arrow + point.name;
      const short = point.kind === "object" && context.measureText(whole).width > limit ? arrow + point.name.replace(/^\S+ (?:\d+ )?/u, "") : whole;
      const name = fitted(short, limit);
      if (!name) return;
      const y = opened ? cy - r * 0.97 : cy;
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (opened) {
        const half = context.measureText(name).width / 2 + 6;
        context.fillStyle = alpha(look.background, 0.82);
        context.beginPath();
        context.roundRect(cx - half, y - size * 0.75, half * 2, size * 1.5, 5);
        context.fill();
      }
      context.fillStyle = look.text;
      context.fillText(name, cx, y);
      if (!opened && r >= 46) {
        context.font = `${Math.max(9, size * 0.78)}px ${look.font}`;
        context.fillStyle = alpha(look.text.length === 7 ? look.text : look.muted, 0.75);
        const state = point.canBe >= 0 && showCanBe ? `${LEVELS[point.level]}, can be ${LEVELS[point.canBe]}` : LEVELS[point.level];
        const detail = fitted(point.kind === "object" || point.kind === "app" ? state : `${point.kind} · ${state}`, r * 1.6);
        if (detail) context.fillText(detail, cx, cy + size * 1.25);
      }
    }

    function paint(view, cx, cy, r, look) {
      if (cx + r < 0 || cx - r > width || cy + r < 0 || cy - r > height || painted++ > MAX_PAINTED) return;
      const point = points[view.pid];
      const dim = point && !active.has(point.level);
      const color = point ? look.colors[point.level] : look.muted;
      const opened = r >= OPEN && hasKids(view);
      if (point) {
        if (r < 1.5) {
          context.fillStyle = alpha(color, dim ? 0.2 : 0.9);
          context.fillRect(cx - 1, cy - 1, 2, 2);
          return;
        }
        const whole = covers(cx, cy, r);
        context.fillStyle = alpha(color, dim ? 0.03 : opened ? 0.07 : r > 30 ? 0.2 : 0.85);
        if (whole) context.fillRect(0, 0, width, height);
        else {
          context.beginPath();
          context.arc(cx, cy, r, 0, TAU);
          context.fill();
          context.lineWidth = view === selected ? 3 : view === hover ? 2.4 : Math.min(2, 0.6 + r / 60);
          context.strokeStyle = alpha(color, dim ? 0.25 : 1);
          context.stroke();
        }
        // What it can be: a core in the color of the narrower level.
        if (showCanBe && point.canBe >= 0 && !dim && !whole) {
          const core = look.colors[point.canBe];
          if (opened || r > 30) {
            context.setLineDash([Math.max(3, r * 0.05), Math.max(3, r * 0.05)]);
            context.lineWidth = Math.max(1.5, Math.min(4, r * 0.03));
            context.strokeStyle = core;
            context.beginPath();
            context.arc(cx, cy, r - context.lineWidth * 1.6, 0, TAU);
            context.stroke();
            context.setLineDash([]);
          } else {
            context.fillStyle = core;
            context.beginPath();
            context.arc(cx, cy, r * 0.5, 0, TAU);
            context.fill();
            // A ring of the surface keeps the core apart from its circle.
            context.lineWidth = Math.min(2, r * 0.18);
            context.strokeStyle = look.background;
            context.stroke();
          }
        }
      }
      if (!opened) return label(view, cx, cy, r, look, false);
      const kids = kidsOf(view);
      if (r >= LINKS) {
        const emphasized = hover?.parent === view ? kids.indexOf(hover) : -1;
        for (const link of linksOf(view)) {
          const from = kids[link.from];
          const to = kids[link.to];
          const x1 = cx + from.x * r;
          const y1 = cy + from.y * r;
          const x2 = cx + to.x * r;
          const y2 = cy + to.y * r;
          const length = Math.hypot(x2 - x1, y2 - y1);
          if (length < 4) continue;
          const strong = emphasized === link.from || emphasized === link.to;
          const ux = (x2 - x1) / length;
          const uy = (y2 - y1) / length;
          // From rim to rim, bent a little so both directions show.
          const sx = x1 + ux * from.r * r;
          const sy = y1 + uy * from.r * r;
          const ex = x2 - ux * to.r * r;
          const ey = y2 - uy * to.r * r;
          const bend = Math.min(40, length * 0.12);
          context.strokeStyle = alpha(look.colors[link.level], strong ? 0.95 : emphasized >= 0 ? 0.1 : 0.42);
          context.lineWidth = strong ? 2 : 1;
          context.beginPath();
          context.moveTo(sx, sy);
          context.quadraticCurveTo((sx + ex) / 2 - uy * bend, (sy + ey) / 2 + ux * bend, ex, ey);
          context.stroke();
          if (to.r * r > 5) {
            const angle = Math.atan2(ey - ((sy + ey) / 2 + ux * bend), ex - ((sx + ex) / 2 - uy * bend));
            const head = strong ? 8 : 6;
            context.fillStyle = context.strokeStyle;
            context.beginPath();
            context.moveTo(ex, ey);
            context.lineTo(ex - head * Math.cos(angle - 0.4), ey - head * Math.sin(angle - 0.4));
            context.lineTo(ex - head * Math.cos(angle + 0.4), ey - head * Math.sin(angle + 0.4));
            context.fill();
          }
        }
      }
      for (const kid of kids) paint(kid, cx + kid.x * r, cy + kid.y * r, kid.r * r, look);
      label(view, cx, cy, r, look, true);
    }

    function draw() {
      scheduled = 0;
      if (destroyed) return;
      // The page was drawn again without this canvas.
      if (!canvas.isConnected) return destroy();
      const ratio = root.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const look = { ...theme(), font: getComputedStyle(container).fontFamily || "sans-serif" };
      context.fillStyle = look.background;
      context.fillRect(0, 0, width, height);
      painted = 0;
      paint(frame, tx, ty, k, look);
    }
    const redraw = () => { scheduled ||= requestAnimationFrame(draw); };
    let observer;
    let themes;
    function destroy() {
      destroyed = true;
      cancelAnimationFrame(animation);
      cancelAnimationFrame(scheduled);
      observer?.disconnect();
      themes?.disconnect();
      canvas.remove();
    }

    const describe = (view) => {
      const point = points[view?.pid];
      if (!point) return undefined;
      return {
        name: point.name,
        kind: point.kind,
        type: point.type,
        level: LEVELS[point.level],
        reach: REACH[point.level],
        canBe: point.canBe >= 0 ? LEVELS[point.canBe] : undefined,
        why: point.why ?? undefined,
        declared: point.declared ?? undefined,
        uses: point.out.length,
        usedBy: point.in.length,
        page: point.page ?? (point.kind === "app" ? undefined : points[point.parent]?.page) ?? undefined
      };
    };
    /** The circle one is looking at: the deepest one around the middle of the window that fills a good part of it. */
    function focused() {
      const least = Math.min(width, height) * 0.3;
      let view = frame;
      let cx = tx;
      let cy = ty;
      let r = k;
      for (;;) {
        if (r < OPEN || !hasKids(view)) return view;
        const kid = kidsOf(view).find((candidate) => candidate.r * r >= least && Math.hypot(cx + candidate.x * r - width / 2, cy + candidate.y * r - height / 2) <= candidate.r * r);
        if (!kid) return view;
        cx += kid.x * r;
        cy += kid.y * r;
        r *= kid.r;
        view = kid;
      }
    }
    const out = () => {
      const parent = focused().parent;
      if (!parent || parent.pid < 0) fit();
      else flyTo(parent);
    };
    function inform() {
      const path = [];
      for (let view = focused(); view && view.pid >= 0; view = view.parent) path.unshift(view);
      onInfo({
        // A long way down, only the last steps are named.
        path: path.slice(-4).map((view) => ({ ...describe(view), view })),
        depth: path.length,
        hover: describe(hover),
        selected: describe(selected)
      });
    }

    function hit(x, y) {
      let view = frame;
      let cx = tx;
      let cy = ty;
      let r = k;
      for (;;) {
        if (r < OPEN || !hasKids(view)) return view;
        const kid = kidsOf(view).find((candidate) => candidate.r * r >= 2.5 && Math.hypot(cx + candidate.x * r - x, cy + candidate.y * r - y) <= candidate.r * r);
        if (!kid) return view;
        cx += kid.x * r;
        cy += kid.y * r;
        r *= kid.r;
        view = kid;
      }
    }

    function zoom(factor, x = width / 2, y = height / 2) {
      k *= factor;
      tx = x - (x - tx) * factor;
      ty = y - (y - ty) * factor;
      reframe();
      inform();
      redraw();
    }

    /** Moves the window until a circle fills it. */
    function flyTo(target, share = 0.44) {
      cancelAnimationFrame(animation);
      const still = root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      let steps = 0;
      const step = () => {
        const circle = circleOf(target);
        const wanted = Math.min(width, height) * share;
        const done = still || steps++ > 90 || (Math.abs(Math.log(wanted / circle.r)) < 0.01 && Math.hypot(circle.x - width / 2, circle.y - height / 2) < 0.5);
        const ease = done ? 1 : 0.16;
        const factor = (wanted / circle.r) ** ease;
        const x = circle.x + (width / 2 - circle.x) * ease;
        const y = circle.y + (height / 2 - circle.y) * ease;
        k *= factor;
        tx = x - (circle.x - tx) * factor;
        ty = y - (circle.y - ty) * factor;
        reframe();
        inform();
        redraw();
        if (!done && !destroyed) animation = requestAnimationFrame(step);
      };
      step();
    }

    function fit() {
      cancelAnimationFrame(animation);
      frame = universe;
      // One app alone fills the window.
      const only = roots.length === 1 ? kidsOf(universe)[0] : undefined;
      k = Math.min(width, height) * (only ? 0.45 / only.r : 0.48);
      tx = width / 2 - (only ? only.x * k : 0);
      ty = height / 2 - (only ? only.y * k : 0);
      reframe();
      inform();
      redraw();
    }

    function resize() {
      const box = container.getBoundingClientRect();
      const first = width === 1 && height === 1;
      const ratio = root.devicePixelRatio || 1;
      tx += (box.width - width) / 2;
      ty += (box.height - height) / 2;
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (first) fit();
      else {
        reframe();
        redraw();
      }
    }

    // ------------------------------------------------------------- input
    const local = (event) => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    let drag;
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      cancelAnimationFrame(animation);
      const { x, y } = local(event);
      zoom(Math.exp(-event.deltaY * (event.deltaMode ? 0.05 : 0.0016)), x, y);
    }, { passive: false });
    canvas.addEventListener("pointerdown", (event) => {
      const { x, y } = local(event);
      drag = { x, y, moved: 0 };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      const { x, y } = local(event);
      if (drag) {
        drag.moved += Math.abs(x - drag.x) + Math.abs(y - drag.y);
        if (drag.moved > 4) {
          cancelAnimationFrame(animation);
          container.classList.add("dragging");
          tx += x - drag.x;
          ty += y - drag.y;
          reframe();
          inform();
          redraw();
        }
        drag.x = x;
        drag.y = y;
        return;
      }
      const found = hit(x, y);
      const next = found === frame ? undefined : found;
      if (next !== hover) {
        hover = next;
        canvas.style.cursor = hover ? "pointer" : "";
        inform();
        redraw();
      }
    });
    canvas.addEventListener("pointerup", (event) => {
      const moved = drag?.moved ?? 0;
      drag = undefined;
      container.classList.remove("dragging");
      if (moved > 4) return;
      const { x, y } = local(event);
      const found = hit(x, y);
      // A click on a circle fills the window with it: into a small one, out to the one around.
      if (found.pid < 0) {
        selected = undefined;
        return fit();
      }
      selected = found;
      flyTo(found);
    });
    canvas.addEventListener("pointerleave", () => {
      if (!hover) return;
      hover = undefined;
      inform();
      redraw();
    });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "Escape") out();
      else if (event.key === "0" || event.key === "Home") fit();
      else if (event.key === "+" || event.key === "=") zoom(1.3);
      else if (event.key === "-") zoom(1 / 1.3);
      else return;
      event.preventDefault();
    });
    observer = new ResizeObserver(resize);
    observer.observe(container);
    themes = new MutationObserver(redraw);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    resize();

    return {
      fit,
      zoom,
      /** Goes out one circle. */
      up: out,
      flyTo(view) {
        selected = view;
        flyTo(view);
      },
      /** Goes to the first data point whose name contains the text; false when none does. */
      find(text) {
        const query = text.trim().toLowerCase();
        if (!query) return true;
        const matches = points.filter(({ kind, name }) => kind !== "app" && name.toLowerCase().includes(query));
        const match = matches.find(({ name }) => name.toLowerCase() === query) ?? matches.find(({ kind }) => kind === "object") ?? matches[0];
        if (!match) return false;
        const chain = [];
        for (let id = match.id; id >= 0; id = points[id].parent) chain.unshift(id);
        let view = universe;
        for (const id of chain) view = kidsOf(view).find(({ pid }) => pid === id);
        selected = view;
        flyTo(view);
        return true;
      },
      /** Which levels stand out, and whether what a point can be shows. */
      show({ levels, canBe } = {}) {
        if (levels) active = new Set(levels.map((level) => LEVELS.indexOf(level)));
        if (canBe !== undefined) showCanBe = canBe;
        redraw();
      },
      /** The window as it is now, as a PNG blob. */
      image: () => new Promise((resolve) => canvas.toBlob(resolve, "image/png")),
      destroy
    };
  }

  root.BCA_VISIBILITY = { create, index, pack, LEVELS, REACH, COLORS };
})(globalThis);
