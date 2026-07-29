import { D2 } from "@terrastruct/d2";

let renderer;

function getRenderer() {
  renderer ??= new D2();
  return renderer;
}

function optionalNumber(value, name) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

export async function renderSvg(source, options = {}) {
  const layout = options.layout ?? "dagre";
  if (!["dagre", "elk"].includes(layout)) {
    throw new Error(
      `The bundled D2 renderer supports layout "dagre" or "elk", not "${layout}"`
    );
  }

  const d2 = getRenderer();
  const compileOptions = {
    layout,
    themeID: optionalNumber(options.theme, "theme"),
    darkThemeID: optionalNumber(options.darkTheme, "darkTheme"),
    sketch: options.sketch,
    center: options.center,
    pad: optionalNumber(options.pad, "pad"),
    scale: optionalNumber(options.scale, "scale")
  };
  const result = await d2.compile(source, compileOptions);
  const svg = await d2.render(result.diagram, result.renderOptions);

  // @terrastruct/d2 currently keeps a Node worker alive. Unref preserves it for
  // watch-mode reuse without preventing one-shot CLI invocations from exiting.
  d2.worker?.unref?.();
  return svg;
}
