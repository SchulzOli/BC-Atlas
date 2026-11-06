// What characterizes an AL object, a field, or a procedure, read from what
// the analyzer parsed already (properties, attributes, members, locations):
// captions and their translator comments, documentation comments, access,
// obsolete state, data classification, the kind of page or table, how large
// it is, and how complex its code is. The raw `properties` stay as they are;
// `metadata` adds the normalized meaning next to them. Pure functions, so the
// parse cache (parse-cache.js lists this file) can store the result.

/** Splits an AL text property: 'Sales Order', Comment = 'Header', Locked = true, MaxLength = 30. */
export function alText(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  const quoted = /^'((?:[^']|'')*)'/u.exec(text);
  if (!quoted) return { text: unquote(text) };
  const result = { text: quoted[1].replaceAll("''", "'") };
  const rest = text.slice(quoted[0].length);
  for (const [, name, raw] of rest.matchAll(/,\s*([A-Za-z]+)\s*=\s*('(?:[^']|'')*'|[^,]+)/gu)) {
    const key = name.toLowerCase();
    const option = unquote(raw.trim());
    if (key === "comment") result.comment = option;
    else if (key === "locked") result.locked = /^true$/iu.test(option);
    else if (key === "maxlength" && /^\d+$/u.test(option)) result.maxLength = Number(option);
  }
  return result;
}

function unquote(value) {
  const text = String(value ?? "").trim();
  if (/^'.*'$/su.test(text)) return text.slice(1, -1).replaceAll("''", "'");
  if (/^".*"$/su.test(text)) return text.slice(1, -1);
  return text;
}

/** Property values by lowercase name (the last one wins, as in AL). */
function propertyMap(properties = []) {
  const map = new Map();
  for (const { name, value } of properties) if (name) map.set(name.toLowerCase(), value);
  return map;
}

const bool = (value) => value === undefined ? undefined : /^true$/iu.test(String(value).trim());
const word = (value) => value === undefined ? undefined : unquote(value).replace(/\s+/gu, " ");

/**
 * `/// <summary>Posts the order.</summary>` directly above a declaration
 * (attributes and preprocessor lines may sit in between), as plain text: the
 * summary when there is one, else every line.
 */
export function documentationComment(source, startIndex) {
  const lines = source.slice(Math.max(0, startIndex - 8000), startIndex).split(/\r?\n/u);
  lines.pop(); // the declaration's own line up to its start
  const docs = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (line.startsWith("///")) docs.unshift(line.slice(3).trim());
    // Attributes and preprocessor lines (#pragma warning disable ...) may sit in between.
    else if (!line || /^\[.*\]$/u.test(line) || /^#(pragma|if|elif|else|endif|region|endregion)\b/iu.test(line)) {
      if (docs.length && !line) break;
    } else break;
  }
  if (!docs.length) return undefined;
  const xml = docs.join("\n");
  const summary = /<summary>([\s\S]*?)<\/summary>/iu.exec(xml)?.[1] ?? xml;
  const text = summary
    .replace(/<(?:see|paramref|typeparamref)\s+(?:cref|name)="([^"]*)"\s*\/>/giu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
  return text || undefined;
}

// Decision points for cyclomatic complexity: each adds one path through the code.
const DECISIONS = new Set(["if_statement", "while_statement", "for_statement", "foreach_statement", "repeat_statement", "case_branch"]);

/** McCabe complexity of a procedure node: 1 + decisions + `and` / `or` in conditions. */
export function cyclomaticComplexity(node) {
  let total = 1;
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (DECISIONS.has(current.type)) total++;
    else if (current.type === "and" || current.type === "or" || current.type === "and_then" || current.type === "or_else") total++;
    for (let index = 0; index < current.childCount; index++) stack.push(current.child(index));
  }
  return total;
}

const lineCount = (location) => location?.line && location?.endLine ? location.endLine - location.line + 1 : undefined;

function obsoleteOf(properties, attributes = []) {
  const state = word(properties.get("obsoletestate"));
  const attribute = attributes.map((text) => /^\[\s*Obsolete\s*(?:\((.*)\))?\s*\]$/isu.exec(text)).find(Boolean);
  if (!state && !attribute) return undefined;
  const [reason, tag] = attribute?.[1] ? [...attribute[1].matchAll(/'((?:[^']|'')*)'/gu)].map(([, text]) => text.replaceAll("''", "'")) : [];
  return {
    state: (state ?? "pending").toLowerCase(),
    ...(properties.get("obsoletereason") || reason ? { reason: alText(properties.get("obsoletereason"))?.text ?? reason } : {}),
    ...(properties.get("obsoletetag") || tag ? { tag: alText(properties.get("obsoletetag"))?.text ?? tag } : {})
  };
}

