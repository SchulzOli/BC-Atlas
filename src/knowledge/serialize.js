// RDF syntaxes for the knowledge graph: Turtle, RDF/XML (written as .rdf or
// .owl), N-Triples, and JSON-LD. Each writes subject blocks one at a time
// through a write function, so even the Base Application never has to fit in
// one string.
import { PREFIXES, RDF_TYPE } from "./vocabulary.js";

import { KNOWLEDGE_FORMATS } from "../capabilities.js";

export { KNOWLEDGE_FORMATS };

// XML 1.0 and RDF literals cannot carry most control characters.
const clean = (value) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/gu, "");

function compact(value) {
  for (const [prefix, namespace] of Object.entries(PREFIXES)) {
    if (!value.startsWith(namespace)) continue;
    const local = value.slice(namespace.length);
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(local)) return { prefix, local };
  }
  return undefined;
}

// ---------------------------------------------------------------- Turtle, N-Triples
const escapeString = (value) => clean(value).replace(/[\\"\n\r\t]/gu, (character) => ({ "\\": "\\\\", "\"": "\\\"", "\n": "\\n", "\r": "\\r", "\t": "\\t" })[character]);
const escapeIri = (value) => value.replace(/[\u0000- <>"{}|^`\\]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`);

function turtleIri(value) {
  const name = compact(value);
  return name ? `${name.prefix}:${name.local}` : `<${escapeIri(value)}>`;
}

function turtleTerm(term) {
  if (term.iri !== undefined) return turtleIri(term.iri);
  return `"${escapeString(term.value)}"${term.datatype ? `^^${turtleIri(term.datatype)}` : term.lang ? `@${term.lang}` : ""}`;
}

function ntTerm(term) {
  if (term.iri !== undefined) return `<${escapeIri(term.iri)}>`;
  return `"${escapeString(term.value)}"${term.datatype ? `^^<${escapeIri(term.datatype)}>` : term.lang ? `@${term.lang}` : ""}`;
}

function writeTurtle(blocks, write) {
  for (const [prefix, namespace] of Object.entries(PREFIXES)) write(`@prefix ${prefix}: <${namespace}> .\n`);
  for (const { s, types, props } of blocks) {
    const lines = [
      ...(types.length ? [`a ${types.map(turtleIri).join(", ")}`] : []),
      ...props.map(([predicate, object]) => `${turtleIri(predicate)} ${turtleTerm(object)}`)
    ];
    if (!lines.length) continue;
    write(`\n${turtleIri(s)} ${lines.join(" ;\n    ")} .\n`);
  }
}

function writeNTriples(blocks, write) {
  for (const { s, types, props } of blocks) {
    const subject = `<${escapeIri(s)}>`;
    let chunk = "";
    for (const type of types) chunk += `${subject} <${RDF_TYPE}> <${escapeIri(type)}> .\n`;
    for (const [predicate, object] of props) chunk += `${subject} <${escapeIri(predicate)}> ${ntTerm(object)} .\n`;
    write(chunk);
  }
}

// ---------------------------------------------------------------- RDF/XML
const escapeXml = (value) => clean(value).replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);

function qname(value) {
  const name = compact(value);
  if (!name) throw new Error(`no XML name for ${value}`);
  return `${name.prefix}:${name.local}`;
}

function writeRdfXml(blocks, write) {
  write(`<?xml version="1.0" encoding="utf-8"?>\n<rdf:RDF${Object.entries(PREFIXES).map(([prefix, namespace]) => `\n    xmlns:${prefix}="${namespace}"`).join("")}>\n`);
  for (const { s, types, props } of blocks) {
    // The first class names the element, like OWL editors write it.
    const [first, ...others] = types;
    const element = first && compact(first) ? qname(first) : "rdf:Description";
    const rest = element === "rdf:Description" ? types : others;
    let chunk = `  <${element} rdf:about="${escapeXml(s)}">\n`;
    for (const type of rest) chunk += `    <rdf:type rdf:resource="${escapeXml(type)}"/>\n`;
    for (const [predicate, object] of props) {
      const name = qname(predicate);
      if (object.iri !== undefined) chunk += `    <${name} rdf:resource="${escapeXml(object.iri)}"/>\n`;
      else chunk += `    <${name}${object.datatype ? ` rdf:datatype="${escapeXml(object.datatype)}"` : object.lang ? ` xml:lang="${escapeXml(object.lang)}"` : ""}>${escapeXml(object.value)}</${name}>\n`;
    }
    write(`${chunk}  </${element}>\n`);
  }
  write("</rdf:RDF>\n");
}

// ---------------------------------------------------------------- JSON-LD
function jsonKey(value) {
  const name = compact(value);
  return name ? `${name.prefix}:${name.local}` : value;
}

function writeJsonLd(blocks, write) {
  write(`{\n  "@context": ${JSON.stringify(PREFIXES)},\n  "@graph": [`);
  let first = true;
  for (const { s, types, props } of blocks) {
    const node = { "@id": s };
    if (types.length) node["@type"] = types.map(jsonKey);
    for (const [predicate, object] of props) {
      const key = jsonKey(predicate);
      const value = object.iri !== undefined
        ? { "@id": object.iri }
        : { "@value": clean(object.value), ...(object.datatype ? { "@type": jsonKey(object.datatype) } : object.lang ? { "@language": object.lang } : {}) };
      (node[key] ??= []).push(value);
    }
    write(`${first ? "" : ","}\n    ${JSON.stringify(node)}`);
    first = false;
  }
  write("\n  ]\n}\n");
}

const WRITERS = { ttl: writeTurtle, nt: writeNTriples, rdf: writeRdfXml, owl: writeRdfXml, jsonld: writeJsonLd };

/** Writes the blocks in a format through write(chunk); returns the number of triples. */
export function serializeGraph(format, blocks, write) {
  const writer = WRITERS[format];
  if (!writer) throw new Error(`unsupported knowledge graph format: ${format} (use ${KNOWLEDGE_FORMATS.join(", ")})`);
  let triples = 0;
  writer((function* counted() {
    for (const value of blocks) {
      triples += value.types.length + value.props.length;
      yield value;
    }
  })(), write);
  return triples;
}
