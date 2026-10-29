import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsonld from "jsonld";
import { Parser, Store } from "n3";
import { RdfXmlParser } from "rdfxml-streaming-parser";

import { resourceIris } from "../src/knowledge/graph.js";
import { writeKnowledgeGraph } from "../src/knowledge/index.js";
import { BCA, relationProperty } from "../src/knowledge/vocabulary.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const workspace = path.join(root, "examples", "multi-app");
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";

function parseRdfXml(text) {
  return new Promise((resolve, reject) => {
    const quads = [];
    const parser = new RdfXmlParser();
    parser.on("data", (quad) => quads.push(quad));
    parser.on("error", reject);
    parser.on("end", () => resolve(quads));
    parser.end(text);
  });
}

// One line per triple, blank nodes aside, so graphs in different syntaxes compare as sets.
const canonical = (quads) => quads.map(({ subject, predicate, object }) =>
  `${subject.value} ${predicate.value} ${object.termType === "Literal" ? `"${object.value}"^^${object.datatype.value}` : object.value}`).sort();

async function exportAll(directory) {
  const graphs = {};
  for (const format of ["ttl", "rdf", "owl", "nt", "jsonld"]) {
    const result = await writeKnowledgeGraph(workspace, { output: path.join(directory, `graph.${format}`) });
    const text = readFileSync(result.file, "utf8");
    graphs[format] = {
      result,
      quads: format === "ttl" || format === "nt"
        ? new Parser({ format: format === "nt" ? "N-Triples" : "Turtle" }).parse(text)
        : format === "jsonld"
          ? new Parser({ format: "N-Quads" }).parse(await jsonld.toRDF(JSON.parse(text), { format: "application/n-quads" }))
          : await parseRdfXml(text)
    };
  }
  return graphs;
}