/** Only the keys that have a value, so the model stays small. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && !value.length)));
}

/** A field of a table or a page: what it shows and how it is stored. */
export function fieldMetadata(field) {
  const properties = propertyMap(field.properties);
  const caption = alText(properties.get("caption"));
  return compact({
    caption: caption?.text,
    captionComment: caption?.comment,
    toolTip: alText(properties.get("tooltip"))?.text,
    dataClassification: word(properties.get("dataclassification")),
    fieldClass: word(properties.get("fieldclass")),
    calcFormula: properties.get("calcformula")?.trim(),
    editable: bool(properties.get("editable")),
    obsolete: obsoleteOf(properties)
  });
}

/** A procedure, trigger, or event: its documentation, size, and complexity. */
export function procedureMetadata(procedure) {
  const properties = propertyMap(procedure.properties);
  return compact({
    documentation: procedure.documentation,
    lines: lineCount(procedure.location),
    complexity: procedure.complexity,
    obsolete: obsoleteOf(properties, procedure.attributes),
    ...(procedure.attributes?.some((text) => /^\[\s*NonDebuggable\b/iu.test(text)) ? { nonDebuggable: true } : {}),
    ...(procedure.attributes?.some((text) => /^\[\s*InherentPermissions\b/iu.test(text)) ? { inherentPermissions: procedure.attributes.find((text) => /^\[\s*InherentPermissions\b/iu.test(text)).replace(/^\[\s*InherentPermissions\s*\(|\)\s*\]$/giu, "").trim() } : {})
  });
}

/**
 * What characterizes an object: what users see (caption), what it is for
 * (documentation, description), how others may use it (access, extensible,
 * obsolete), its kind (page type, table type, subtype, source table), how it
 * handles data (data classification, permissions), and how large and complex
 * it is.
 */
export function objectMetadata(object) {
  const properties = propertyMap(object.properties);
  const caption = alText(properties.get("caption"));
  const procedures = object.procedures ?? [];
  const code = procedures.filter(({ hasBody }) => hasBody);
  const complexityOf = (procedure) => procedure.metadata?.complexity ?? procedure.complexity;
  const complexities = code.map(complexityOf).filter((value) => typeof value === "number");
  const count = (kind) => procedures.filter((procedure) => procedure.kind === kind).length;
  const access = word(properties.get("access"))?.toLowerCase();
  return compact({
    caption: caption?.text,
    captionComment: caption?.comment,
    documentation: object.documentation,
    description: alText(properties.get("description"))?.text,
    access: access ?? (["codeunit", "table", "page", "report", "query", "xmlport", "enum", "interface", "permissionset"].includes(object.type) ? "public" : undefined),
    extensible: bool(properties.get("extensible")),
    obsolete: obsoleteOf(properties),
    dataClassification: word(properties.get("dataclassification")),
    tableType: word(properties.get("tabletype")),
    pageType: word(properties.get("pagetype")),
    queryType: word(properties.get("querytype")),
    subtype: word(properties.get("subtype")),
    sourceTable: word(properties.get("sourcetable")),
    sourceTableTemporary: bool(properties.get("sourcetabletemporary")),
    tableNo: word(properties.get("tableno")),
    singleInstance: bool(properties.get("singleinstance")),
    eventSubscriberInstance: word(properties.get("eventsubscriberinstance")),
    usageCategory: word(properties.get("usagecategory")),
    applicationArea: word(properties.get("applicationarea"))?.split(/\s*,\s*/u),
    apiPublisher: alText(properties.get("apipublisher"))?.text,
    apiGroup: alText(properties.get("apigroup"))?.text,
    apiVersion: alText(properties.get("apiversion"))?.text,
    entityName: alText(properties.get("entityname"))?.text,
    inherentPermissions: properties.get("inherentpermissions")?.trim(),
    permissions: properties.get("permissions")?.replace(/\s+/gu, " ").trim(),
    size: compact({
      lines: lineCount(object.location),
      fields: object.fields?.filter(({ kind }) => kind !== "page-field").length || undefined,
      pageFields: object.fields?.filter(({ kind }) => kind === "page-field").length || undefined,
      keys: object.keys?.length || undefined,
      procedures: count("procedure") || undefined,
      publicProcedures: procedures.filter(({ kind, visibility }) => kind === "procedure" && (visibility ?? "public") === "public").length || undefined,
      triggers: count("trigger") || undefined,
      events: count("event") || undefined,
      actions: object.actions?.filter(({ kind }) => kind !== "actionref").length || undefined,
      parts: object.parts?.length || undefined,
      elements: object.elements?.length || undefined,
      globals: object.variables?.filter(({ global }) => global).length || undefined
    }),
    complexity: complexities.length ? compact({
      total: complexities.reduce((sum, value) => sum + value, 0),
      max: Math.max(...complexities),
      average: Number((complexities.reduce((sum, value) => sum + value, 0) / complexities.length).toFixed(1)),
      mostComplex: code.reduce((best, procedure) => (complexityOf(procedure) ?? 0) > (best ? complexityOf(best) ?? 0 : -1) ? procedure : best, undefined)?.name
    }) : undefined
  });
}
