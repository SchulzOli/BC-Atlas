// Diagrams without D2: a scene (../d2.js buildScene) is laid out with ELK and
// drawn as SVG, PNG, or PDF by BC Atlas itself.
import { layoutScene } from "./layout.js";
import { drawingToPdf } from "./pdf.js";
import { drawingToSvg } from "./svg.js";

// Layered layout grows faster than linear; beyond this many objects a view
// takes minutes and nobody can read it anyway.
export const MAX_DIAGRAM_NODES = 1500;

export { layoutScene, drawingToSvg, drawingToPdf };

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
