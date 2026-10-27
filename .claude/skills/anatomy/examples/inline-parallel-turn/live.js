const D = __DATA__;
const P = D.P;
const K = { iso, pathOf, solidSvg, lineSvg, dotsSvg };
const RIG = makeRig(K, G, P, D.rig);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const rigEl = svg.querySelector('[data-part="rig"]');
const carriage = svg.querySelector('[data-part="carriage"]');
const knob = svg.querySelector('[data-part="knob"]');
const tracksEl = svg.querySelector('[data-part="tracks"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const speedX = (kmh) => -100 + (kmh - SPEEDS[0]) * 20;

function tracks(radius) {
  const R = radius * D.perM;
  const centreX = D.rig.LEAD / 2;
  const lane = (offset) => {
    const points = [];
    for (let x = D.plate.x; x <= D.plate.x + D.plate.w + 1e-9; x += 6) points.push([x, -R + Math.sqrt((R + offset) ** 2 - (x - centreX) ** 2)]);
    return onTop(points, 0, P);
  };
  return lane(-D.rig.STANCE) + lane(D.rig.STANCE);
}

function knobPointer(index) {
  const [kx, ky] = D.knob;
  const a = (D.knobAngles[index] * Math.PI) / 180;
  return lineOnTop([kx, ky], [kx + Math.sin(a) * 7, ky - Math.cos(a) * 7], 8.8, P);
}

let speed = D.start.speed;
let shown = speed;
let radiusIndex = D.start.radius;
let lean = leanOf(speed, RADII[radiusIndex]);
let drawnLean = lean;
let drawnRadius = radiusIndex;
let frame = 0;
let last = 0;
let clock = 0;
let touring = true;
let visible = false;
let idleTimer = 0;

// Idle tour: speed swings slowly between the slide's ends; the radius steps
// to the next stop after each full swing.
const SWING = 14;
const tourSpeed = (t) => (SPEEDS[0] + SPEEDS[1]) / 2 - ((SPEEDS[1] - SPEEDS[0]) / 2 - 1) * Math.cos((t / SWING) * Math.PI * 2 + 0.6);
const tourRadius = (t) => (D.start.radius + Math.floor(t / SWING)) % RADII.length;

function draw(force) {
  carriage.setAttribute("transform", translateAlong(P, [speedX(shown), 0, 0]));
  if (force || Math.abs(lean - drawnLean) > 0.0017 || (lean !== drawnLean && lean === leanOf(shown, RADII[radiusIndex]))) {
    rigEl.innerHTML = RIG.scene(lean);
    drawnLean = lean;
  }
  if (force || radiusIndex !== drawnRadius) {
    knob.setAttribute("d", knobPointer(radiusIndex));
    tracksEl.setAttribute("d", tracks(RADII[radiusIndex]));
    drawnRadius = radiusIndex;
  }
  const text = readoutOf(shown, RADII[radiusIndex], lean);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(Math.round(shown)));
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) {
    clock += dt;
    speed = tourSpeed(clock);
    radiusIndex = tourRadius(clock);
  }
  shown = calm ? speed : shown + (speed - shown) * (1 - Math.exp(-dt / 0.25));
  if (Math.abs(speed - shown) < 0.01) shown = speed;
  // The skater settles into the new lean over a few tenths of a second.
  const want = leanOf(shown, RADII[radiusIndex]);
  lean = calm ? want : lean + (want - lean) * (1 - Math.exp(-dt / 0.35));
  if (Math.abs(want - lean) < 0.0002) lean = want;
  draw(false);
  const settled = !touring && shown === speed && lean === want;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}

const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};
const hold = () => {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
    clock = 0;
    run();
  }, 4000);
  run();
};
const setSpeed = (next) => {
  speed = clamp(next, SPEEDS[0], SPEEDS[1]);
  hold();
};
const setRadius = (next) => {
  radiusIndex = (next + RADII.length) % RADII.length;
  hold();
};

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientX - box.left) / box.width - 0.2) / 0.6, 0, 1);
  setSpeed(Math.round(SPEEDS[0] + share * (SPEEDS[1] - SPEEDS[0])));
});
stage.addEventListener("click", () => setRadius(radiusIndex + 1));
stage.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") setSpeed(Math.round(speed) + 1);
  else if (event.key === "ArrowLeft") setSpeed(Math.round(speed) - 1);
  else if (event.key === "ArrowUp") setRadius(radiusIndex + 1);
  else if (event.key === "ArrowDown") setRadius(radiusIndex - 1);
  else if (event.key === "Home") setSpeed(SPEEDS[0]);
  else if (event.key === "End") setSpeed(SPEEDS[1]);
  else return;
  event.preventDefault();
});
draw(true);
