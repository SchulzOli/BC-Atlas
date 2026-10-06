// SVG preview of a laid-out BPMN process (see ../process.js): standard BPMN
// shapes - thin start event, bold end event, double-ring intermediate event,
// rounded user tasks, collapsed sub-processes with a + marker, and exclusive
// gateways - in the documentation's colors. No external fonts or scripts.
import { escapeXml } from "./format.js";

export const COLORS = Object.freeze({
  start: { fill: "#e8f5e9", stroke: "#2e7d32" },
  end: { fill: "#fdecea", stroke: "#c62828" },
  event: { fill: "#e8f1fd", stroke: "#0b62d6" },
  task: { fill: "#eef4fd", stroke: "#0b62d6" },
  subprocess: { fill: "#eef4fd", stroke: "#0b62d6" },
  gateway: { fill: "#fff7e0", stroke: "#e09400" },
  flow: "#5b6470",
  text: "#1b1f24",
  muted: "#5b6470",
  pool: { fill: "#ffffff", stroke: "#9aa4b0", band: "#f3f6f9" }
});

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

/** Greedy word wrap by an average glyph width; long words are split. */
export function wrapText(value, width, fontSize = 12, maxLines = 4) {
  const perLine = Math.max(4, Math.floor(width / (fontSize * 0.56)));
  const words = String(value ?? "").split(/\s+/u).filter(Boolean)
    .flatMap((word) => word.length > perLine ? word.match(new RegExp(`.{1,${perLine}}`, "gu")) : [word]);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= perLine) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, perLine - 1).replace(/\s+\S*$/u, "")}…`;
    return kept;
  }
  return lines;
}

function textBlock(lines, cx, cy, { size = 12, weight = 400, color = COLORS.text } = {}) {
  const lineHeight = size * 1.25;
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  return `<text x="${cx}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${lines
    .map((line, index) => `<tspan x="${cx}" y="${(top + index * lineHeight).toFixed(1)}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

const USER_ICON = (x, y, stroke) =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="${stroke}" stroke-width="1.2"><circle cx="7" cy="5" r="3.2"/><path d="M1 15c0-3.6 2.7-6 6-6s6 2.4 6 6z"/></g>`;

function node(element, box, link) {
  const color = COLORS[element.kind] ?? COLORS.task;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let shape;
  let label = "";
  switch (element.kind) {
    case "start":
    case "end":
    case "event": {
      const r = box.width / 2;
      const width = element.kind === "end" ? 3.5 : 1.6;
      shape = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="${width}"/>`;
      if (element.kind === "event") shape += `<circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="none" stroke="${color.stroke}" stroke-width="1.2"/>`;
      if (element.name) {
        const lines = wrapText(element.name, 130, 11, 3);
        label = textBlock(lines, cx, box.y + box.height + 10 + ((lines.length - 1) * 13.75) / 2, { size: 11, color: COLORS.muted });
      }
      break;
    }
    case "gateway": {
      shape = `<path d="M${cx} ${box.y}L${box.x + box.width} ${cy}L${cx} ${box.y + box.height}L${box.x} ${cy}Z" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.6"/>`
        + `<path d="M${cx - 8} ${cy - 8}L${cx + 8} ${cy + 8}M${cx + 8} ${cy - 8}L${cx - 8} ${cy + 8}" stroke="${color.stroke}" stroke-width="3" stroke-linecap="round"/>`;
      break;
    }
    default: {
      shape = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.6"/>`;
      if (element.user) shape += USER_ICON(box.x + 7, box.y + 6, color.stroke);
      const marker = cx - 7;
      const bottom = box.y + box.height - 16;
      if (element.kind === "subprocess") {
        shape += `<rect x="${marker}" y="${bottom}" width="14" height="14" rx="2" fill="#fff" stroke="${color.stroke}" stroke-width="1.2"/>`
          + `<path d="M${cx} ${bottom + 3}V${bottom + 11}M${cx - 4} ${bottom + 7}H${cx + 4}" stroke="${color.stroke}" stroke-width="1.4"/>`;
      }
      if (element.loop) {
        shape += `<path d="M${cx + 4} ${bottom + 12}a6 6 0 1 0-6 0" fill="none" stroke="${color.stroke}" stroke-width="1.4"/>`
          + `<path d="M${cx - 6} ${bottom + 8}l0 4.5 4.5 0" fill="none" stroke="${color.stroke}" stroke-width="1.4"/>`;
      }
      const reserve = element.kind === "subprocess" || element.loop ? 16 : 0;
      const lines = wrapText(element.name, box.width - 16, 12, element.kind === "subprocess" ? 4 : 3);
      label = textBlock(lines, cx, cy - reserve / 2 + (element.user ? 3 : 0), { size: 12, weight: element.kind === "subprocess" ? 600 : 400 });
    }
  }
  const title = element.documentation ? `<title>${escapeXml(element.documentation)}</title>` : "";
  const content = `<g class="bpmn-${element.kind}">${title}${shape}${label}</g>`;
  return link ? `<a href="${escapeXml(link)}">${content}</a>` : content;
}

function verticalLabel(textValue, x, y, height, weight) {
  const cx = x + 15;
  const cy = y + height / 2;
  const lines = wrapText(textValue, Math.max(60, height - 16), 12, 2);
  return `<g transform="rotate(-90 ${cx} ${cy})">${textBlock(lines, cx, cy, { size: 12, weight })}</g>`;
}

/**
 * @param layout result of layoutProcess()
 * @param options { linkFor(node) -> href | undefined, title }
 */
export function renderProcessSvg(layout, { linkFor, title } = {}) {
  const { process, bounds, waypoints, pool, lanes, width, height } = layout;
  const arrow = `arrow-${process.id.replace(/[^\w-]/gu, "_")}`;
  const parts = [];
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(`<defs><marker id="${arrow}" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="${COLORS.flow}"/></marker></defs>`);
  if (pool) {
    parts.push(`<rect x="${pool.x}" y="${pool.y}" width="${pool.width}" height="${pool.height}" fill="${COLORS.pool.fill}" stroke="${COLORS.pool.stroke}" stroke-width="1.2"/>`);
    parts.push(`<rect x="${pool.x}" y="${pool.y}" width="30" height="${pool.height}" fill="${COLORS.pool.band}" stroke="${COLORS.pool.stroke}" stroke-width="1.2"/>`);
    parts.push(verticalLabel(process.name, pool.x, pool.y, pool.height, 600));
    for (const lane of lanes) {
      parts.push(`<rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" fill="none" stroke="${COLORS.pool.stroke}" stroke-width="1"/>`);
      parts.push(`<rect x="${lane.x}" y="${lane.y}" width="30" height="${lane.height}" fill="${COLORS.pool.band}" stroke="${COLORS.pool.stroke}" stroke-width="1"/>`);
      parts.push(verticalLabel(lane.name, lane.x, lane.y, lane.height, 400));
    }
  }
  for (const flow of process.flows) {
    const points = waypoints.get(flow.id).map(([x, y]) => `${x},${y}`).join(" ");
    parts.push(`<polyline points="${points}" fill="none" stroke="${COLORS.flow}" stroke-width="1.5" stroke-linejoin="round" marker-end="url(#${arrow})"/>`);
  }
  for (const element of process.nodes) parts.push(node(element, bounds.get(element.id), linkFor?.(element)));
  const name = escapeXml(title ?? process.name);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${name}" font-family="${FONT}">
<title>${name}</title>
${parts.join("\n")}
</svg>
`;
}
