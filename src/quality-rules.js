// Rules for bca check that read what characterizes objects (metadata.js):
//
//   missing-data-classification  table fields without DataClassification
//                                (neither on the field nor on the table)
//   obsolete-without-tag         ObsoleteState or [Obsolete] without a tag
//   high-complexity              procedures above check.maxComplexity
//   missing-tooltip              page fields without a ToolTip (on the page
//                                field or on the table field it shows)
//   obsolete-without-reason      ObsoleteState without ObsoleteReason
//   undocumented-public-api      public procedures of public codeunits and
//                                interfaces without a /// summary
//
// One finding per object, listing what it concerns, so a large app does not
// produce thousands of lines. check.severities sets each rule to error,
// warning, info, or off.
import { SEVERITIES } from "./capabilities.js";

export const QUALITY_RULES = Object.freeze({
  "missing-data-classification": "warning",
  "obsolete-without-tag": "warning",
  "high-complexity": "warning",
  "missing-tooltip": "info",
  "obsolete-without-reason": "info",
  "undocumented-public-api": "info"
});

const LEVELS = [...SEVERITIES, "off"];
const DEFAULT_MAX_COMPLEXITY = 25;
const SHOWN = 8;

const label = (object) => [object.type, object.id, object.name].filter(Boolean).join(" ");
const list = (names) => `${names.slice(0, SHOWN).join(", ")}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ""}`;
const at = (object, location = object.location) => ({
  object: label(object),
  ...(object.file && !String(object.file).includes("#") ? { file: object.file } : {}),
  ...(location?.line ? { line: location.line } : {})
});

/** The severities of the quality rules: defaults, then check.severities. */
export function qualitySettings(settings = {}) {
  const severities = { ...QUALITY_RULES };
  for (const [rule, level] of Object.entries(settings.severities ?? {})) {
    if (!(rule in QUALITY_RULES)) continue;
    if (!LEVELS.includes(level)) throw new Error(`check.severities.${rule} must be one of: ${LEVELS.join(", ")}`);
    severities[rule] = level;
  }
  const maxComplexity = settings.maxComplexity ?? DEFAULT_MAX_COMPLEXITY;
  if (!Number.isInteger(Number(maxComplexity)) || Number(maxComplexity) < 1) throw new Error("check.maxComplexity must be a positive integer");
  return { severities, maxComplexity: Number(maxComplexity) };
}

// "Rec."No."" or Rec.Description -> the field name.
const sourceField = (expression) => /^Rec\.(?:"((?:[^"]|"")*)"|(\w+))$/iu.exec(String(expression ?? "").trim())?.slice(1).find(Boolean)?.replaceAll('""', '"');

/**
 * @param objects the workspace objects of the model (with metadata)
 * @param allObjects every object, symbols included (source tables of pages)
 * @returns findings { severity, rule, message, object, file, line }
 */
