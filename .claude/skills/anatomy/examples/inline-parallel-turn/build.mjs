import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import * as G from "../../kit/lathe.mjs";
import { kitScript } from "../../scripts/inline-kit.mjs";
import * as M from "./model.mjs";
import { makeRig } from "./rig.mjs";

// Fig 9: the parallel turn on inline skates ("Kurven fahren im Parallelschwung").
// World units are 2 mm: an 80 mm wheel has a radius of 20.

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 620;
const HEIGHT = 440;
const UNITS_PER_M = 500;

const RIG = {
  RHO: 6,
  WHEEL_R: 20,
  WHEEL_W: 12,
  WHEELS: [-61.5, -20.5, 20.5, 61.5],
  H: 216,
  POST_X: -42,
  STANCE: (M.STANCE_CM * 10) / 2 / 2,
  LEAD: (M.LEAD_CM * 10) / 2,
  BAR: { over: 14, half: 10 },
  DIAL: { r: 64, from: -6, to: 46, bob: 40 },
};

const PLATE = { x: -132, y: -114, w: 304, d: 228, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;
const GROOVE = k.insetPlan(PLATE, 5);
const STRIP = { x: -112, y: 88, w: 264, d: 8, r: 1 };
const SLIDE = { x: -116, y: 99, w: 272, d: 5, r: 1 };
const SLIDE_H = 2;
const KNOB = [146, 0];
const KNOB_ANGLES = [-60, 0, 60];
const speedX = (kmh) => -100 + (kmh - M.SPEEDS[0]) * 20;

const start = { speed: 14, radius: 1 };
const startLean = M.leanOf(start.speed, M.RADII[start.radius]);
const MAX_LEAN = M.leanOf(M.SPEEDS[1], M.RADII[0]);

const probe = makeRig(k, G, { origin: [0, 0], scale: 1, azimuth: 40, elevation: 30 }, RIG);
const extremes = [0, MAX_LEAN].flatMap((lean) => {
  const far = probe.pivotOf(-RIG.STANCE, lean);
  const near = probe.pivotOf(RIG.STANCE, lean);
  return [
    [far[0], far[1] - RIG.BAR.over, far[2] + RIG.BAR.half],
    [near[0], near[1] + RIG.BAR.over, near[2] + RIG.BAR.half],
    [far[0], (far[1] + near[1]) / 2, far[2] - RIG.DIAL.r],
  ];
});
const P = k.fitProjection([...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...extremes], WIDTH, HEIGHT, { pad: 34, azimuth: 40 });
const rig = makeRig(k, G, P, RIG);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// The two wheel tracks of the turn, painted on the plate at their true
// curvature: the turn's centre is r metres off to the right (−y).
function tracks(radius) {
  const R = radius * UNITS_PER_M;
  const centreX = RIG.LEAD / 2;
  const lane = (offset) => {
    const points = [];
    for (let x = GROOVE.x; x <= GROOVE.x + GROOVE.w + 1e-9; x += 6) points.push([x, -R + Math.sqrt((R + offset) ** 2 - (x - centreX) ** 2)]);
    return k.onTop(points, 0, P);
  };
  return lane(-RIG.STANCE) + lane(RIG.STANCE);
}

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "lo", inner: L(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(GROOVE, 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  out.push(`<path class="iso-line" data-part="tracks" data-tone="faint" d="${tracks(M.RADII[start.radius])}"/>`);
  // Soft shadows under the two skates.
  for (const plan of [{ x: -86, y: 30, w: 172, d: 52, r: 22 }, { x: -60, y: -82, w: 206, d: 52, r: 22 }]) {
    out.push(`<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(5px)"/>`);
  }
  // Speed scale and its slide.
  out.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(speedX(M.SPEEDS[0]), speedX(M.SPEEDS[1]), 10, 4, STRIP.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([STRIP.x + 3, STRIP.y + 4, 0.6]), at([STRIP.x + STRIP.w - 3, STRIP.y + 4, 0.6])], { size: 0.45 }));
  out.push(S(k.slabOf(SLIDE, 0, SLIDE_H, P, 3, 0.4), { tone: "mid" }));
  for (const x of [SLIDE.x - 6, SLIDE.x + SLIDE.w]) {
    out.push(S(k.slabOf({ x, y: SLIDE.y - 2, w: 6, d: SLIDE.d + 4, r: 1.2 }, 0, 6, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([x + 3, SLIDE.y + SLIDE.d / 2, 6])], { size: 0.45 }));
  }
  // Label plate.
  const label = { x: 98, y: 36, w: 32, d: 20, r: 2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: "faint" }));
  out.push(L([[5, 24], [10, 20], [15, 14]].map(([y, w]) => k.lineOnTop([label.x + 5, label.y + y - 1], [label.x + 5 + w, label.y + y - 1], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3.5, label.y + 3.5, 0.8]), at([label.x + label.w - 3.5, label.y + label.d - 3.5, 0.8])], { size: 0.45 }));
  // Radius selector: a dial plate with three stops and a knurled knob.
  const [kx, ky] = KNOB;
  out.push(S(k.cylinder(kx, ky, 16, 0, 0.8, P, 56), { tone: "lo" }));
  const dir = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
  out.push(L(KNOB_ANGLES.map((deg) => k.lineOnTop([kx + dir(deg)[0] * 16, ky + dir(deg)[1] * 16], [kx + dir(deg)[0] * 12, ky + dir(deg)[1] * 12], 0.8, P)).join(""), { tone: "mid" }));
  out.push(S(k.cylinder(kx, ky, 9, 0.8, 2, P, 40), { tone: "mid" }));
  out.push(S(k.cylinder(kx, ky, 7, 2.8, 6, P, 40, 0.4), { tone: "mid" }));
  out.push(L(k.knurl(kx, ky, 7, 2.8, 8.8, 36, P), { tone: "lo" }));
  return out.join("");
}

