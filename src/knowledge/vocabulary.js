// The BC Atlas ontology: OWL classes for apps, namespaces, components, AL
// objects (one class per object type), their members, and their relations;
// object properties for every relation kind the analysis finds; and data
// properties for IDs, names, and source locations. Every export carries the
// terms it uses, so a knowledge graph needs nothing else to load it.

export const ONTOLOGY = "https://schulzoli.github.io/BC-Atlas/ontology";
export const BCA = `${ONTOLOGY}#`;

export const PREFIXES = Object.freeze({
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  dcterms: "http://purl.org/dc/terms/",
  bca: BCA
});

export const RDF_TYPE = `${PREFIXES.rdf}type`;
export const LABEL = `${PREFIXES.rdfs}label`;
export const COMMENT = `${PREFIXES.rdfs}comment`;
const XSD = PREFIXES.xsd;
export const INTEGER = `${XSD}integer`;
export const DATETIME = `${XSD}dateTime`;

export const term = (name) => `${BCA}${name}`;
export const iri = (value) => ({ iri: value });
export const literal = (value, datatype) => ({ value: String(value), ...(datatype ? { datatype } : {}) });

// [class, label, parent, comment]
const CLASSES = [
  ["App", "AL app", undefined, "An extension or app with its own app.json."],
  ["Namespace", "AL namespace", undefined, "A namespace declared by AL objects."],
  ["Component", "Architecture component", undefined, "A component of the target architecture in .bca.json, or of a proposal."],
  ["Object", "AL object", undefined, "An application object such as a table, page, or codeunit."],
  ["ExtensionObject", "AL extension object", "Object", "An object that extends another object: a table, page, report, enum, profile, or permission set extension, or a page customization."],
  ["ExternalObject", "External AL object", "Object", "An object referenced by the workspace but declared elsewhere, for example in the Base Application."],
  ["Field", "Field", undefined, "A field of a table or table extension."],
  ["Key", "Key", undefined, "A key of a table."],
  ["Procedure", "Procedure", undefined, "A procedure of an object."],
  ["Trigger", "Trigger", "Procedure", "A trigger of an object, such as OnRun or OnValidate."],
  ["EventPublisher", "Event publisher", "Procedure", "A procedure with an integration or business event attribute."],
  ["Relation", "Relation", undefined, "One relation found in the source, with its kind, confidence, and location (a qualified form of the direct relation property)."],
  ["ArchitectureViolation", "Architecture violation", undefined, "A dependency between two objects that points against the architecture."]
];

// AL object type -> [class, label, extension]
export const OBJECT_TYPES = Object.freeze({
  table: ["Table", "Table"],
  tableextension: ["TableExtension", "Table extension", true],
  page: ["Page", "Page"],
  pageextension: ["PageExtension", "Page extension", true],
  pagecustomization: ["PageCustomization", "Page customization", true],
  codeunit: ["Codeunit", "Codeunit"],
  report: ["Report", "Report"],
  reportextension: ["ReportExtension", "Report extension", true],
  query: ["Query", "Query"],
  xmlport: ["XmlPort", "XMLport"],
  enum: ["Enum", "Enum"],
  enumextension: ["EnumExtension", "Enum extension", true],
  interface: ["Interface", "Interface"],
  controladdin: ["ControlAddIn", "Control add-in"],
  profile: ["Profile", "Profile"],
  profileextension: ["ProfileExtension", "Profile extension", true],
  permissionset: ["PermissionSet", "Permission set"],
  permissionsetextension: ["PermissionSetExtension", "Permission set extension", true],
  entitlement: ["Entitlement", "Entitlement"]
});

export function objectClass(type) {
  return term(OBJECT_TYPES[type]?.[0] ?? "Object");
}

// [property, label, domain, range, comment]
const OBJECT_PROPERTIES = [
  ["inApp", "in app", "Object", "App", "The app that declares the object."],
  ["inNamespace", "in namespace", "Object", "Namespace", "The namespace of the object."],
  ["inComponent", "in component", "Object", "Component", "The architecture component the object belongs to."],
  ["dependsOnApp", "depends on app", "App", "App", "A dependency declared in app.json."],
  ["mayDependOn", "may depend on", "Component", "Component", "A dependency the architecture allows."],
  ["dependsOnComponent", "depends on component", "Component", "Component", "A dependency between components that the source has today."],
  ["hasField", "has field", "Object", "Field"],
  ["hasKey", "has key", "Object", "Key"],
  ["hasProcedure", "has procedure", "Object", "Procedure"],
  ["keyField", "key field", "Key", "Field", "A field of the key, in order of declaration."],
  ["dependsOn", "depends on", "Object", "Object", "Any relation from one object to another; every relation property below is a kind of it."],
  ["relationSource", "relation source", "Relation", "Object"],
  ["relationTarget", "relation target", "Relation", "Object"],
  ["violationSource", "violation source", "ArchitectureViolation", "Object"],
  ["violationTarget", "violation target", "ArchitectureViolation", "Object"],
  ["sourceComponent", "source component", "ArchitectureViolation", "Component"],
  ["targetComponent", "target component", "ArchitectureViolation", "Component"]
];