test("the knowledge graph is the same graph in Turtle, RDF/XML, OWL, N-Triples, and JSON-LD", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-kg-"));
  const date = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = "1700000000";
  try {
    const graphs = await exportAll(directory);
    const turtle = canonical(graphs.ttl.quads);
    assert.ok(turtle.length > 500);
    for (const format of ["rdf", "owl", "nt", "jsonld"]) {
      assert.deepEqual(canonical(graphs[format].quads), turtle, `${format} parses to the Turtle graph`);
      assert.equal(graphs[format].result.triples, turtle.length, `${format} counts its triples`);
    }
    assert.match(readFileSync(path.join(directory, "graph.owl"), "utf8"), /^<\?xml version="1\.0" encoding="utf-8"\?>\n<rdf:RDF/u);
  } finally {
    if (date === undefined) delete process.env.SOURCE_DATE_EPOCH;
    else process.env.SOURCE_DATE_EPOCH = date;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the knowledge graph has the ontology, the apps, components, objects, members, and relations", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-kg-"));
  try {
    const { file } = await writeKnowledgeGraph(workspace, { output: path.join(directory, "graph.ttl") });
    const store = new Store(new Parser().parse(readFileSync(file, "utf8")));
    const one = (subject, predicate) => store.getObjects(subject, predicate, null).map(({ value }) => value);
    const ofType = (type) => store.getSubjects(`${RDF}type`, type, null).map(({ value }) => value);
    const labelled = (type, label) => ofType(type).find((subject) => one(subject, `${RDFS}label`).includes(label));

    // One ontology header (the export), the vocabulary in it.
    assert.deepEqual(ofType(`${OWL}Ontology`), ["urn:bc-atlas:graph"]);
    assert.ok(ofType(`${OWL}Class`).includes(`${BCA}Table`));
    assert.deepEqual(one(`${BCA}TableExtension`, `${RDFS}subClassOf`), [`${BCA}ExtensionObject`]);
    assert.deepEqual(one(relationProperty("writes"), `${RDFS}subPropertyOf`), [`${BCA}dependsOn`]);

    const ids = resourceIris();
    const core = ids.app("5d3c0a9e-6b4f-4c1a-9a51-3c1f2e7d0a01");
    assert.deepEqual(one(core, `${RDFS}label`), ["Contoso Core"]);
    assert.deepEqual(one(ids.app("5d3c0a9e-6b4f-4c1a-9a51-3c1f2e7d0a03"), `${BCA}dependsOnApp`), [ids.app("5d3c0a9e-6b4f-4c1a-9a51-3c1f2e7d0a02")]);

    const item = labelled(`${BCA}Table`, "CON Item");
    assert.equal(item, "urn:bc-atlas:app:5d3c0a9e-6b4f-4c1a-9a51-3c1f2e7d0a01:table:50000");
    assert.deepEqual(one(item, `${BCA}objectId`), ["50000"]);
    assert.deepEqual(one(item, `${BCA}inApp`), [core]);
    assert.deepEqual(one(item, `${BCA}inNamespace`), [ids.namespace("Contoso.Core.Items")]);
    assert.deepEqual(one(item, `${BCA}inComponent`), [ids.component("Core")], "components come from .bca.json");
    assert.deepEqual(one(item, `${BCA}sourceFile`), ["core/Items.al"]);
    const fields = one(item, `${BCA}hasField`);
    assert.ok(fields.includes(`${item}:field:1`));
    assert.deepEqual(one(`${item}:field:1`, `${RDFS}label`), ["No."]);
    assert.deepEqual(one(one(item, `${BCA}hasKey`)[0], `${BCA}keyField`), [`${item}:field:1`]);

    // A direct relation and its qualified form with the evidence.
    const sync = labelled(`${BCA}Codeunit`, "CON Item Sync");
    assert.ok(one(sync, relationProperty("writes")).includes(item));
    const relation = store.getSubjects(`${BCA}relationSource`, sync, null).map(({ value }) => value)
      .find((subject) => one(subject, `${BCA}relationKind`).includes("writes"));
    assert.deepEqual(one(relation, `${BCA}relationTarget`), [item]);
    assert.ok(one(relation, `${BCA}operation`).includes("Modify"));
    assert.deepEqual(one(relation, `${BCA}sourceFile`), ["integration/ItemSync.al"]);

    // The configured architecture: what may depend on what, and what does not follow it.
    assert.deepEqual(one(ids.component("Sales"), `${BCA}mayDependOn`), [ids.component("Core")]);
    const [violation] = ofType(`${BCA}ArchitectureViolation`);
    assert.deepEqual(one(violation, `${BCA}violationSource`), [sync]);
    assert.deepEqual(one(violation, `${BCA}sourceComponent`), [ids.component("Integration")]);

    // A table the workspace uses but does not declare.
    assert.ok(ofType(`${BCA}ExternalObject`).some((subject) => one(subject, `${RDFS}label`).includes("Customer")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resource IRIs are URNs by default and follow a base IRI", () => {
  const urn = resourceIris();
  assert.equal(urn.object({ app: { id: "a" }, type: "codeunit", id: "50100" }), "urn:bc-atlas:app:a:codeunit:50100");
  assert.equal(urn.object({ app: { id: "a" }, type: "interface", name: "Posts Sales" }), "urn:bc-atlas:app:a:interface:posts%20sales");
  assert.equal(urn.namespace("Contoso.Sales:x"), "urn:bc-atlas:namespace:Contoso.Sales%3Ax");
  const http = resourceIris("https://example.com/bc");
  assert.equal(http.object({ app: { id: "a" }, type: "table", id: "1" }), "https://example.com/bc/app/a/table/1");
  assert.equal(http.member("https://example.com/bc/app/a/table/1", "field", "No."), "https://example.com/bc/app/a/table/1/field/No.");
});

test("bca export --view knowledge-graph writes the format of the extension or of --format", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bc-atlas-kg-"));
  try {
    const owl = spawnSync(process.execPath, [cli, "export", workspace, "--view", "knowledge-graph", "-o", path.join(directory, "atlas.owl")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(owl.status, 0, owl.stderr);
    assert.match(owl.stdout, /Knowledge graph: 12 object\(s\), \d+ relation\(s\), \d+ triple\(s\) as owl\./u);
    assert.match(readFileSync(path.join(directory, "atlas.owl"), "utf8"), /<owl:Ontology rdf:about="urn:bc-atlas:graph">/u);
    const rdf = spawnSync(process.execPath, [cli, "export", workspace, "--view", "knowledge-graph", "--format", "rdf", "--base-iri", "https://example.com/bc/", "-o", path.join(directory, "atlas")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(rdf.status, 0, rdf.stderr);
    assert.match(readFileSync(path.join(directory, "atlas.rdf"), "utf8"), /rdf:about="https:\/\/example\.com\/bc\/graph"/u);
    const wrong = spawnSync(process.execPath, [cli, "export", workspace, "--view", "knowledge-graph", "--format", "svg"], { encoding: "utf8" });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /--view knowledge-graph writes ttl or rdf or owl or nt or jsonld, not svg/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
