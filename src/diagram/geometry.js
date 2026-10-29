// Shapes shared by the SVG and PDF renderers.

const ARROW = { length: 9, width: 7 };

/**
 * An orthogonal route with rounded corners, as move/line/quadratic commands.
 * The last segment stops short by the arrowhead's length.
 */
export function routeCommands(points, { radius = 6, arrow = true, curved = false } = {}) {
  if (points.length < 2) return [];
  const route = points.map((point) => ({ ...point }));
  if (curved && (route.length - 1) % 3 === 0) {
    if (arrow) shorten(route);
    const commands = [{ op: "M", x: route[0].x, y: route[0].y }];
    for (let index = 1; index < route.length; index += 3) {
      const [first, second, end] = route.slice(index, index + 3);
      commands.push({ op: "C", x1: first.x, y1: first.y, x2: second.x, y2: second.y, x: end.x, y: end.y });
    }
    return commands;
  }
  if (arrow) shorten(route);
  const commands = [{ op: "M", x: route[0].x, y: route[0].y }];
  for (let index = 1; index < route.length - 1; index++) {
    const [previous, corner, next] = [route[index - 1], route[index], route[index + 1]];
    const into = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const out = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, into / 2, out / 2);
    if (r < 0.5) {
      commands.push({ op: "L", x: corner.x, y: corner.y });
      continue;
    }
    commands.push({ op: "L", x: corner.x - ((corner.x - previous.x) / into) * r, y: corner.y - ((corner.y - previous.y) / into) * r });
    commands.push({ op: "Q", cx: corner.x, cy: corner.y, x: corner.x + ((next.x - corner.x) / out) * r, y: corner.y + ((next.y - corner.y) / out) * r });
  }
  commands.push({ op: "L", x: route.at(-1).x, y: route.at(-1).y });
  return commands;
}

// The line ends where the arrowhead begins, so it does not poke through its tip.
function shorten(route) {
  const end = route.at(-1);
  const before = route.at(-2);
  const length = Math.hypot(end.x - before.x, end.y - before.y) || 1;
  const cut = Math.min(ARROW.length - 1, length - 1);
  end.x -= ((end.x - before.x) / length) * cut;
  end.y -= ((end.y - before.y) / length) * cut;
}

/** The arrowhead at the end of a route: three corners. */
export function arrowHead(points) {
  const end = points.at(-1);
  const before = points.at(-2) ?? end;
  const length = Math.hypot(end.x - before.x, end.y - before.y) || 1;
  const dx = (end.x - before.x) / length;
  const dy = (end.y - before.y) / length;
  const baseX = end.x - dx * ARROW.length;
  const baseY = end.y - dy * ARROW.length;
  return [
    { x: end.x, y: end.y },
    { x: baseX - dy * (ARROW.width / 2), y: baseY + dx * (ARROW.width / 2) },
    { x: baseX + dy * (ARROW.width / 2), y: baseY - dx * (ARROW.width / 2) }
  ];
}

/** A dash pattern for a dash value of the scene (D2's stroke-dash). */
export function dashPattern(dash, width = 1) {
  return dash ? [Math.round(dash * 1.4 * width * 10) / 10, Math.round(dash * width * 10) / 10] : undefined;
}

export const round = (value) => Math.round(value * 10) / 10;