// [property, label, range, comment]
const DATA_PROPERTIES = [
  ["objectType", "object type", "string", "The AL object type, such as table or codeunit."],
  ["objectId", "object ID", "integer"],
  ["appId", "app ID", "string", "The id of app.json."],
  ["publisher", "publisher", "string"],
  ["version", "version", "string"],
  ["sourceFile", "source file", "string", "Path of the AL file, relative to the project."],
  ["sourceLine", "source line", "integer"],
  ["caption", "caption", "string"],
  ["access", "access", "string", "The Access property of an object (public or internal)."],
  ["fieldNumber", "field number", "integer"],
  ["dataType", "data type", "string"],
  ["signature", "signature", "string"],
  ["visibility", "visibility", "string", "local, internal, protected, or public."],
  ["layer", "layer", "integer", "The layer of a component; lower layers may not depend on higher ones."],
  ["relationKind", "relation kind", "string"],
  ["confidence", "confidence", "string", "How the relation was resolved: resolved, syntactic, or ambiguous."],
  ["relationClass", "relation class", "string", "schema or runtime for data relations."],
  ["cardinality", "cardinality", "string"],
  ["dataAccess", "data access", "string", "read, write, or read-write."],
  ["operation", "operation", "string", "A data operation such as Get, Insert, or Modify."],
  ["sourceProcedure", "source procedure", "string", "The procedure the relation is written in."],
  ["rule", "rule", "string"],
  ["weight", "weight", "integer", "How many relations a violation stands for."]
];

// Relation kinds of the analysis -> [property, label, comment]
const RELATIONS = {
  calls: ["calls", "calls", "Calls a procedure of the target."],
  reads: ["reads", "reads", "Reads records of the target table."],
  writes: ["writes", "writes", "Inserts, modifies, or deletes records of the target table."],
  relates: ["relatesTo", "relates to", "A table relation to the target table."],
  uses: ["uses", "uses", "Declares a variable or parameter of the target type."],
  extends: ["extends", "extends", "Extends the target object."],
  implements: ["implements", "implements", "Implements the target interface."],
  selects: ["selects", "selects", "Selects an implementation through an enum value."],
  publishes: ["publishes", "publishes", "Publishes an event of the target."],
  subscribes: ["subscribesTo", "subscribes to", "Subscribes to an event of the target."],
  runs: ["runs", "runs", "Runs the target page, report, or codeunit."],
  part: ["hasPart", "has part", "Shows the target page as a part."],
  contains: ["contains", "contains", "Contains the target."],
  permits: ["permits", "permits", "A permission set grants access to the target."],
  includes: ["includes", "includes", "A permission set includes the target permission set."],
  starts: ["starts", "starts", "Starts the target."],
  events: ["raisesEvent", "raises event", "Raises an event of the target."]
};

const camel = (kind) => String(kind).toLowerCase().replace(/[^a-z0-9]+(.)/gu, (_, letter) => letter.toUpperCase()).replace(/[^A-Za-z0-9]/gu, "") || "relatesTo";

/** The property of a relation kind; unknown kinds get one named after them. */
export function relationProperty(kind) {
  return term(RELATIONS[kind]?.[0] ?? camel(kind));
}

/** The ontology's terms as subject blocks: classes, object properties, data properties. */
export function* vocabulary({ version, kinds = [], header = true } = {}) {
  const defined = (types, props) => ({ types, props: [...props, [`${PREFIXES.rdfs}isDefinedBy`, iri(ONTOLOGY)]] });
  // An export has its own ontology header and points here; one document, one header.
  if (header) yield {
    s: ONTOLOGY,
    types: [`${PREFIXES.owl}Ontology`],
    props: [
      [LABEL, literal("BC Atlas ontology for Business Central AL")],
      [COMMENT, literal("Apps, namespaces, architecture components, AL objects, their members, and their relations, as found by BC Atlas in AL source.")],
      [`${PREFIXES.owl}versionInfo`, literal(version)],
      [`${PREFIXES.dcterms}license`, iri("https://opensource.org/licenses/MIT")]
    ]
  };
  const klass = (name, label, parent, comment) => ({
    s: term(name),
    ...defined([`${PREFIXES.owl}Class`], [
      [LABEL, literal(label)],
      ...(parent ? [[`${PREFIXES.rdfs}subClassOf`, iri(term(parent))]] : []),
      ...(comment ? [[COMMENT, literal(comment)]] : [])
    ])
  });
  for (const [name, label, parent, comment] of CLASSES) yield klass(name, label, parent, comment);
  for (const [name, label, extension] of Object.values(OBJECT_TYPES)) yield klass(name, label, extension ? "ExtensionObject" : "Object");
  for (const [name, label, domain, range, comment] of OBJECT_PROPERTIES) {
    yield {
      s: term(name),
      ...defined([`${PREFIXES.owl}ObjectProperty`], [
        [LABEL, literal(label)],
        [`${PREFIXES.rdfs}domain`, iri(term(domain))],
        [`${PREFIXES.rdfs}range`, iri(term(range))],
        ...(comment ? [[COMMENT, literal(comment)]] : [])
      ])
    };
  }
  const relationTerms = new Map(Object.entries(RELATIONS).map(([kind, value]) => [kind, value]));
  for (const kind of kinds) if (!relationTerms.has(kind)) relationTerms.set(kind, [camel(kind), String(kind), `A ${kind} relation.`]);
  for (const [name, label, comment] of relationTerms.values()) {
    yield {
      s: term(name),
      ...defined([`${PREFIXES.owl}ObjectProperty`], [
        [LABEL, literal(label)],
        [`${PREFIXES.rdfs}subPropertyOf`, iri(term("dependsOn"))],
        [COMMENT, literal(comment)]
      ])
    };
  }
  for (const [name, label, range, comment] of DATA_PROPERTIES) {
    yield {
      s: term(name),
      ...defined([`${PREFIXES.owl}DatatypeProperty`], [
        [LABEL, literal(label)],
        [`${PREFIXES.rdfs}range`, iri(`${XSD}${range}`)],
        ...(comment ? [[COMMENT, literal(comment)]] : [])
      ])
    };
  }
}
