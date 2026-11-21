// Draws a scene of boxes and lines as SVG: layout with ELK, drawn by
// BC Atlas itself. The flow and process diagrams of `bca docs` use it.
import { layoutScene } from "./layout.js";
import { drawingToSvg } from "./svg.js";

export { layoutScene, drawingToSvg };

export async function sceneToSvg(scene) {
  return drawingToSvg(await layoutScene(scene));
}
