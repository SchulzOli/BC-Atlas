import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { createArchitectureModel } from "../src/architecture.js";
import { buildScene, renderD2, sceneToD2 } from "../src/d2.js";
import { layoutScene, prepareScene, renderScene, sceneToSvg } from "../src/diagram/index.js";
import { collapseScene, startsCollapsed } from "../src/diagram/collapse.js";
import { svgToPng } from "../src/diagram/png.js";
import { textWidth, wrap } from "../src/diagram/text.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const workspace = path.join(root, "examples", "multi-app");

async function scene(view = "data") {
  const projection = await createArchitectureModel(workspace, { view });
  return { projection, scene: buildScene(projection.model, projection.renderOptions) };
}

const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("text is measured with the metrics of the font every renderer uses", () => {
  assert.equal(textWidth("", 13), 0);
  assert.ok(textWidth("WWW", 13) > textWidth("iii", 13));
  assert.ok(textWidth("Item", 13, { bold: true }) > textWidth("Item", 13));
  assert.equal(Math.round(textWidth("Helvetica", 1000)), 4112, "Liberation Sans has Helvetica's widths");
  assert.deepEqual(wrap("Sales Order Archive Management", 120, 13), ["Sales Order Archive", "Management"]);
  assert.ok(wrap("Supercalifragilisticexpialidocious", 60, 13).every((line) => textWidth(line, 13) <= 60));
});

