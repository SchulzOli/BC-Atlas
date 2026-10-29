# Knowledge graph (RDF and OWL)

`bca export --view knowledge-graph` writes the analyzed project as RDF, the
open W3C standard for knowledge graphs, together with the BC Atlas OWL
ontology that describes it. Load it into a triple store, a graph database, or
an ontology editor, query it with SPARQL, and join it with other data about
your apps.

```sh
bca export ./app --view knowledge-graph                  # bc-atlas.ttl (Turtle)
bca export ./app --view knowledge-graph -o atlas.owl     # OWL (RDF/XML) for Protégé
bca export ./app --view knowledge-graph -o atlas.rdf     # RDF/XML
bca export ./app --view knowledge-graph -o atlas.nt      # N-Triples, one triple per line
bca export ./app --view knowledge-graph -o atlas.jsonld  # JSON-LD
bca export ./app --view knowledge-graph --base-iri https://example.com/bc/ -o atlas.ttl
```

| Format | Extension | Syntax | Good for |
| --- | --- | --- | --- |
| `ttl` (default) | `.ttl` | Turtle | Reading, Apache Jena and Fuseki, GraphDB, Stardog, Neo4j with neosemantics |
| `owl` | `.owl` | RDF/XML | Protégé and other OWL tools (OWL API, reasoners) |
| `rdf` | `.rdf` | RDF/XML | Tools that expect RDF/XML |
| `nt` | `.nt` | N-Triples | Bulk loaders (Amazon Neptune, Blazegraph), `grep` and line tools |
| `jsonld` | `.jsonld` | JSON-LD | Web and JSON tooling |

All formats hold the same graph. The format follows `--format`, or the
extension of `-o`.

## What is in the graph

Every file starts with the ontology: OWL classes and properties with labels
and comments, so a tool needs nothing else to load it. Its terms live in the
namespace `https://schulzoli.github.io/BC-Atlas/ontology#` (prefix `bca:`).

| Resource | Class | Properties |
| --- | --- | --- |
| App (`app.json`) | `bca:App` | `rdfs:label`, `bca:appId`, `bca:publisher`, `bca:version`, `bca:dependsOnApp` |
| Namespace | `bca:Namespace` | `rdfs:label` |
| AL object | `bca:Table`, `bca:Page`, `bca:Codeunit`, ... (subclasses of `bca:Object`; extensions also of `bca:ExtensionObject`) | `rdfs:label`, `bca:objectType`, `bca:objectId`, `bca:caption`, `bca:access`, `bca:inApp`, `bca:inNamespace`, `bca:inComponent`, `bca:sourceFile`, `bca:sourceLine`, `dcterms:identifier`, `bca:hasField`, `bca:hasKey`, `bca:hasProcedure` |
| Field, key, procedure | `bca:Field`, `bca:Key`, `bca:Procedure` (`bca:Trigger`, `bca:EventPublisher`) | `rdfs:label`, `bca:fieldNumber`, `bca:dataType`, `bca:keyField`, `bca:signature`, `bca:visibility`, `bca:sourceLine` |
| Relation between objects | a property per kind: `bca:calls`, `bca:reads`, `bca:writes`, `bca:relatesTo`, `bca:uses`, `bca:extends`, `bca:implements`, `bca:subscribesTo`, `bca:runs`, `bca:hasPart`, `bca:permits`, ... (all sub-properties of `bca:dependsOn`) | |
| The same relation with its evidence | `bca:Relation` | `bca:relationSource`, `bca:relationTarget`, `bca:relationKind`, `bca:confidence`, `bca:relationClass`, `bca:cardinality`, `bca:dataAccess`, `bca:operation`, `bca:sourceProcedure`, `bca:sourceFile`, `bca:sourceLine` |
| Object outside the workspace (for example in the Base Application) | `bca:ExternalObject` and its type's class | `rdfs:label`, `bca:objectType` |
| Architecture component (`.bca.json`, or a proposal with `--propose`) | `bca:Component` | `rdfs:label`, `bca:layer`, `bca:mayDependOn`, `bca:dependsOnComponent` |
| Dependency against the architecture | `bca:ArchitectureViolation` | `bca:rule`, `bca:violationSource`, `bca:violationTarget`, `bca:sourceComponent`, `bca:targetComponent`, `bca:weight` |

Resources get stable IRIs from what identifies them in AL: an object is
`urn:bc-atlas:app:<app id>:<type>:<id>` (or its lowercase name for objects
without an ID), a field adds `:field:<number>`, a namespace is
`urn:bc-atlas:namespace:<name>`. With `--base-iri https://example.com/bc/`
they become `https://example.com/bc/app/<app id>/<type>/<id>` and so on, so
exports of several projects can share one graph. Set `SOURCE_DATE_EPOCH` to
fix the export date (`dcterms:created`); the same source then gives the same
file.

## Load it

- **Protégé**: open the `.owl` file. The classes, properties, and objects
  appear as an ontology with individuals; a reasoner (HermiT) classifies every
  table as a `bca:Object`.
- **Apache Jena / Fuseki, GraphDB, Stardog**: load the `.ttl` file into a
  dataset and query it with SPARQL.
- **Neo4j** with [neosemantics](https://neo4j.com/labs/neosemantics/):
  `CALL n10s.graphconfig.init(); CALL n10s.rdf.import.fetch("file:///path/atlas.ttl", "Turtle");`
- **Amazon Neptune, Blazegraph**: bulk-load the `.nt` file.

## Query it

```sparql
PREFIX bca: <https://schulzoli.github.io/BC-Atlas/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

# Which objects write to which table?
SELECT ?writer ?table WHERE {
  ?w bca:writes ?t .
  ?w rdfs:label ?writer .
  ?t a bca:Table ; rdfs:label ?table .
}

# Dependencies across apps that app.json does not declare
SELECT ?from ?to WHERE {
  ?a bca:dependsOn ?b .
  ?a bca:inApp ?appA . ?b bca:inApp ?appB .
  FILTER (?appA != ?appB)
  FILTER NOT EXISTS { ?appA bca:dependsOnApp ?appB }
  ?a rdfs:label ?from . ?b rdfs:label ?to .
}

# Where each wrong-way dependency is written
SELECT ?source ?target ?file ?line WHERE {
  ?v a bca:ArchitectureViolation ; bca:violationSource ?s ; bca:violationTarget ?t .
  ?r bca:relationSource ?s ; bca:relationTarget ?t ; bca:sourceFile ?file ; bca:sourceLine ?line .
  ?s rdfs:label ?source . ?t rdfs:label ?target .
}
```

`bca:dependsOn` is the super-property of every relation kind, so a store with
RDFS inference answers the second query for every kind; without inference,
replace it with `(bca:calls|bca:reads|bca:writes|bca:uses|bca:extends)`.

## Size

The graph grows with the relations: every relation is one direct triple and
one `bca:Relation` with its evidence. The [warehouse example](../examples/knowledge-graph/warehouse-app.ttl)
has about 840 triples; the Base Application (8,083 objects, 381,301
relations) has 4.4 million triples, 270 MB of Turtle, written in about 20
seconds after its analysis.
