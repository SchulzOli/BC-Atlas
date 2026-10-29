// Diagrams without D2: a scene (../d2.js buildScene) is laid out with ELK and
// drawn as SVG, PNG, or PDF by BC Atlas itself.
import { buildScene } from "../d2.js";
import { collapseScene, startsCollapsed } from "./collapse.js";
import { layoutScene } from "./layout.js";
import { drawingToPdf } from "./pdf.js";
import { drawingToSvg } from "./svg.js";

// Layered layout grows faster than linear; beyond this many objects a view
// takes minutes and nobody can read it anyway.
export const MAX_DIAGRAM_NODES = 1500;

export { layoutScene, drawingToSvg, drawingToPdf };

/**
 * What to draw for a model: every object, or, for a large view, the overview
 * of its groups with the expanded ones open.
 * @param expand undefined (decide by size), "all", "none", or group keys
 * @returns { scene, full, groups, collapsed, objects } where full is the
 *   whole scene (for the D2 source) and objects the boxes drawn one by one
 */
export function prepareScene(model, renderOptions = {}, { expand } = {}) {
  const full = buildScene(model, renderOptions);
  const keys = full.groups.map(({ key }) => key);
  const requested = expand === undefined || expand === "" ? undefined
    : expand === "all" ? new Set(keys)
      : expand === "none" ? new Set()
        : new Set((Array.isArray(expand) ? expand : String(expand).split(",")).filter((key) => keys.includes(key)));
  const open = requested ?? (startsCollapsed(full) || model.objects.length > MAX_DIAGRAM_NODES ? new Set() : new Set(keys));
  const collapsed = open.size < keys.length;
  // The overview bundles every relation, not only the first maxEdges.
  const scene = collapsed ? collapseScene(buildScene(model, { ...renderOptions, maxEdges: Math.max(model.edges.length, renderOptions.maxEdges ?? 0) }), open) : full;
  const objects = full.groups.filter(({ key }) => open.has(key)).reduce((total, { nodes }) => total + nodes.length, 0);
  return {
    scene,
    full,
    collapsed,
    objects,
    groups: full.groups.map(({ key, label, nodes, external }) => ({ key, label, size: nodes.length, open: open.has(key), ...(external ? { external } : {}) }))
  };
}

/** A scene as an SVG document. */
export async function sceneToSvg(scene) {
  return drawingToSvg(await layoutScene(scene));
}

/** A scene in a file format: svg (text), png or pdf (bytes). */
export async function renderScene(scene, format) {
  const drawing = await layoutScene(scene);
  if (format === "pdf") return drawingToPdf(drawing);
  const svg = drawingToSvg(drawing);
  if (format === "png") {
    // The WebAssembly rasterizer loads only when a PNG is asked for.
    const { svgToPng } = await import("./png.js");
    return svgToPng(svg);
  }
  return svg;
}
