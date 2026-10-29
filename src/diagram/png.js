// SVG to PNG with resvg (WebAssembly) and the vendored Liberation Sans, so a
// PNG looks the same on every machine and needs no browser or executable.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);
const font = (name) => readFileSync(new URL(`../../vendor/fonts/${name}`, import.meta.url));
// A PNG of at most 64 megapixels (256 MB while rendering), and no side longer than 16,384 pixels.
const MAX_PIXELS = 64_000_000;
const MAX_SIDE = 16_384;

let ready;
let fonts;

/** The pixel scale: twice the drawing's size when it fits the limits. */
export function pngScale(width, height, preferred = 2) {
  return Math.min(preferred, Math.sqrt(MAX_PIXELS / (width * height)), MAX_SIDE / Math.max(width, height));
}

export async function svgToPng(svg, { scale = 2 } = {}) {
  ready ??= initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  await ready;
  fonts ??= [font("LiberationSans-Regular.ttf"), font("LiberationSans-Bold.ttf")];
  const [, width, height] = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/u.exec(svg) ?? [, 800, 600];
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: pngScale(Number(width), Number(height), scale) },
    background: "#ffffff",
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Liberation Sans", sansSerifFamily: "Liberation Sans" }
  });
  try {
    return Buffer.from(resvg.render().asPng());
  } finally {
    resvg.free();
  }
}
