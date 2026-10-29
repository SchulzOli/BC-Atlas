// Embeds Liberation Sans (vendor/fonts) in a PDF as a CID font, for text the
// standard Helvetica of PDF viewers cannot show (anything outside
// Windows-1252). Reads just what that needs from the TrueType file: the
// character map, the advance widths, and a few metrics.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FILES = { regular: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf" };
const loaded = new Map();

function parse(buffer) {
  const tables = new Map();
  const count = buffer.readUInt16BE(4);
  for (let index = 0; index < count; index++) {
    const record = 12 + index * 16;
    tables.set(buffer.toString("latin1", record, record + 4), { offset: buffer.readUInt32BE(record + 8), length: buffer.readUInt32BE(record + 12) });
  }
  const head = tables.get("head").offset;
  const hhea = tables.get("hhea").offset;
  const unitsPerEm = buffer.readUInt16BE(head + 18);
  const scale = (value) => Math.round((value * 1000) / unitsPerEm);
  const metrics = buffer.readUInt16BE(hhea + 34);
  const hmtx = tables.get("hmtx").offset;
  const advance = (glyph) => scale(buffer.readUInt16BE(hmtx + Math.min(glyph, metrics - 1) * 4));
  return {
    buffer,
    advance,
    glyph: characterMap(buffer, tables.get("cmap").offset),
    bbox: [36, 38, 40, 42].map((offset) => scale(buffer.readInt16BE(head + offset))),
    ascent: scale(buffer.readInt16BE(hhea + 4)),
    descent: scale(buffer.readInt16BE(hhea + 6))
  };
}

/** Unicode code point to glyph index, from a format 12 or format 4 subtable. */
function characterMap(buffer, cmap) {
  const subtables = [];
  for (let index = 0; index < buffer.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    subtables.push({ platform: buffer.readUInt16BE(record), encoding: buffer.readUInt16BE(record + 2), offset: cmap + buffer.readUInt32BE(record + 4) });
  }
  const full = subtables.find(({ platform, encoding, offset }) => platform === 3 && encoding === 10 && buffer.readUInt16BE(offset) === 12);
  if (full) {
    const groups = [];
    for (let index = 0; index < buffer.readUInt32BE(full.offset + 12); index++) {
      const group = full.offset + 16 + index * 12;
      groups.push([buffer.readUInt32BE(group), buffer.readUInt32BE(group + 4), buffer.readUInt32BE(group + 8)]);
    }
    return (code) => {
      const group = groups.find(([start, end]) => code >= start && code <= end);
      return group ? group[2] + code - group[0] : 0;
    };
  }
  const basic = subtables.find(({ platform, encoding, offset }) => platform === 3 && encoding === 1 && buffer.readUInt16BE(offset) === 4);
  if (!basic) return () => 0;
  const base = basic.offset;
  const segments = buffer.readUInt16BE(base + 6) / 2;
  const ends = base + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return (code) => {
    if (code > 0xffff) return 0;
    for (let segment = 0; segment < segments; segment++) {
      if (code > buffer.readUInt16BE(ends + segment * 2)) continue;
      const start = buffer.readUInt16BE(starts + segment * 2);
      if (code < start) return 0;
      const delta = buffer.readInt16BE(deltas + segment * 2);
      const range = buffer.readUInt16BE(ranges + segment * 2);
      if (!range) return (code + delta) & 0xffff;
      const glyph = buffer.readUInt16BE(ranges + segment * 2 + range + (code - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

function font(style) {
  if (!loaded.has(style)) loaded.set(style, parse(readFileSync(new URL(`../../vendor/fonts/${FILES[style]}`, import.meta.url))));
  return loaded.get(style);
}

/**
 * A font that remembers the glyphs it was asked for, so the PDF lists only
 * their widths and their Unicode text (copy and search work).
 */
export function embeddedFont(style) {
  const parsed = font(style);
  const used = new Map();
  return {
    /** Text as a hex string of two-byte glyph indices (Identity-H). */
    encode(text) {
      let hex = "";
      for (const character of String(text)) {
        const code = character.codePointAt(0);
        const glyph = parsed.glyph(code);
        if (!used.has(glyph)) used.set(glyph, code);
        hex += glyph.toString(16).padStart(4, "0");
      }
      return `<${hex}>`;
    },
    /** The PDF objects of the font; ids gives the object numbers to use, first is the Type0 font. */
    objects(ids, name) {
      const glyphs = [...used.keys()].sort((a, b) => a - b);
      const widths = glyphs.map((glyph) => `${glyph} [${parsed.advance(glyph)}]`).join(" ");
      const unicode = (code) => code > 0xffff
        ? String.fromCharCode(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)).split("").map((unit) => unit.charCodeAt(0).toString(16).padStart(4, "0")).join("")
        : code.toString(16).padStart(4, "0");
      const toUnicode = [
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def",
        "1 begincodespacerange <0000> <FFFF> endcodespacerange",
        ...chunks(glyphs, 100).map((part) => `${part.length} beginbfchar\n${part.map((glyph) => `<${glyph.toString(16).padStart(4, "0")}> <${unicode(used.get(glyph))}>`).join("\n")}\nendbfchar`),
        "endcmap CMapName currentdict /CMap defineresource pop end end"
      ].join("\n");
      const fontFile = deflateSync(parsed.buffer);
      const base = `BCAtlas+${name}`;
      return [
        `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${ids[1]} 0 R] /ToUnicode ${ids[3]} 0 R >>`,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ids[2]} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`,
        `<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${parsed.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${parsed.ascent} /Descent ${parsed.descent} /CapHeight ${Math.round(parsed.ascent * 0.79)} /StemV ${style === "bold" ? 140 : 80} /FontFile2 ${ids[4]} 0 R >>`,
        { stream: deflateSync(Buffer.from(toUnicode, "latin1")) },
        { stream: fontFile, extra: `/Length1 ${parsed.buffer.length}` }
      ];
    }
  };
}

function chunks(items, size) {
  const parts = [];
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size));
  return parts;
}
