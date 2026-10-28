import { D2 } from "@terrastruct/d2";

let renderer;

// Larger diagrams exhaust the memory of the bundled WebAssembly renderer
// (4 GB) after a minute or more; the Base Application has about 9,500 objects.
export const MAX_DIAGRAM_NODES = 1500;

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

// The renderer answers one request at a time, so concurrent renders (the app
// server) wait for each other.
let queue = Promise.resolve();

export function renderSvg(source, options = {}) {
  const result = queue.then(() => renderNow(source, options));
  queue = result.catch(() => {});
  return result;
}

async function renderNow(source, options) {
  const layout = options.layout ?? "dagre";
  if (!["dagre", "elk"].includes(layout)) {
    throw new Error(
      `The bundled D2 renderer supports layout "dagre" or "elk", not "${layout}"`
    );
  }

  const d2 = getRenderer();
  // Keep the worker referenced while a render is pending; see the note below.
  d2.worker?.ref?.();
  const compileOptions = {
    layout,
    themeID: optionalNumber(options.theme, "theme"),
    darkThemeID: optionalNumber(options.darkTheme, "darkTheme"),
    sketch: options.sketch,
    center: options.center,
    pad: optionalNumber(options.pad, "pad"),
    scale: optionalNumber(options.scale, "scale")
  };
  try {
    const result = await d2.compile(source, compileOptions);
    return await d2.render(result.diagram, result.renderOptions);
  } catch (error) {
    // A diagram too large for the WebAssembly renderer ends its Go runtime;
    // the next diagram gets a fresh renderer instead of the same error.
    if (renderer === d2) {
      renderer = undefined;
      d2.worker?.terminate?.();
    }
    throw error;
  } finally {
    // @terrastruct/d2 keeps a Node worker alive. Unref preserves it for reuse
    // without preventing one-shot CLI invocations from exiting.
    d2.worker?.unref?.();
  }
}
