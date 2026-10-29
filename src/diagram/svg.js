// A laid-out diagram (layout.js) as SVG: no scripts, no external fonts, the
// object behind each box and the ends of each relation as data attributes,
// so the BC Atlas pages can highlight neighbors and open objects.
import { STYLE } from "./layout.js";
import { arrowHead, dashPattern, round, routeCommands } from "./geometry.js";

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");

function pathData(commands) {
  return commands.map((command) => {
    if (command.op === "Q") return `Q${round(command.cx)} ${round(command.cy)} ${round(command.x)} ${round(command.y)}`;
    if (command.op === "C") return `C${round(command.x1)} ${round(command.y1)} ${round(command.x2)} ${round(command.y2)} ${round(command.x)} ${round(command.y)}`;
    return `${command.op}${round(command.x)} ${round(command.y)}`;
  }).join("");
}

const dashAttribute = (dash, width) => {
  const pattern = dashPattern(dash, width);
  return pattern ? ` stroke-dasharray="${pattern.join(" ")}"` : "";
};

function textLines(lines, x, y) {
  let baseline = y;
  return lines.map(({ text, size, bold, color }) => {
    baseline += size * STYLE.line;
    return `<text x="${round(x)}" y="${round(baseline - size * 0.32)}" font-size="${size}"${bold ? ' font-weight="700"' : ""} fill="${color}">${escapeXml(text)}</text>`;
  }).join("");
}

function edgeSvg(edge) {
  if (edge.points.length < 2) return "";
  const width = edge.width ?? 1.2;
  const directed = edge.arrow !== "none";
  const head = directed ? arrowHead(edge.points).map(({ x, y }) => `${round(x)},${round(y)}`).join(" ") : "";
  const hollow = edge.arrow === "-->";
  const tooltip = [edge.label, edge.tooltip].filter(Boolean).join("\n");
  const label = edge.labelBox
    ? `<g class="edge-label"><rect x="${round(edge.labelBox.x)}" y="${round(edge.labelBox.y)}" width="${round(edge.labelBox.width)}" height="${round(edge.labelBox.height)}" rx="3" fill="#ffffff" fill-opacity="0.85"/><text x="${round(edge.labelBox.x + edge.labelBox.width / 2)}" y="${round(edge.labelBox.y + edge.labelBox.height / 2 + STYLE.label * 0.35)}" font-size="${STYLE.label}" fill="${STYLE.faint}" text-anchor="middle">${escapeXml(edge.label)}</text></g>`
    : "";
  return `<g class="edge" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}" data-kind="${escapeXml(edge.kind)}">${tooltip ? `<title>${escapeXml(tooltip)}</title>` : ""}<path d="${pathData(routeCommands(edge.points, { curved: edge.curved, arrow: directed }))}" fill="none" stroke="${edge.color}" stroke-width="${width}"${dashAttribute(edge.dash, 1)}/>${directed ? `<polygon points="${head}" fill="${hollow ? "#ffffff" : edge.color}" stroke="${edge.color}" stroke-width="1"/>` : ""}${label}</g>`;
}

function nodeSvg(node) {
  const box = `<rect x="${round(node.x)}" y="${round(node.y)}" width="${node.width}" height="${node.height}" rx="6" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${node.strokeWidth ?? 1.4}"${dashAttribute(node.dash, 1)}/>`;
  const body = `${node.tooltip ? `<title>${escapeXml(node.tooltip)}</title>` : ""}${box}${textLines(node.lines, node.x + STYLE.pad.x, node.y + STYLE.pad.y)}`;
  const attributes = `class="node" data-node="${escapeXml(node.path)}"${node.object ? ` data-object="${escapeXml(node.object)}"` : ""}${node.type ? ` data-type="${escapeXml(node.type)}"` : ""}`;
  return node.link
    ? `<a href="${escapeXml(node.link)}" ${attributes}>${body}</a>`
    : `<g ${attributes}>${body}</g>`;
}

function groupSvg(group) {
  return `<g class="group" data-group="${escapeXml(group.key)}"><rect x="${round(group.x)}" y="${round(group.y)}" width="${round(group.width)}" height="${round(group.height)}" rx="10" fill="${group.external ? "#ffffff" : STYLE.group.fill}" stroke="${STYLE.group.stroke}" stroke-width="1"${dashAttribute(group.dash, 1)}/><text x="${round(group.x + 14)}" y="${round(group.y + STYLE.groupLabel + 9)}" font-size="${STYLE.groupLabel}" font-weight="700" fill="${STYLE.group.text}">${escapeXml(group.label)}</text></g>`;
}

function legendSvg(legend) {
  const { x, y, pad, rowHeight } = legend;
  const parts = [`<rect x="${x}" y="${y}" width="${legend.width}" height="${legend.height}" rx="8" fill="#ffffff" stroke="#cbd5e1"/>`,
    `<text x="${x + pad}" y="${y + pad + 11}" font-size="11" font-weight="700" fill="${STYLE.text}">Legend</text>`];
  legend.rows.forEach((row, index) => {
    const rowY = y + pad + 16 + index * rowHeight + rowHeight / 2;
    for (const item of row) {
      const left = x + pad + item.offset;
      parts.push(`<g class="legend-kind" data-kind="${escapeXml(item.kind)}"><line x1="${round(left)}" y1="${round(rowY)}" x2="${round(left + 24)}" y2="${round(rowY)}" stroke="${item.color}" stroke-width="2"${dashAttribute(item.dash, 1)}/><text x="${round(left + 30)}" y="${round(rowY + 4)}" font-size="11" fill="${STYLE.text}">${escapeXml(item.kind)}</text></g>`);
    }
  });
  legend.notes.forEach((note, index) => {
    parts.push(`<text x="${x + pad}" y="${round(y + pad + 16 + legend.rows.length * rowHeight + 12 + index * 13)}" font-size="10" fill="${STYLE.faint}">${escapeXml(note)}</text>`);
  });
  return `<g class="legend">${parts.join("")}</g>`;
}

/** The drawing as a standalone SVG document. */
export function drawingToSvg(drawing) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="bca-diagram" viewBox="0 0 ${drawing.width} ${drawing.height}" width="${drawing.width}" height="${drawing.height}" font-family="${escapeXml(STYLE.font)}">`,
    `<rect class="background" width="${drawing.width}" height="${drawing.height}" fill="#ffffff"/>`,
    drawing.title ? `<text class="title" x="${drawing.title.x}" y="${drawing.title.y}" font-size="${STYLE.title}" font-weight="700" fill="${STYLE.text}">${escapeXml(drawing.title.text)}</text>` : "",
    drawing.empty ? `<text x="${drawing.empty.x}" y="${drawing.empty.y + 14}" font-size="14" fill="${STYLE.muted}">${escapeXml(drawing.empty.text)}</text>` : "",
    `<g class="groups">${drawing.groups.map(groupSvg).join("")}</g>`,
    `<g class="edges">${drawing.edges.map(edgeSvg).join("")}</g>`,
    `<g class="nodes">${drawing.nodes.map(nodeSvg).join("")}</g>`,
    drawing.legend ? legendSvg(drawing.legend) : "",
    "</svg>",
    ""
  ].join("\n");
}
