// The moving half of the figure: two inline skates, the shin posts clamped in
// their cuffs, the link bar on the post pins and the pendulum dial on the bar.
// It is rebuilt for every lean, at build time and in the page, from this one
// module, so the drawing the page starts with and the drawing it animates are
// the same code.
//
// Each skate is one rigid body that rolls by the lean about the line along x
// through the centre of its wheels' tyre section (RHO above the floor), so the
// rounded tyres stay tangent to the floor at every angle. The two posts and the
// bar form a parallelogram: whatever one skate does, the other does too.

export function makeRig(k, G, P, D) {
  const V = G.viewOf(P);
  const L = G.lightOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dt = (points, style) => k.dotsSvg(points, style);
  const depth = (p) => G.dot3(p, V);
  const TAU = Math.PI * 2;
  const { RHO, WHEEL_R, WHEEL_W, WHEELS, H, POST_X, STANCE, LEAD, BAR, DIAL } = D;

  // A convex solid lofted through rings of world points (same count each,
  // bottom to top), painted with the kit's four tones like a prism.
  function loft(rings) {
    const n = rings[0].length;
    const all = rings.flat();
    const centre = G.mul3(all.reduce((sum, p) => G.add3(sum, p), [0, 0, 0]), 1 / all.length);
    const id = (i, j) => i * n + (((j % n) + n) % n);
    const faces = [];
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < n; j++) faces.push([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
    faces.push(Array.from({ length: n }, (_, j) => id(0, j)));
    faces.push(Array.from({ length: n }, (_, j) => id(rings.length - 1, j)));
    const flat = all.map(at);
    const buckets = [[], [], [], [], []];
    const info = faces.map((face) => {
      let normal = [0, 0, 0];
      face.forEach((a, q) => {
        const p = all[a];
        const r = all[face[(q + 1) % face.length]];
        normal = G.add3(normal, [(p[1] - r[1]) * (p[2] + r[2]), (p[2] - r[2]) * (p[0] + r[0]), (p[0] - r[0]) * (p[1] + r[1])]);
      });
      normal = G.unit3(normal);
      const mid = G.mul3(face.reduce((sum, q) => G.add3(sum, all[q]), [0, 0, 0]), 1 / face.length);
      if (G.dot3(normal, G.sub3(mid, centre)) < 0) normal = G.mul3(normal, -1);
      const visible = G.len3(normal) > 0.5 && G.dot3(normal, V) > 1e-6;
      if (visible) buckets[G.bandOf(G.dot3(normal, L))].push(k.pathOf(face.map((q) => flat[q]), true));
      return { normal, visible };
    });
    // Creases run along whole rings, so each one ends on the silhouette rather
    // than wherever the turn between two bands happens to soften.
    const sideAt = (i, j) => info[i * n + (((j % n) + n) % n)];
    const capOf = (i) => info[(rings.length - 1) * n + (i === 0 ? 0 : 1)];
    const creases = [];
    for (let i = 0; i < rings.length; i++) {
      const below = (j) => (i === 0 ? capOf(0) : sideAt(i - 1, j));
      const above = (j) => (i === rings.length - 1 ? capOf(1) : sideAt(i, j));
      let sharp = false;
      for (let j = 0; j < n; j++) if (G.dot3(below(j).normal, above(j).normal) < Math.cos(0.35)) sharp = true;
      if (!sharp) continue;
      for (let j = 0; j < n; j++) if (below(j).visible && above(j).visible) creases.push(k.pathOf([flat[id(i, j)], flat[id(i, j + 1)]]));
    }
    const hull = G.hullOf(flat);
    return { fill: k.pathOf(hull, true), outline: k.pathOf(hull, true), crease: creases.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((list) => list.join("")) };
  }

  // A rounded outline: x = cx ± a·|cos t|^p, y = ±b(t)·|sin t|^p, with the
  // half-width easing from `heel` at the back to `toe` at the front.
  function outline(cx, a, heel, toe, n = 28, p = 0.8) {
    return Array.from({ length: n }, (_, j) => {
      const t = (j / n) * TAU;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const b = heel + (toe - heel) * (1 + c) / 2;
      return [cx + a * Math.sign(c) * Math.abs(c) ** p, b * Math.sign(s) * Math.abs(s) ** p];
    });
  }

  // One rigid skate, rolled by `lean` (positive leans toward −y).
  function body(x0, yc, lean) {
    const c = Math.cos(lean);
    const s = Math.sin(lean);
    const W = ([x, y, z]) => [x0 + x, yc + y * c - (z - RHO) * s, RHO + y * s + (z - RHO) * c];
    const R = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
    const X = R([1, 0, 0]);
    const Y = R([0, 1, 0]);
    const Z = R([0, 0, 1]);
    const O = W([0, 0, 0]);
    return {
      W,
      // A profile in (x, z), extruded across y0..y1.
      side: (poly, y0, y1) => G.prismOf(G.frameOf(O, Y, X, Z), poly, y0, y1, P),
      // A profile in (y, z), extruded along x0..x1.
      cross: (poly, x0a, x1a) => G.prismOf(G.frameOf(O, X, Y, Z), poly, x0a, x1a, P),
      // A profile in (x, y), extruded up z0..z1.
      plan: (poly, z0, z1) => G.prismOf(G.frameOf(O, Z, X, Y), poly, z0, z1, P),
      along: (o, axis) => G.frameOf(W(o), R(axis), ...(axis[0] ? [Y, Z] : axis[1] ? [Z, X] : [X, Y])),
      ring: (points, z) => points.map(([x, y]) => W([x, y, z])),
    };
  }

  const roundRect = (x0, y0, x1, y1, r, steps = 4) => {
    const out = [];
    const corner = (cx, cy, from) => {
      for (let i = 0; i <= steps; i++) {
        const t = from + (i / steps) * (Math.PI / 2);
        out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      }
    };
    corner(x1 - r, y0 + r, -Math.PI / 2);
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    return out;
  };

  const RAIL = [[-74, 44], [-74, 30], [-68, 13], [68, 13], [74, 30], [74, 44]];
  const RAIL_BRAKE = [[-86, 46], [-86, 30], [-68, 13], [68, 13], [74, 30], [74, 44], [-74, 46]];
  const TYRE = (() => {
    const half = WHEEL_W / 2;
    const core = WHEEL_R - half;
    const knots = [-half, -5.5, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 5.5, half];
    return knots.map((s, index) => [s, core + Math.sqrt(Math.max(0, half * half - s * s)), index > 0 && index < knots.length - 1 ? 1 : 0].slice(0, index > 0 && index < knots.length - 1 ? 3 : 2));
  })();
  const SOLE = outline(2, 80, 19, 24);
  const SHELL_LOW = outline(2, 79, 18.4, 23.2);
  const SHELL_TOP = outline(-19, 57, 18, 18, 28, 0.9);
  const cuffAt = (z, grow = 0) => {
    const t = (z - 88) / 62;
    return outline(-48 + 6 * t, 32 - 5 * t + grow, 23 - 2 * t + grow, 23 - 2 * t + grow, 28, 0.9);
  };

  function wheelOf(lean) {
    const B = body(0, 0, lean);
    const F = B.along([0, 0, WHEEL_R], [0, 1, 0]);
    const seam = Ln(G.circleOf(F, WHEEL_W / 2, WHEEL_R - WHEEL_W / 2, P), { tone: "faint" });
    return { centre: F.o, svg: S(G.solidOf(TYRE, F, P), { tone: "hi", crease: "none", inner: seam }) };
  }

  function skate(x0, yc, lean, wheel, { brake = false, arm = 0, tag }) {
    const B = body(x0, yc, lean);
    const out = [];
    const put = (svg) => out.push(svg);
    // Frame: far rail, brake, wheels (back to front), near rail.
    put(S(B.side(brake ? RAIL_BRAKE : RAIL, -10, -7), { tone: "mid" }));
    if (brake) {
      const housing = [[-82, 46], [-82, 22], [-92, 14], [-106, 14], [-110, 24], [-98, 46]];
      put(S(B.side(housing, -7, 7), { tone: "mid" }));
      put(S(B.side([[-92, 14], [-106, 14], [-106, 9], [-94, 8]], -7, 7), { tone: "lo" }));
    }
    // Every wheel at one lean is the same picture, moved: draw it once per frame.
    const wheels = [...WHEELS].sort((a, b) => depth(B.W([a, 0, WHEEL_R])) - depth(B.W([b, 0, WHEEL_R])));
    for (const x of wheels) {
      const [dx, dy] = G.sub3([...at(B.W([x, 0, WHEEL_R])), 0], [...at(wheel.centre), 0]);
      put(`<g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)})">${wheel.svg}</g>`);
    }
    const rail = brake ? RAIL_BRAKE : RAIL;
    const slots = [-41, 0, 41]
      .map((cx) => k.pathOf(roundRect(cx - 9, 34.5, cx + 9, 39.5, 2.5, 3).map(([x, z]) => at(B.W([x, 10, z]))), true))
      .join("");
    put(S(B.side(rail, 7, 10), { tone: "mid", inner: Ln(slots, { tone: "faint" }) }));
    for (const x of WHEELS) {
      const F = B.along([x, 10, WHEEL_R], [0, 1, 0]);
      put(S(G.disc(0, 1.2, 3.2, F, P, { steps: 20 }), { tone: "mid" }));
      put(Dt([at(B.W([x, 11.2, WHEEL_R]))], { size: 0.5, tone: "lo" }));
    }
    if (brake) {
      const F = B.along([-80, 10, 38], [0, 1, 0]);
      put(S(G.disc(0, 1, 2.6, F, P, { steps: 16 }), { tone: "mid" }));
    }
    put(S(B.plan(roundRect(-62, -10, 62, 10, 3), 44, 48), { tone: "mid" }));
    // Boot: sole, shell, tongue and laces, cuff, strap, buckle, rivet, liner collar.
    put(S(B.plan(SOLE, 48, 54), { tone: "lo" }));
    put(S(loft([B.ring(SHELL_LOW, 54), B.ring(SHELL_LOW, 68), B.ring(SHELL_TOP, 92)]), { tone: "hi" }));
    const onCap = (points, closed) => k.pathOf(points.map(([x, y]) => at(B.W([x, y, 92.1]))), closed);
    const tongue = Array.from({ length: 24 }, (_, j) => [10 + 22 * Math.cos((j / 24) * TAU), 8 * Math.sin((j / 24) * TAU)]);
    put(Ln(onCap(tongue, true), { tone: "faint" }));
    const rows = [-4, 6, 16, 26];
    put(Ln(rows.map((x) => onCap([[x, -10.5], [x + 4, 10.5]])).join("") + rows.slice(0, -1).map((x) => onCap([[x + 4, 10.5], [x + 10, -10.5]])).join(""), { tone: "lo" }));
    put(Dt(rows.flatMap((x) => [at(B.W([x, -10.5, 92.1])), at(B.W([x + 4, 10.5, 92.1]))]), { size: 0.55, tone: "mid" }));
    // The cuff's front overlap: a seam up the front, from its lower rim to its top.
    const front = [88, 150].map((z) => B.W([cuffAt(z)[0][0], 0, z]));
    put(S(loft([B.ring(cuffAt(88), 88), B.ring(cuffAt(150), 150)]), { tone: "hi", inner: Ln(k.pathOf(front.map(at)), { tone: "faint" }) }));
    put(S(loft([B.ring(cuffAt(128, 1.2), 128), B.ring(cuffAt(136, 1.2), 136)]), { tone: "mid" }));
    const band = 23 - 2 * ((132 - 88) / 62) + 1.2;
    put(S(B.side(roundRect(-50, 127.5, -38, 136.5, 1.5, 2), band, band + 2), { tone: "mid" }));
    put(Ln(k.pathOf([at(B.W([-48, band + 2, 132])), at(B.W([-40, band + 2, 132]))]), { tone: "lo" }));
    put(Dt([at(B.W([-48, band + 2, 132])), at(B.W([-40, band + 2, 132]))], { size: 0.5, tone: "mid" }));
    const side = 23 - 2 * ((100 - 88) / 62);
    put(S(G.disc(0, 1.4, 4, B.along([-47, side, 100], [0, 1, 0]), P, { steps: 20 }), { tone: "mid" }));
    put(Dt([at(B.W([-47, side + 1.4, 100]))], { size: 0.6, tone: "lo" }));
    put(S(loft([B.ring(cuffAt(150, -3.6), 150), B.ring(cuffAt(156, -4), 156)]), { tone: "mid" }));
    // The jig: clamp on the cuff, the shin post and its pivot eye.
    const CLAMP = B.along([POST_X, 0, 156], [0, 0, 1]);
    put(S(G.disc(0, 6, 11, CLAMP, P), { tone: "mid" }));
    const eyeAt = [POST_X - arm, 0, H];
    const EYE = B.along(eyeAt, [1, 0, 0]);
    if (arm) {
      put(S(G.disc(-6, 6, 8, EYE, P), { tone: "mid" }));
      put(S(G.disc(6, arm - 7, 3.6, EYE, P), { tone: "mid" }));
      put(S(G.disc(162, H - 7, 6, B.along([POST_X, 0, 0], [0, 0, 1]), P), { tone: "mid", crease: "none" }));
      put(S(B.cross(roundRect(-7, H - 7, 7, H + 7, 2, 3), POST_X - 7, POST_X + 7), { tone: "mid" }));
      put(Dt([at(B.W([POST_X + 7, -3.5, H + 3.5])), at(B.W([POST_X + 7, 3.5, H - 3.5]))], { size: 0.45, tone: "lo" }));
    } else {
      put(S(G.disc(162, H - Math.sqrt(64 - 36), 6, B.along([POST_X, 0, 0], [0, 0, 1]), P), { tone: "mid", crease: "none" }));
      put(S(G.disc(-6, 6, 8, EYE, P), { tone: "mid" }));
    }
    put(S(G.disc(6, 7.2, 3, EYE, P, { steps: 20 }), { tone: "mid" }));
    put(Dt([at(B.W([eyeAt[0] + 7.2, 0, H]))], { size: 0.55, tone: "lo" }));
    return `<g data-part="${tag}">${out.join("")}</g>`;
  }

  // Where each post's pivot is for a lean: both move by the same offset.
  const pivotOf = (yc, lean) => [POST_X, yc - (H - RHO) * Math.sin(lean), RHO + (H - RHO) * Math.cos(lean)];

  function scene(lean) {
    const far = pivotOf(-STANCE, lean);
    const near = pivotOf(STANCE, lean);
    const Zb = far[2];
    const mid = [POST_X - 6, (far[1] + near[1]) / 2, Zb];
    const WORLD_X = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const wheel = wheelOf(lean);
    const out = [];
    // Link bar behind both eyes.
    const bar = roundRect(far[1] - BAR.over, Zb - BAR.half, near[1] + BAR.over, Zb + BAR.half, 4);
    const slot = (y0, y1) => k.pathOf(roundRect(y0, Zb - 2, y1, Zb + 2, 2, 3).map(([y, z]) => at([POST_X - 6, y, z])), true);
    out.push(S(G.prismOf(WORLD_X, bar, POST_X - 12, POST_X - 6, P), { tone: "mid", inner: Ln(slot(far[1] + 16, mid[1] - 16) + slot(mid[1] + 16, near[1] - 16), { tone: "faint" }) }));
    // Pendulum dial: a thin sector plate on the bar's face with a degree scale.
    const dirOf = (deg) => {
      const a = (deg * Math.PI) / 180;
      return [0, Math.sin(a), -Math.cos(a)];
    };
    const onDial = (deg, r, x = mid[0] + 1.05) => G.add3([x, mid[1], mid[2]], G.mul3(dirOf(deg), r));
    const sector = [[0, 0]];
    for (let deg = DIAL.from; deg <= DIAL.to + 1e-9; deg += 2) sector.push([Math.sin((deg * Math.PI) / 180) * DIAL.r, -Math.cos((deg * Math.PI) / 180) * DIAL.r]);
    const PLATE = G.frameOf([0, mid[1], mid[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    out.push(S(G.prismOf(PLATE, sector, mid[0], mid[0] + 1, P), { tone: "hi", crease: "lo" }));
    const minor = [];
    const major = [];
    for (let deg = DIAL.from; deg <= DIAL.to; deg += 2) (deg % 10 === 0 ? major : minor).push(deg);
    out.push(Ln(minor.map((deg) => k.pathOf([at(onDial(deg, DIAL.r)), at(onDial(deg, DIAL.r - 3.4))])).join(""), { tone: "lo" }));
    out.push(Ln(major.filter((deg) => deg).map((deg) => k.pathOf([at(onDial(deg, DIAL.r)), at(onDial(deg, DIAL.r - 6.5))])).join(""), { tone: "mid" }));
    out.push(Ln(k.pathOf([at(onDial(0, DIAL.r)), at(onDial(0, DIAL.r - 6.5))]), { tone: "hi" }));
    out.push(Dt([8, 32].map((deg) => at(onDial(deg, 20))), { size: 0.45, tone: "lo" }));
    // Far skate: the inside one, 12 cm ahead, with the heel brake and the arm back to its pivot.
    out.push(skate(LEAD, -STANCE, lean, wheel, { brake: true, arm: LEAD, tag: "inside" }));
    // Needle and bob: they hang along gravity plus the centripetal pull, at the lean.
    const HUB = G.frameOf([mid[0] + 1, mid[1], mid[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const tip = onDial(lean * 180 / Math.PI, DIAL.r - 5, mid[0] + 2.2);
    const root = onDial(lean * 180 / Math.PI, 3.2, mid[0] + 2.2);
    out.push(`<path class="iso-line" data-tone="lit" data-free="end" d="${k.pathOf([at(root), at(tip)])}" style="stroke-width:1.1"/>`);
    const BOB = G.frameOf(onDial(lean * 180 / Math.PI, DIAL.bob, mid[0] + 1), [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    out.push(S(G.disc(0.6, 3, 6, BOB, P), { tone: "hi", lit: true }));
    out.push(Ln(G.circleOf(BOB, 3, 3.4, P), { tone: "lit" }));
    out.push(S(G.disc(0, 2.2, 3.2, HUB, P, { steps: 20 }), { tone: "mid" }));
    out.push(Dt([at([mid[0] + 3.2, mid[1], mid[2]])], { size: 0.55, tone: "lo" }));
    // Near skate: the outside one.
    out.push(skate(0, STANCE, lean, wheel, { tag: "outside" }));
    return out.join("");
  }

  return { scene, pivotOf };
}