test("the D2 source and the drawings come from one scene", async () => {
  const { projection, scene: data } = await scene("data");
  assert.equal(sceneToD2(data), renderD2(projection.model, projection.renderOptions));
  assert.deepEqual(data.groups.map(({ label }) => label).sort(), ["Contoso.Core.Items", "Contoso.Core.Pricing", "Contoso.Integration", "Contoso.Sales.Quotes", "External / unresolved"]);
  assert.ok(data.edges.every(({ from, to, color }) => from && to && /^#[0-9A-F]{6}$/iu.test(color)));
});

test("the layout keeps boxes apart, inside their groups, and connects every relation", async () => {
  const { scene: project } = await scene("project");
  const drawing = await layoutScene(project);
  assert.equal(drawing.nodes.length, project.groups.reduce((total, { nodes }) => total + nodes.length, 0));
  const groups = new Map(drawing.groups.map((group) => [group.key, group]));
  for (const node of drawing.nodes) {
    assert.ok(inside(node, groups.get(node.group)), `${node.path} lies inside its group`);
    assert.ok(inside(node, { x: 0, y: 0, width: drawing.width, height: drawing.height }));
  }
  for (const [index, node] of drawing.nodes.entries()) {
    for (const other of drawing.nodes.slice(index + 1)) assert.ok(!overlap(node, other), `${node.path} and ${other.path} do not overlap`);
  }
  const byPath = new Map(drawing.nodes.map((node) => [node.path, node]));
  for (const edge of drawing.edges) {
    assert.ok(edge.points.length >= 2, `${edge.from} -> ${edge.to} has a route`);
    const near = (point, node) => point.x >= node.x - 2 && point.x <= node.x + node.width + 2 && point.y >= node.y - 2 && point.y <= node.y + node.height + 2;
    assert.ok(near(edge.points[0], byPath.get(edge.from)), "the route starts at its source");
    assert.ok(near(edge.points.at(-1), byPath.get(edge.to)), "the route ends at its target");
  }
  assert.ok(drawing.legend.rows.flat().length >= 4, "the legend names the relation kinds");
});

test("the SVG names the object behind every box and the ends of every route", async () => {
  const { scene: data } = await scene("data");
  const svg = await sceneToSvg(data);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="bca-diagram" viewBox="0 0 \d+ \d+"/u);
  assert.doesNotMatch(svg, /<script|<foreignObject|@import|url\(/u, "self-contained and inert");
  assert.equal([...svg.matchAll(/class="node"/gu)].length, data.groups.reduce((total, { nodes }) => total + nodes.length, 0));
  assert.match(svg, /data-object="[^"]*::table::50000"/u);
  assert.match(svg, /<g class="edge" data-from="g\d+\.n\d+" data-to="[^"]+" data-kind="reads">/u);
  assert.match(svg, /<g class="legend-kind" data-kind="writes">/u);
});

test("PNG and PDF are drawn without a browser or the d2 executable", async () => {
  const { scene: data } = await scene("data");
  const png = await renderScene(data, "png");
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const drawing = await layoutScene(data);
  assert.equal(png.readUInt32BE(16), Math.round(drawing.width * 2), "twice the drawing's width");
  assert.ok((await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40000 400"/>')).readUInt32BE(16) <= 16384, "large drawings shrink to fit");

  const pdf = await renderScene(data, "pdf");
  const text = pdf.toString("latin1");
  assert.match(text, /^%PDF-1\.4/u);
  assert.match(text, new RegExp(`/MediaBox \\[0 0 ${drawing.width} ${drawing.height}\\]`, "u"));
  assert.match(text, /\/BaseFont \/Helvetica-Bold/u);
  assert.match(text, /startxref\n\d+\n%%EOF\n$/u);
  const stream = pdf.subarray(text.indexOf("stream\n") + 7, text.indexOf("\nendstream"));
  assert.match(inflateSync(stream).toString("latin1"), /\(CON Price Group\) Tj/u, "text stays text");
});

test("bca export writes SVG, PNG, and PDF with the D2 source next to them", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-diagram-"));
  try {
    for (const format of ["svg", "png", "pdf"]) {
      const output = path.join(directory, `data.${format}`);
      const result = spawnSync(process.execPath, [cli, "export", workspace, "--view", "data", "-o", output], { encoding: "utf8", timeout: 120_000 });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readFileSync(output).length > 1000, `${format} written`);
    }
    assert.match(readFileSync(path.join(directory, "data.d2"), "utf8"), /^direction: right/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a PDF embeds its font only for text Helvetica cannot show", async () => {
  const scene = (name) => ({ direction: "right", title: "Fonts", groups: [{ key: "g0", label: "Group", dash: 3, nodes: [{ key: "n0", path: "g0.n0", label: `codeunit 1\n${name}`, fill: "#FFF0D6", stroke: "#A96300" }] }], edges: [], omitted: 0 });
  const plainPdf = (await renderScene(scene("Größe – €"), "pdf")).toString("latin1");
  assert.match(plainPdf, /\/BaseFont \/Helvetica /u, "Windows-1252 text needs no embedded font");
  assert.doesNotMatch(plainPdf, /FontFile2/u);
  const pdf = await renderScene(scene("Łódź Ελληνικά Кириллица"), "pdf");
  const text = pdf.toString("latin1");
  assert.match(text, /\/Subtype \/Type0 \/BaseFont \/BCAtlas\+LiberationSans /u);
  assert.match(text, /\/FontFile2 \d+ 0 R/u);
  assert.match(text, /\/ToUnicode \d+ 0 R/u, "copy and search see the real characters");
  assert.match(text, /startxref\n\d+\n%%EOF\n$/u);
});

test("a closed group is one box, and its relations are bundled per kind with a count", async () => {
  const { projection, scene: project } = await scene("project");
  const services = project.groups.find(({ label }) => label === "Services");
  const overview = collapseScene(project, new Set(project.groups.filter(({ key }) => key !== services.key).map(({ key }) => key)));
  const box = overview.groups.find(({ bare }) => bare).nodes[0];
  assert.equal(box.collapsed, services.key);
  assert.match(box.label, new RegExp(`^Services\\n${services.nodes.length} objects\\n${services.nodes.length} codeunit$`, "u"));
  const inner = new Set(services.nodes.map(({ path }) => path));
  assert.ok(!overview.edges.some(({ from, to }) => inner.has(from) || inner.has(to)), "no route ends inside the closed group");
  assert.ok(!overview.edges.some(({ from, to }) => from === box.path && to === box.path), "relations inside the group are not drawn");
  const outgoing = project.edges.filter(({ from, to }) => inner.has(from) && !inner.has(to));
  const bundled = overview.edges.filter(({ from }) => from === box.path);
  assert.ok(bundled.length < outgoing.length || outgoing.length <= 1);
  assert.equal(new Set(bundled.map(({ to, kind }) => `${to}|${kind}`)).size, bundled.length, "one route per target and kind");

  const svg = await sceneToSvg(overview);
  assert.match(svg, new RegExp(`class="node collapsed" data-node="collapsed\\.${services.key}" data-collapsed="${services.key}"`, "u"));

  // Small views start open, large ones as the overview; files ask for every object.
  assert.equal(startsCollapsed(project), false);
  const all = prepareScene(projection.model, projection.renderOptions, { expand: "all" });
  assert.equal(all.collapsed, false);
  const none = prepareScene(projection.model, projection.renderOptions, { expand: "none" });
  assert.equal(none.collapsed, true);
  assert.equal(none.objects, 0);
  assert.ok(none.groups.every(({ open }) => !open));
  const one = prepareScene(projection.model, projection.renderOptions, { expand: `${services.key},unknown` });
  assert.deepEqual(one.groups.filter(({ open }) => open).map(({ key }) => key), [services.key]);
  assert.equal(one.objects, services.nodes.length);
  assert.equal(sceneToD2(none.full), sceneToD2(all.full), "the D2 source always has every object");
});

test("a view with more than 120 objects starts as the overview of its groups", () => {
  const groups = [0, 1].map((group) => ({ key: `g${group}`, label: `Group ${group}`, nodes: Array.from({ length: 61 }, (_, index) => ({ key: `n${index}`, path: `g${group}.n${index}`, type: "table", label: "table\nT", fill: "#fff", stroke: "#000" })) }));
  assert.equal(startsCollapsed({ groups, edges: [] }), true);
  assert.equal(startsCollapsed({ groups: [groups[0]], edges: [] }), false, "one group has nothing to close");
});
