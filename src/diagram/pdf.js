// A laid-out diagram (layout.js) as a one-page vector PDF: boxes, routes,
// and text drawn with Helvetica, whose widths match the layout's metrics
// (Liberation Sans). Text outside Windows-1252 (Greek, Cyrillic, Polish, ...)
// makes the PDF embed Liberation Sans instead. Source links become
// clickable areas.
import { deflateSync } from "node:zlib";
import { STYLE } from "./layout.js";
import { arrowHead, dashPattern, routeCommands } from "./geometry.js";
import { embeddedFont } from "./pdf-font.js";
import { textWidth } from "./text.js";

// Most PDF viewers refuse pages larger than 200 inches.
const MAX_PAGE = 14_400;
const KAPPA = 0.5523;

const number = (value) => Number(value.toFixed(2)).toString();

function rgb(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value.padEnd(6, "0");
  return [0, 2, 4].map((offset) => number(Number.parseInt(full.slice(offset, offset + 2), 16) / 255)).join(" ");
}

// Windows-1252 for the characters outside Latin-1.
const CP1252 = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x2c6, 0x88], [0x2030, 0x89], [0x160, 0x8a], [0x2039, 0x8b], [0x152, 0x8c], [0x17d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x2dc, 0x98], [0x2122, 0x99], [0x161, 0x9a],
  [0x203a, 0x9b], [0x153, 0x9c], [0x17e, 0x9e], [0x178, 0x9f]]);

const encodable = (code) => code < 0x80 || (code >= 0xa0 && code <= 0xff) || CP1252.has(code);

function pdfString(text) {
  let out = "";
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : CP1252.get(code) ?? 0x3f;
    out += byte === 0x28 || byte === 0x29 || byte === 0x5c ? `\\${String.fromCharCode(byte)}`
      : byte < 0x20 || byte > 0x7e ? `\\${byte.toString(8).padStart(3, "0")}` : String.fromCharCode(byte);
  }
  return `(${out})`;
}

class Canvas {
  constructor(encode) {
    this.ops = [];
    this.encode = encode;
  }
  fill(color) { this.ops.push(`${rgb(color)} rg`); return this; }
  stroke(color, width = 1, dash) {
    this.ops.push(`${rgb(color)} RG ${number(width)} w ${dash ? `[${dash.map(number).join(" ")}] 0 d` : "[] 0 d"}`);
    return this;
  }
  roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    const k = r * KAPPA;
    this.ops.push([
      `${number(x + r)} ${number(y)} m`,
      `${number(x + width - r)} ${number(y)} l`,
      `${number(x + width - r + k)} ${number(y)} ${number(x + width)} ${number(y + r - k)} ${number(x + width)} ${number(y + r)} c`,
      `${number(x + width)} ${number(y + height - r)} l`,
      `${number(x + width)} ${number(y + height - r + k)} ${number(x + width - r + k)} ${number(y + height)} ${number(x + width - r)} ${number(y + height)} c`,
      `${number(x + r)} ${number(y + height)} l`,
      `${number(x + r - k)} ${number(y + height)} ${number(x)} ${number(y + height - r + k)} ${number(x)} ${number(y + height - r)} c`,
      `${number(x)} ${number(y + r)} l`,
      `${number(x)} ${number(y + r - k)} ${number(x + r - k)} ${number(y)} ${number(x + r)} ${number(y)} c h`
    ].join("\n"));
    return this;
  }
  route(commands) {
    let current = { x: 0, y: 0 };
    for (const command of commands) {
      if (command.op === "M") this.ops.push(`${number(command.x)} ${number(command.y)} m`);
      else if (command.op === "L") this.ops.push(`${number(command.x)} ${number(command.y)} l`);
      else if (command.op === "C") this.ops.push(`${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)} c`);
      else if (command.op === "Q") {
        // A quadratic curve as the cubic with the same shape.
        const c1 = { x: current.x + (2 / 3) * (command.cx - current.x), y: current.y + (2 / 3) * (command.cy - current.y) };
        const c2 = { x: command.x + (2 / 3) * (command.cx - command.x), y: command.y + (2 / 3) * (command.cy - command.y) };
        this.ops.push(`${number(c1.x)} ${number(c1.y)} ${number(c2.x)} ${number(c2.y)} ${number(command.x)} ${number(command.y)} c`);
      }
      current = command;
    }
    return this;
  }
  polygon(points) {
    this.ops.push(`${points.map(({ x, y }, index) => `${number(x)} ${number(y)} ${index ? "l" : "m"}`).join(" ")} h`);
    return this;
  }
  line(x1, y1, x2, y2) { this.ops.push(`${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l`); return this; }
  paint(mode) { this.ops.push(mode); return this; }
  // The page is flipped (y grows downward), so text is flipped back.
  text(value, x, y, size, { bold = false, color = STYLE.text, anchor = "start" } = {}) {
    const left = anchor === "middle" ? x - textWidth(value, size, { bold }) / 2 : x;
    this.ops.push(`BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${number(size)} Tf 1 0 0 -1 ${number(left)} ${number(y)} Tm ${this.encode(value, bold)} Tj ET`);
    return this;
  }
}

