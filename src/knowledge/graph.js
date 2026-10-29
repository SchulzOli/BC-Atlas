// The analyzed AL source as a knowledge graph: subject blocks (an IRI, its
// classes, its properties) for the export document, the ontology, the apps,
// namespaces, and architecture components, every object with its fields,
// keys, and procedures, the relations between objects (a direct property
// and a qualified Relation with kind, confidence, and location), and the
// dependencies that point against the architecture.
import { createHash } from "node:crypto";
import {
  COMMENT, DATETIME, INTEGER, LABEL, OBJECT_TYPES, ONTOLOGY, PREFIXES,
  iri, literal, objectClass, relationProperty, term, vocabulary
} from "./vocabulary.js";

const DEFAULT_BASE = "urn:bc-atlas:";

/** IRIs of the export's resources, under a base IRI (a URN by default). */
export function resourceIris(base = DEFAULT_BASE) {
  const urn = base.startsWith("urn:");
  const separator = urn ? ":" : "/";
  const prefix = urn || /[/#:]$/u.test(base) ? base : `${base}/`;
  const encode = (part) => encodeURIComponent(String(part)).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const make = (...parts) => `${prefix}${parts.map(encode).join(separator)}`;
  return {
    graph: make("graph"),
    app: (id) => make("app", id),
    namespace: (name) => make("namespace", name),
    component: (name) => make("component", name),
    object: (object) => make("app", object.app?.id ?? "workspace", object.type, object.id ?? String(object.name).toLowerCase()),
    member: (owner, kind, name) => `${owner}${separator}${encode(kind)}${separator}${encode(name)}`,
    external: (type, name) => make("external", type, String(name).toLowerCase()),
    relation: (hash) => make("relation", hash),
    violation: (hash) => make("violation", hash)
  };
}

const integer = (value) => (/^-?\d+$/u.test(String(value ?? "")) ? literal(value, INTEGER) : undefined);
const text = (value) => (value === undefined || value === null || value === "" ? undefined : literal(value));
const unquote = (value) => String(value).replace(/^'(.*)'$/su, "$1").replace(/^"(.*)"$/su, "$1");

/** Drops properties without a value. */
function block(s, types, props) {
  return { s, types, props: props.filter(([, object]) => object !== undefined) };
}

const shortHash = (value) => createHash("sha1").update(value).digest("hex").slice(0, 16);

/**
 * @param model the resolved model of the project view (createArchitectureModel)
 * @param assessment optional architecture assessment (assessArchitecture)
 * @param baseIri base of the resources' IRIs
 */
export function* knowledgeGraph({ model, assessment, baseIri, title, version, generatedAt = new Date().toISOString() }) {
  const ids = resourceIris(baseIri);
  const kinds = [...new Set(model.edges.map(({ kind }) => kind))].sort();
  const objects = model.objects.filter(({ key }) => key);
  const objectIri = new Map(objects.map((object) => [object.key, ids.object(object)]));
  const assignment = assessment?.result.assignment ?? new Map();

  yield block(ids.graph, [`${PREFIXES.owl}Ontology`], [
    [LABEL, text(title)],
    [COMMENT, literal(`AL source analyzed by BC Atlas: ${objects.length} objects, ${model.edges.length} relations.`)],
    [`${PREFIXES.dcterms}created`, literal(generatedAt, DATETIME)],
    [`${PREFIXES.dcterms}creator`, literal(`BC Atlas ${version}`)],
    [`${PREFIXES.dcterms}conformsTo`, iri(ONTOLOGY)],
    [`${PREFIXES.rdfs}seeAlso`, iri(ONTOLOGY)]
  ]);
  yield* vocabulary({ version, kinds, header: false });

  // Apps, with the apps they depend on even when those are not in the workspace.
  const apps = new Map();
  for (const app of model.apps ?? []) apps.set(app.id, app);
  for (const app of model.apps ?? []) for (const dependency of app.dependencies ?? []) if (!apps.has(dependency.id)) apps.set(dependency.id, dependency);
  for (const app of apps.values()) {
    yield block(ids.app(app.id), [term("App")], [
      [LABEL, text(app.name)],
      [term("appId"), text(app.id)],
      [term("publisher"), text(app.publisher)],
      [term("version"), text(app.version)],
      ...(app.dependencies ?? []).map((dependency) => [term("dependsOnApp"), iri(ids.app(dependency.id))])
    ]);
  }

  for (const name of [...new Set(objects.map(({ namespace }) => namespace).filter(Boolean))].sort()) {
    yield block(ids.namespace(name), [term("Namespace")], [[LABEL, literal(name)]]);
  }

  for (const component of assessment?.result.components ?? []) {
    const configured = assessment.architecture?.components?.find(({ name }) => name === component.name);
    yield block(ids.component(component.name), [term("Component")], [
      [LABEL, literal(component.name)],
      [term("layer"), integer(component.layer)],
      ...(configured?.dependsOn ?? []).map((name) => [term("mayDependOn"), iri(ids.component(name))]),
      ...(component.dependsOnActual ?? []).map((name) => [term("dependsOnComponent"), iri(ids.component(typeof name === "string" ? name : name.name))])
    ]);
  }

  // Relations, grouped by source object for the direct properties.
  const outgoing = new Map();
  const externals = new Map();
  for (const edge of model.edges) {
    let target = edge.to ? objectIri.get(edge.to) : undefined;
    if (!target && edge.unresolved) {
      target = ids.external(edge.unresolved.type, edge.unresolved.name);
      externals.set(target, edge.unresolved);
    }
    if (!target || !objectIri.has(edge.from)) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push({ edge, target });
  }

  for (const object of objects) {
    const subject = objectIri.get(object.key);
    const caption = object.properties?.find(({ name }) => name.toLowerCase() === "caption")?.value;
    const fields = (object.fields ?? []).map((field) => ({ field, iri: ids.member(subject, "field", field.number ?? field.name) }));
    const fieldIri = new Map(fields.map(({ field, iri: value }) => [String(field.name).toLowerCase(), value]));
    const procedureNames = new Map();
    const procedures = (object.procedures ?? []).map((procedure) => {
      const seen = procedureNames.get(procedure.name) ?? 0;
      procedureNames.set(procedure.name, seen + 1);
      return { procedure, iri: ids.member(subject, procedure.kind === "trigger" ? "trigger" : "procedure", seen ? `${procedure.name}~${seen + 1}` : procedure.name) };
    });
    const keys = (object.keys ?? []).map((key) => ({ key, iri: ids.member(subject, "key", key.name) }));
    const direct = new Map();
    for (const { edge, target } of outgoing.get(object.key) ?? []) direct.set(`${edge.kind}\u0000${target}`, [relationProperty(edge.kind), iri(target)]);
    yield block(subject, [objectClass(object.type)], [
      [LABEL, text(object.name)],
      [term("objectType"), text(object.type)],
      [term("objectId"), integer(object.id)],
      [`${PREFIXES.dcterms}identifier`, text(object.key)],
      [term("caption"), caption ? literal(unquote(caption)) : undefined],
      [term("access"), text(object.objectAccess)],
      [term("inApp"), object.app?.id ? iri(ids.app(object.app.id)) : undefined],
      [term("inNamespace"), object.namespace ? iri(ids.namespace(object.namespace)) : undefined],
      [term("inComponent"), assignment.has(object.key) ? iri(ids.component(assignment.get(object.key))) : undefined],
      [term("sourceFile"), text(object.file)],
      [term("sourceLine"), integer(object.location?.line)],
      ...fields.map(({ iri: value }) => [term("hasField"), iri(value)]),
      ...keys.map(({ iri: value }) => [term("hasKey"), iri(value)]),
      ...procedures.map(({ iri: value }) => [term("hasProcedure"), iri(value)]),
      ...direct.values()
    ]);
    for (const { field, iri: value } of fields) {
      yield block(value, [term("Field")], [
        [LABEL, text(field.name)],
        [term("fieldNumber"), integer(field.number)],
        [term("dataType"), text(field.type)],
        [term("sourceLine"), integer(field.location?.line)]
      ]);
    }
    for (const { key, iri: value } of keys) {
      yield block(value, [term("Key")], [
        [LABEL, text(key.name)],
        ...(key.fields ?? []).map((name) => fieldIri.get(String(name).toLowerCase())).filter(Boolean).map((field) => [term("keyField"), iri(field)])
      ]);
    }
    for (const { procedure, iri: value } of procedures) {
      const event = (procedure.attributes ?? []).some((attribute) => /^\[\s*(Integration|Business|Internal)Event\b/iu.test(attribute));
      yield block(value, [term(procedure.kind === "trigger" ? "Trigger" : event ? "EventPublisher" : "Procedure")], [
        [LABEL, text(procedure.name)],
        [term("signature"), text(procedure.signature)],
        [term("visibility"), text(procedure.visibility)],
        [term("sourceLine"), integer(procedure.location?.line)]
      ]);
    }
  }

  for (const [value, { type, name }] of externals) {
    yield block(value, [term("ExternalObject"), ...(OBJECT_TYPES[type] ? [objectClass(type)] : [])], [
      [LABEL, text(name)],
      [term("objectType"), text(type)]
    ]);
  }

  // Every relation once more as a resource of its own, with its evidence.
  for (const [from, list] of outgoing) {
    for (const { edge, target } of list) {
      const location = edge.location ?? {};
      const subject = ids.relation(shortHash(`${from}\u0000${target}\u0000${edge.kind}\u0000${location.file ?? ""}:${location.line ?? ""}:${location.column ?? ""}\u0000${edge.id ?? ""}`));
      const operations = [...new Set([edge.operation, ...(edge.operations ?? [])].filter(Boolean))];
      const procedures = [...new Set([edge.sourceProcedure, ...(edge.sourceProcedures ?? [])].filter(Boolean))];
      yield block(subject, [term("Relation")], [
        [term("relationSource"), iri(objectIri.get(from))],
        [term("relationTarget"), iri(target)],
        [term("relationKind"), text(edge.kind)],
        [term("confidence"), text(edge.confidence)],
        [term("relationClass"), text(edge.relationClass)],
        [term("cardinality"), text(edge.cardinality)],
        [term("dataAccess"), text(edge.access)],
        ...operations.map((operation) => [term("operation"), literal(operation)]),
        ...procedures.map((procedure) => [term("sourceProcedure"), literal(procedure)]),
        [term("sourceFile"), text(location.file)],
        [term("sourceLine"), integer(location.line)]
      ]);
    }
  }

  for (const violation of assessment && !assessment.proposal ? assessment.result.violations ?? [] : []) {
    const source = objectIri.get(violation.source?.id);
    const target = objectIri.get(violation.target?.id);
    if (!source || !target) continue;
    yield block(ids.violation(shortHash(`${violation.rule}\u0000${violation.source.id}\u0000${violation.target.id}`)), [term("ArchitectureViolation")], [
      [term("rule"), text(violation.rule)],
      [term("violationSource"), iri(source)],
      [term("violationTarget"), iri(target)],
      [term("sourceComponent"), violation.sourceComponent ? iri(ids.component(violation.sourceComponent)) : undefined],
      [term("targetComponent"), violation.targetComponent ? iri(ids.component(violation.targetComponent)) : undefined],
      [term("weight"), integer(violation.weight)]
    ]);
  }
}