export function qualityFindings(objects, allObjects = objects, settings = {}) {
  const { severities, maxComplexity } = qualitySettings(settings);
  const findings = [];
  const add = (rule, message, details) => {
    if (severities[rule] !== "off") findings.push({ severity: severities[rule], rule, message, ...details });
  };
  const tables = new Map();
  for (const object of allObjects) {
    if (object.type === "table") tables.set(String(object.name).toLowerCase(), object);
  }

  for (const object of objects) {
    const meta = object.metadata ?? {};
    const fields = object.fields ?? [];

    // Data classification: on the field, else the table's default; a table
    // extension inherits its base table's default and its temporary type.
    const base = object.type === "tableextension"
      ? tables.get(String((object.relations ?? []).find(({ kind }) => kind === "extends")?.target ?? "").toLowerCase())
      : undefined;
    const tableDefault = meta.dataClassification ?? base?.metadata?.dataClassification;
    const temporary = [meta.tableType, base?.metadata?.tableType].some((type) => /^temporary$/iu.test(type ?? ""));
    if (["table", "tableextension"].includes(object.type) && !temporary) {
      const missing = fields.filter((field) => field.kind === "field" && !field.metadata?.dataClassification && !tableDefault &&
        !/^flow(field|filter)$/iu.test(field.metadata?.fieldClass ?? ""));
      if (missing.length) {
        add("missing-data-classification", `${label(object)}: ${missing.length} field(s) without DataClassification: ${list(missing.map(({ name }) => name))}`, at(object, missing[0].location));
      }
    }

    // ToolTips on the fields bound to the record (Rec."No."), not on labels or
    // links: on the page field, or on the table field it shows (workspace
    // tables only; symbol packages do not say).
    if (["page", "pageextension"].includes(object.type) && !/^api$/iu.test(meta.pageType ?? "")) {
      const source = tables.get(String(meta.sourceTable ?? "").toLowerCase());
      const tableTips = new Map((source && !source.externalSymbol ? source.fields ?? [] : []).map((field) => [String(field.name).toLowerCase(), field.metadata?.toolTip]));
      const checkable = object.type === "pageextension" || (source && !source.externalSymbol) || !meta.sourceTable;
      const missing = checkable ? fields.filter((field) => field.kind === "page-field" && sourceField(field.sourceExpression) && !field.metadata?.toolTip &&
        !tableTips.get(String(sourceField(field.sourceExpression)).toLowerCase())) : [];
      if (missing.length) {
        add("missing-tooltip", `${label(object)}: ${missing.length} field(s) without a ToolTip: ${list(missing.map(({ name }) => name))}`, at(object, missing[0].location));
      }
    }

    // Obsolete markings: what, why, and since when.
    const obsolete = [
      ...(meta.obsolete ? [{ what: "the object", obsolete: meta.obsolete, location: object.location }] : []),
      ...fields.filter(({ metadata }) => metadata?.obsolete).map((field) => ({ what: `field ${field.name}`, obsolete: field.metadata.obsolete, location: field.location })),
      ...(object.procedures ?? []).filter(({ metadata }) => metadata?.obsolete).map((procedure) => ({ what: `procedure ${procedure.name}`, obsolete: procedure.metadata.obsolete, location: procedure.location }))
    ];
    const untagged = obsolete.filter(({ obsolete: info }) => !info.tag);
    if (untagged.length) {
      add("obsolete-without-tag", `${label(object)}: obsolete without an ObsoleteTag (the version it was marked in): ${list(untagged.map(({ what }) => what))}`, at(object, untagged[0].location));
    }
    const unexplained = obsolete.filter(({ obsolete: info }) => !info.reason);
    if (unexplained.length) {
      add("obsolete-without-reason", `${label(object)}: obsolete without an ObsoleteReason (what to use instead): ${list(unexplained.map(({ what }) => what))}`, at(object, unexplained[0].location));
    }

    // Complexity above the limit.
    const complex = (object.procedures ?? []).filter(({ metadata }) => (metadata?.complexity ?? 0) > maxComplexity)
      .sort((a, b) => b.metadata.complexity - a.metadata.complexity);
    if (complex.length) {
      add("high-complexity", `${label(object)}: ${complex.length} procedure(s) above complexity ${maxComplexity}: ${list(complex.map(({ name, metadata }) => `${name} (${metadata.complexity})`))}`, at(object, complex[0].location));
    }

    // The public API of public codeunits and interfaces.
    if (["codeunit", "interface"].includes(object.type) && (meta.access ?? "public") === "public" && !/^test/iu.test(meta.subtype ?? "")) {
      const undocumented = (object.procedures ?? []).filter(({ kind, visibility, metadata }) => kind === "procedure" && (visibility ?? "public") === "public" && !metadata?.documentation);
      if (undocumented.length) {
        add("undocumented-public-api", `${label(object)}: ${undocumented.length} public procedure(s) without a /// summary: ${list(undocumented.map(({ name }) => name))}`, at(object, undocumented[0].location));
      }
    }
  }
  return findings;
}
