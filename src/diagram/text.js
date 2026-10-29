// Text widths from the font metrics (metrics.js), so every renderer sizes
// boxes the same way without a browser or a canvas.
import { BOLD, REGULAR } from "./metrics.js";

function unpack(runs) {
  const table = new Map();
  for (const [first, ...widths] of runs) widths.forEach((width, index) => table.set(first + index, width));
  return table;
}

const TABLES = { regular: unpack(REGULAR), bold: unpack(BOLD) };
// Glyphs the font lacks (CJK, emoji) are drawn by a fallback font; count them wide.
const FALLBACK = 1000;

/** Width in pixels of one line of text. */
export function textWidth(text, size, { bold = false } = {}) {
  const table = bold ? TABLES.bold : TABLES.regular;
  let total = 0;
  for (const character of String(text)) total += table.get(character.codePointAt(0)) ?? FALLBACK;
  return (total * size) / 1000;
}

/** Splits text into lines no wider than width, breaking at spaces, then anywhere. */
export function wrap(text, width, size, options = {}) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, options) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // A word longer than the line is split where it no longer fits.
      let rest = word;
      while (textWidth(rest, size, options) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, options) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}