function drawNodeText(canvas, node) {
  let baseline = node.y + STYLE.pad.y;
  for (const { text, size, bold, color } of node.lines) {
    baseline += size * STYLE.line;
    canvas.text(text, node.x + STYLE.pad.x, baseline - size * 0.32, size, { bold, color });
  }
}

/** The drawing as PDF bytes. */
/** Every text the drawing shows, to decide whether Helvetica can show it. */
function texts(drawing) {
  return [
    drawing.title?.text, drawing.empty?.text,
    ...drawing.groups.map(({ label }) => label),
    ...drawing.edges.filter(({ labelBox }) => labelBox).map(({ label }) => label),
    ...drawing.nodes.flatMap(({ lines }) => lines.map(({ text }) => text)),
    ...(drawing.legend ? [...drawing.legend.rows.flat().map(({ kind }) => kind), ...drawing.legend.notes] : [])
  ].filter(Boolean);
}

export function drawingToPdf(drawing, { title } = {}) {
  const embed = texts(drawing).some((text) => [...text].some((character) => !encodable(character.codePointAt(0))));
  const fonts = embed ? { regular: embeddedFont("regular"), bold: embeddedFont("bold") } : undefined;
  const canvas = new Canvas(embed ? (text, bold) => fonts[bold ? "bold" : "regular"].encode(text) : (text) => pdfString(text));
  const scale = Math.min(1, MAX_PAGE / Math.max(drawing.width, drawing.height));
  const pageWidth = drawing.width * scale;
  const pageHeight = drawing.height * scale;
  canvas.ops.push(`${number(scale)} 0 0 ${number(-scale)} 0 ${number(pageHeight)} cm 1 J 1 j`);
  canvas.fill("#ffffff").paint(`0 0 ${number(drawing.width)} ${number(drawing.height)} re f`);
  if (drawing.title) canvas.text(drawing.title.text, drawing.title.x, drawing.title.y, STYLE.title, { bold: true });
  if (drawing.empty) canvas.text(drawing.empty.text, drawing.empty.x, drawing.empty.y + 14, 14, { color: STYLE.muted });
  for (const group of drawing.groups) {
    canvas.fill(group.external ? "#ffffff" : STYLE.group.fill).stroke(STYLE.group.stroke, 1, dashPattern(group.dash))
      .roundedRect(group.x, group.y, group.width, group.height, 10).paint("B");
    canvas.text(group.label, group.x + 14, group.y + STYLE.groupLabel + 9, STYLE.groupLabel, { bold: true, color: STYLE.group.text });
  }
  for (const edge of drawing.edges) {
    if (edge.points.length < 2) continue;
    const directed = edge.arrow !== "none";
    canvas.stroke(edge.color, edge.width ?? 1.2, dashPattern(edge.dash)).route(routeCommands(edge.points, { curved: edge.curved, arrow: directed })).paint("S");
    if (directed) canvas.fill(edge.arrow === "-->" ? "#ffffff" : edge.color).stroke(edge.color, 1).polygon(arrowHead(edge.points)).paint("B");
    if (edge.labelBox) {
      const box = edge.labelBox;
      canvas.fill("#ffffff").roundedRect(box.x, box.y, box.width, box.height, 3).paint("f");
      canvas.text(edge.label, box.x + box.width / 2, box.y + box.height / 2 + STYLE.label * 0.35, STYLE.label, { color: STYLE.faint, anchor: "middle" });
    }
  }
  const links = [];
  for (const node of drawing.nodes) {
    canvas.fill(node.fill).stroke(node.stroke, node.strokeWidth ?? 1.4, dashPattern(node.dash)).roundedRect(node.x, node.y, node.width, node.height, 6).paint("B");
    drawNodeText(canvas, node);
    if (node.link) links.push(node);
  }
  const legend = drawing.legend;
  if (legend) {
    canvas.fill("#ffffff").stroke("#cbd5e1", 1).roundedRect(legend.x, legend.y, legend.width, legend.height, 8).paint("B");
    canvas.text("Legend", legend.x + legend.pad, legend.y + legend.pad + 11, 11, { bold: true });
    legend.rows.forEach((row, index) => {
      const rowY = legend.y + legend.pad + 16 + index * legend.rowHeight + legend.rowHeight / 2;
      for (const item of row) {
        const left = legend.x + legend.pad + item.offset;
        canvas.stroke(item.color, 2, dashPattern(item.dash)).line(left, rowY, left + 24, rowY).paint("S");
        canvas.text(item.kind, left + 30, rowY + 4, 11);
      }
    });
    legend.notes.forEach((note, index) => {
      canvas.text(note, legend.x + legend.pad, legend.y + legend.pad + 16 + legend.rows.length * legend.rowHeight + 12 + index * 13, 10, { color: STYLE.faint });
    });
  }

  const content = deflateSync(Buffer.from(canvas.ops.join("\n"), "latin1"));
  const annotations = links.map((node) => {
    const [x1, x2] = [node.x * scale, (node.x + node.width) * scale];
    const [y1, y2] = [pageHeight - (node.y + node.height) * scale, pageHeight - node.y * scale];
    return `<< /Type /Annot /Subtype /Link /Rect [${[x1, y1, x2, y2].map(number).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(node.link)} >> >>`;
  });
  // Objects 5 and 6 are the fonts; an embedded font brings four more objects each, after the annotations.
  const next = 8 + annotations.length;
  const fontObjects = embed
    ? [...fonts.regular.objects([5, next, next + 1, next + 2, next + 3], "LiberationSans"), ...fonts.bold.objects([6, next + 4, next + 5, next + 6, next + 7], "LiberationSans-Bold")]
    : [];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(pageWidth)} ${number(pageHeight)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R${annotations.length ? ` /Annots [${annotations.map((_, index) => `${8 + index} 0 R`).join(" ")}]` : ""} >>`,
    { stream: content },
    embed ? fontObjects[0] : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    embed ? fontObjects[5] : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Producer (BC Atlas)${title ?? drawing.title ? ` /Title ${pdfString(title ?? drawing.title.text)}` : ""} >>`,
    ...annotations,
    ...(embed ? [...fontObjects.slice(1, 5), ...fontObjects.slice(6, 10)] : [])
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const body = typeof object === "object"
      ? Buffer.concat([Buffer.from(`${index + 1} 0 obj\n<< /Length ${object.stream.length} /Filter /FlateDecode${object.extra ? ` ${object.extra}` : ""} >>\nstream\n`, "latin1"), object.stream, Buffer.from("\nendstream\nendobj\n", "latin1")])
      : Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1");
    chunks.push(body);
    length += body.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