const knobPointer = (index) => {
  const [kx, ky] = KNOB;
  const a = (KNOB_ANGLES[index] * Math.PI) / 180;
  return k.lineOnTop([kx, ky], [kx + Math.sin(a) * 7, ky - Math.cos(a) * 7], 8.8, P);
};

function carriage() {
  const block = { x: -7, y: SLIDE.y - 1, w: 14, d: SLIDE.d + 2, r: 1.6 };
  const out = [];
  out.push(S(k.slabOf({ x: -1.2, y: STRIP.y + 3, w: 2.4, d: block.y - STRIP.y - 3 + 1, r: 0.6 }, SLIDE_H, 0.8, P, 2), { tone: "hi", crease: "lo" }));
  out.push(S(k.slabOf(block, SLIDE_H, 4, P, 4, 0.5), { tone: "mid" }));
  out.push(D([at([block.x + 2.4, block.y + block.d - 2, SLIDE_H + 4]), at([block.x + block.w - 2.4, block.y + block.d - 2, SLIDE_H + 4])], { size: 0.4, tone: "lo" }));
  out.push(S(k.cylinder(0, SLIDE.y + SLIDE.d / 2, 3.2, SLIDE_H + 4, 3, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(0, SLIDE.y + SLIDE.d / 2, 3.2, SLIDE_H + 4, SLIDE_H + 7, 20, P), { tone: "lo" }));
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A pair of inline skates in a lean jig on a track plate. A shin post stands in each cuff and the two posts are pinned to one link bar, so both skates always lean by the same angle. The inside skate rides 12 cm ahead. A pendulum dial on the bar reads the lean, which follows the speed set on the slide and the turn radius set on the knob.",
  body: [
    base(),
    `<path class="iso-line" data-part="knob" data-tone="hi" d="${knobPointer(start.radius)}" style="stroke-width:0.9"/>`,
    D([at([KNOB[0], KNOB[1], 8.8])], { size: 0.6, tone: "hi" }),
    `<g data-part="carriage" transform="${k.translateAlong(P, [speedX(start.speed), 0, 0])}">${carriage()}</g>`,
    `<g data-part="rig">${rig.scene(startLean)}</g>`,
  ],
});

const DATA = { P, rig: RIG, plate: GROOVE, knob: KNOB, knobAngles: KNOB_ANGLES, perM: UNITS_PER_M, start };
const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export /gm, "");
const latheSource = readFileSync(join(HERE, "..", "..", "kit", "lathe.mjs"), "utf8").replace(/^import .*$/m, "").replace(/^export /gm, "");
const latheScript = `const G = (() => {${latheSource}\nreturn { viewOf, lightOf, bandOf, hullOf, frameOf, frameAlong, prismOf, solidOf, disc, circleOf, arcOf, dot3, add3, sub3, mul3, unit3, len3 };})();\n`;
const live = strip("live.js").replace("__DATA__", JSON.stringify(DATA));

const body = k.plateHtml({
  fig: "Fig 9",
  title: "Parallel turn",
  hint: "Hover for speed · click or ↑↓ for radius",
  readout: M.readoutOf(start.speed, M.RADII[start.radius], startLean),
  keys: [
    { mark: "lit", label: "Pendulum: hangs along gravity plus the pull into the turn" },
    { mark: "raised", label: "Skates: both on the same lean, inside skate ahead" },
    { mark: "edge", label: "Shin posts and link bar: a parallelogram" },
  ],
  caption:
    "Kurven fahren im Parallelschwung. Two inline skates (4 × 80 mm wheels, 22 cm apart) stand in a jig whose shin posts are pinned to one bar, so they can only lean together. In a steady turn the lean θ satisfies tan θ = v² / (g · r): gravity and the centripetal pull add up to a line through the wheels, the line the pendulum hangs along in the skater's frame, so the needle and the posts always show the same angle. At 14 km/h on a 5 m circle that is 17°; at 18 km/h on 3 m it is 40°. The outside skate (left, in this right turn) rolls onto its inside edge and the inside skate onto its outside edge, and the inside skate leads by about half a boot, 12 cm. The two painted wheel tracks are drawn at the turn's true curvature.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Parallel turn: left and right arrows set the speed, up and down the turn radius" aria-valuemin="${M.SPEEDS[0]}" aria-valuemax="${M.SPEEDS[1]}" aria-valuenow="${start.speed}">${svg}</div>`,
});

const name = theme === "light" ? "inline-parallel-turn-light.html" : "inline-parallel-turn.html";
const page = k.pageHtml({ title: "Parallel turn", theme, body, script: kitScript() + latheScript + strip("model.mjs") + strip("rig.mjs") + live });
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `lean ${M.degrees(startLean).toFixed(1)}°`);
