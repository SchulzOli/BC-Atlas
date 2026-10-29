// `bca export --view knowledge-graph`: the analyzed project as RDF with the
// BC Atlas OWL ontology, for knowledge graphs and triple stores.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createArchitectureModel } from "../architecture.js";
import { assessArchitecture } from "../blueprint/index.js";
import { knowledgeGraph } from "./graph.js";
import { KNOWLEDGE_FORMATS, serializeGraph } from "./serialize.js";

const pkg = createRequire(import.meta.url)("../../package.json");
const FLUSH = 1 << 20;

export { KNOWLEDGE_FORMATS };

/**
 * Writes the knowledge graph of a project to a file.
 * @returns { file, format, triples, objects, relations }
 */
export async function writeKnowledgeGraph(input, values = {}) {
  const format = values.format ?? (path.extname(values.output ?? "").slice(1).toLowerCase() || "ttl");
  if (!KNOWLEDGE_FORMATS.includes(format)) throw new Error(`--view knowledge-graph writes ${KNOWLEDGE_FORMATS.join(", ")}, not ${format}`);
  const projection = await createArchitectureModel(input, { ...values, view: "project", format: undefined });
  const { model } = projection;
  // Components come from .bca.json, or with --propose from a proposal. The
  // assessment changes the model it reads, so it gets a copy; without an
  // architecture there is nothing to assess, which spares the Base
  // Application that copy.
  const architecture = Boolean(projection.options?.architecture?.components?.length) || Boolean(values.propose);
  const assessment = architecture
    ? await assessArchitecture(input, values, { model: structuredClone(model) }).catch(() => undefined)
    : undefined;
  // The format wins over the extension, as for diagrams: -o graph --format rdf writes graph.rdf.
  const requested = path.resolve(values.output ?? `bc-atlas.${format}`);
  const extension = path.extname(requested).slice(1).toLowerCase();
  const file = extension === format ? requested
    : KNOWLEDGE_FORMATS.includes(extension) ? `${requested.slice(0, -extension.length)}${format}` : `${requested}.${format}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(file, "w");
  let buffer = "";
  const flush = () => {
    fs.writeSync(descriptor, buffer);
    buffer = "";
  };
  let triples;
  try {
    triples = serializeGraph(format, knowledgeGraph({
      model,
      assessment,
      baseIri: values.baseIri,
      title: values.title ?? projection.options?.title ?? `${path.basename(path.resolve(input))} knowledge graph`,
      version: pkg.version,
      // SOURCE_DATE_EPOCH (reproducible builds) fixes the date, so the same source gives the same file.
      generatedAt: process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() : undefined
    }), (chunk) => {
      buffer += chunk;
      if (buffer.length >= FLUSH) flush();
    });
    flush();
  } finally {
    fs.closeSync(descriptor);
  }
  return { file, format, triples, objects: model.objects.length, relations: model.edges.length };
}
