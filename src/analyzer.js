import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import { loadSymbolPackages } from "./symbols.js";

const GRAMMAR_PATH = fileURLToPath(
  new URL("../vendor/tree-sitter-al.wasm", import.meta.url)
);
let languagePromise;

async function getLanguage() {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init();
      return Language.load(GRAMMAR_PATH);
    })();
  }
  return languagePromise;
}

const OBJECT_TYPES = new Map([
  ["table_declaration", "table"],
  ["tableextension_declaration", "tableextension"],
  ["page_declaration", "page"],
  ["pageextension_declaration", "pageextension"],
  ["pagecustomization_declaration", "pagecustomization"],
  ["codeunit_declaration", "codeunit"],
  ["report_declaration", "report"],
  ["reportextension_declaration", "reportextension"],
  ["query_declaration", "query"],
  ["xmlport_declaration", "xmlport"],
  ["enum_declaration", "enum"],
  ["enumextension_declaration", "enumextension"],
  ["interface_declaration", "interface"],
  ["controladdin_declaration", "controladdin"],
  ["profile_declaration", "profile"],
  ["profileextension_declaration", "profileextension"],
  ["permissionset_declaration", "permissionset"],
  ["permissionsetextension_declaration", "permissionsetextension"],
  ["entitlement_declaration", "entitlement"]
]);

const EXTENSION_TARGET = {
  tableextension: "table",
  pageextension: "page",
  reportextension: "report",
  enumextension: "enum",
  profileextension: "profile",
  permissionsetextension: "permissionset",
  pagecustomization: "page"
};

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".alpackages",
  ".snapshots",
  "node_modules",
  "dist",
  "out"
]);

function cleanName(value) {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replaceAll('""', '"')
    : text;
}

function fieldText(node, field, source) {
  const child = node.childForFieldName(field);
  return child ? cleanName(source.slice(child.startIndex, child.endIndex)) : undefined;
}

function locationFor(node, file) {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1
  };
}

function walk(node, visit) {
  visit(node);
  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

function containsNode(parent, child) {
  return child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex;
}

function tableRelationCondition(node, source) {
  const branches = [];
  let current = node.parent;
  while (current) {
    if (current.type === "if_table_relation") {
      const conditionNode = current.namedChildren.find((child) => child.type === "where_conditions");
      const thenNode = current.childForFieldName("then_relation");
      if (conditionNode) {
        branches.unshift({
          expression: source.slice(conditionNode.startIndex, conditionNode.endIndex).trim(),
          matches: Boolean(thenNode && containsNode(thenNode, node))
        });
      }
    }
    if (current.type === "property") break;
    current = current.parent;
  }
  return branches.length
    ? branches
      .map(({ expression, matches }) => matches ? expression : `not (${expression})`)
      .join(" and ")
    : undefined;
}

function tableRelationFilters(node, source) {
  const whereClause = node.namedChildren.find((child) => child.type === "where_clause");
  if (!whereClause) return undefined;
  const filters = [];
  walk(whereClause, (child) => {
    if (child.type !== "where_condition") return;
    filters.push({
      field: fieldText(child, "field", source),
      value: fieldText(child, "value", source),
      expression: source.slice(child.startIndex, child.endIndex).trim()
    });
  });
  return filters;
}

function tableRelationRelations(valueNode, source, add) {
  walk(valueNode, (node) => {
    if (node.type !== "simple_table_relation") return;
    const references = typeof node.childrenForFieldName === "function"
      ? node.childrenForFieldName("table")
      : [node.childForFieldName("table")].filter(Boolean);
    const parts = references
      .map((reference) => cleanName(
        source.slice(reference.startIndex, reference.endIndex)
      ).replace(/^\.+|\.+$/gu, ""))
      .filter(Boolean);
    if (!parts.length) return;
    add(node, {
      target: parts.length > 1 ? parts.slice(0, -1).join(".") : parts[0],
      targetType: "table",
      kind: "relates",
      relatedField: parts.length > 1 ? parts.at(-1) : undefined,
      condition: tableRelationCondition(node, source),
      filters: tableRelationFilters(node, source)
    });
  });
}

function permissionRelations(value, node, add) {
  const pattern =
    /\btabledata\s+(?:"((?:""|[^"])*)"|([A-Za-z_][\w]*))\s*=\s*([RIMDX]+)/giu;
  for (const match of value.matchAll(pattern)) {
    add(node, {
      target: (match[1] ?? match[2]).replaceAll('""', '"'),
      targetType: "table",
      kind: "permits",
      access: match[3].toUpperCase()
    });
  }
}

function enclosingMember(node, source, types) {
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) {
      return fieldText(
        current,
        current.type === "enum_value_declaration" ? "value_name" : "name",
        source
      );
    }
    current = current.parent;
  }
  return undefined;
}

function implementationRelations(value, node, source, add) {
  const identifier = String.raw`(?:"((?:""|[^"])*)"|([A-Za-z_][\w.]*))`;
  const pattern = new RegExp(`${identifier}\\s*=\\s*${identifier}`, "gu");
  const member = enclosingMember(node, source, ["enum_value_declaration"]);
  for (const match of value.matchAll(pattern)) {
    const contract = (match[1] ?? match[2]).replaceAll('""', '"');
    const target = (match[3] ?? match[4]).replaceAll('""', '"');
    add(node, {
      target,
      targetType: "codeunit",
      kind: "selects",
      contract,
      member
    });
  }
}

function preprocessorConditions(node, source) {
  const conditions = [];
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (parent.type.startsWith("preproc_")) {
      const markers = parent.namedChildren.filter(
        (child) => ["preproc_if", "preproc_elif", "preproc_else"].includes(child.type) &&
          child.startIndex <= node.startIndex
      );
      const marker = markers.at(-1);
      const conditionNode = marker?.childForFieldName("condition");
      if (conditionNode) {
        conditions.unshift(source.slice(conditionNode.startIndex, conditionNode.endIndex).trim());
      } else if (marker?.type === "preproc_else") {
        conditions.unshift("else");
      }
    }
    current = parent;
  }
  return conditions.length ? conditions : undefined;
}

function permissionRelation(node, source, add) {
  const target = fieldText(node, "table_name", source);
  const permission = fieldText(node, "permission", source);
  const type = source.slice(node.startIndex, node.endIndex).trim().match(/^([A-Za-z]+)\b/u)?.[1];
  if (!target || !permission || !type) return;
  add(node, {
    target,
    targetType: type.toLowerCase() === "tabledata" ? "table" : type.toLowerCase(),
    kind: "permits",
    access: permission.toUpperCase()
  });
}

function memberExpressionParts(node, source) {
  if (node.type !== "member_expression") {
    return [cleanName(source.slice(node.startIndex, node.endIndex))];
  }
  const object = node.childForFieldName("object");
  const member = node.childForFieldName("member");
  return [
    ...(object ? memberExpressionParts(object, source) : []),
    ...(member ? [cleanName(source.slice(member.startIndex, member.endIndex))] : [])
  ];
}

function calcFormulaRelation(valueNode, source, add) {
  let targetNode;
  walk(valueNode, (node) => {
    if (targetNode) return;
    if (node.type === "calc_field_reference") targetNode = node;
    if (node.type === "member_expression" && node.parent?.type !== "member_expression") {
      targetNode = node;
    }
  });
  if (!targetNode) return;
  const parts = targetNode.type === "member_expression"
    ? memberExpressionParts(targetNode, source)
    : source.slice(targetNode.startIndex, targetNode.endIndex)
      .split(".")
      .map(cleanName)
      .filter(Boolean);
  if (parts.length < 2) return;
  add(targetNode, {
    target: parts.slice(0, -1).join("."),
    targetType: "table",
    kind: "reads",
    property: "calcformula",
    relatedField: parts.at(-1)
  });
}

function referencesFor(objectNode, source, file) {
  const references = [];
  const add = (node, relation) => {
    references.push({
      ...relation,
      conditionalSymbols: preprocessorConditions(node, source),
      location: locationFor(node, file)
    });
  };
  walk(objectNode, (node) => {
    if (node === objectNode) return;

    if (node.type === "tabledata_permission") {
      permissionRelation(node, source, add);
      return;
    }

    if (["report_dataitem", "query_dataitem"].includes(node.type)) {
      const target = fieldText(node, "table_name", source);
      if (target) add(node, { target, targetType: "table", kind: "reads", property: "dataitem" });
      return;
    }

    if (node.type === "xmlport_element") {
      const elementType = source.slice(node.startIndex, node.endIndex)
        .trim()
        .match(/^([A-Za-z]+)/u)?.[1]
        ?.toLowerCase();
      const target = fieldText(node, "source", source);
      if (elementType === "tableelement" && target) {
        add(node, { target, targetType: "table", kind: "reads", property: "tableelement" });
      }
      return;
    }

    if (node.type === "part_section") {
      const target = fieldText(node, "source", source);
      if (target) {
        add(node, {
          target,
          targetType: "page",
          kind: "part",
          member: fieldText(node, "name", source)
        });
      }
      return;
    }

    if (node.type === "implements_clause") {
      const interfaces = typeof node.childrenForFieldName === "function"
        ? node.childrenForFieldName("interface")
        : [node.childForFieldName("interface")].filter(Boolean);
      for (const interfaceNode of interfaces) {
        const target = cleanName(source.slice(interfaceNode.startIndex, interfaceNode.endIndex));
        if (target) add(interfaceNode, { target, targetType: "interface", kind: "implements" });
      }
      return;
    }

    if (node.type === "record_type") {
      const target = fieldText(node, "reference", source);
      if (target) add(node, { target, targetType: "table", kind: "uses" });
      return;
    }

    if (node.type === "object_reference_type") {
      const target = fieldText(node, "reference", source);
      const text = source.slice(node.startIndex, node.endIndex).trim();
      const type = text.split(/\s+/u)[0]?.toLowerCase();
      if (target) add(node, { target, targetType: type, kind: "uses" });
      return;
    }

    if (node.type === "database_reference") {
      const target = fieldText(node, "table_name", source);
      const keyword = fieldText(node, "keyword", source)?.toLowerCase();
      if (target && keyword === "database") {
        add(node, { target, targetType: "table", kind: "uses", property: "database" });
      }
      return;
    }

    if (node.type === "property") {
      const name = fieldText(node, "name", source)?.toLowerCase();
      const valueNode = node.childForFieldName("value");
      if (!name || !valueNode) return;
      const value = source.slice(valueNode.startIndex, valueNode.endIndex).trim();
      const quoted = value.match(/^"((?:""|[^"])*)"/u);
      const plain = value.match(/^([A-Za-z_][\w.]*)|^(\d+)/u);
      const target = quoted?.[1]?.replaceAll('""', '"') ?? plain?.[1] ?? plain?.[2];
      if (["sourcetable", "dataitemtable"].includes(name) && target) {
        add(node, {
          target,
          targetType: "table",
          kind: "reads",
          property: name
        });
      }
      if (name === "tablerelation") {
        tableRelationRelations(valueNode, source, add);
      }
      if (name === "calcformula") {
        calcFormulaRelation(valueNode, source, add);
      }
      if (name === "permissions") {
        if (!valueNode.namedChildren.some((child) => child.type === "tabledata_permission")) {
          permissionRelations(value, node, add);
        }
      }
      if (name === "includedpermissionsets" && target) {
        add(node, { target, targetType: "permissionset", kind: "includes" });
      }
      if (name === "implementation") {
        implementationRelations(value, node, source, add);
      }
      if (name === "runobject") {
        const match = value.match(
          /^(codeunit|page|report|query|xmlport|table)\s+(.+)$/iu
        );
        if (match) {
          add(node, {
            target: cleanName(match[2]),
            targetType: match[1].toLowerCase(),
            kind: "runs",
            member: enclosingMember(node, source, [
              "action_declaration",
              "customaction_declaration",
              "systemaction_declaration"
            ])
          });
        }
      }
    }
  });
  return references;
}

function callsFor(node, source, file) {
  const calls = [];
  const describe = (callNode) => {
    const functionNode = callNode.childForFieldName("function");
    if (!functionNode) return undefined;
    const memberNode = functionNode.type === "member_expression"
      ? functionNode.childForFieldName("member")
      : undefined;
    const receiverNode = functionNode.type === "member_expression"
      ? functionNode.childForFieldName("object")
      : undefined;
    const argumentsNode = callNode.childForFieldName("arguments");
    return {
      name: cleanName(source.slice(
        (memberNode ?? functionNode).startIndex,
        (memberNode ?? functionNode).endIndex
      )),
      receiver: receiverNode
        ? cleanName(source.slice(receiverNode.startIndex, receiverNode.endIndex))
        : undefined,
      receiverCall: receiverNode?.type === "call_expression" ? describe(receiverNode) : undefined,
      arity: argumentsNode?.namedChildCount ?? 0,
      scope: node.startPosition.row + 1,
      location: locationFor(callNode, file)
    };
  };
  walk(node, (child) => {
    if (child.type !== "call_expression") return;
    const call = describe(child);
    if (call) calls.push(call);
  });
  return calls;
}

function attributesFor(node, source) {
  const prefix = source.slice(Math.max(0, node.startIndex - 4000), node.startIndex);
  const block = prefix.match(/(?:\[[^\]\r\n]+\]\s*)+$/u)?.[0] ?? "";
  return [...block.matchAll(/\[[^\]\r\n]+\]/gu)].map(([attribute]) => attribute);
}

function enclosingActionName(node, source) {
  const actionTypes = new Set([
    "action_declaration",
    "customaction_declaration",
    "systemaction_declaration"
  ]);
  let parent = node.parent;
  while (parent) {
    if (actionTypes.has(parent.type)) return fieldText(parent, "name", source);
    parent = parent.parent;
  }
  return undefined;
}

function enclosingRoutine(node) {
  const routineTypes = new Set([
    "procedure",
    "trigger_declaration",
    "event_declaration",
    "interface_procedure"
  ]);
  let parent = node.parent;
  while (parent) {
    if (routineTypes.has(parent.type)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function declaredType(type) {
  const match = type?.match(
    /^(record|codeunit|page|report|query|xmlport|interface|enum)\s+(.+?)(?:\s+(temporary))?$/iu
  );
  return {
    type,
    targetType: match?.[1]?.toLowerCase(),
    target: match ? cleanName(match[2]) : undefined,
    temporary: Boolean(match?.[3])
  };
}

function variableType(node, source) {
  const typeNode = node.childForFieldName("type");
  const type = typeNode
    ? source.slice(typeNode.startIndex, typeNode.endIndex).trim()
    : undefined;
  return declaredType(type);
}

function membersFor(objectNode, source, file) {
  const procedures = [];
  const fields = [];
  const actions = [];
  const views = [];
  const variables = [];
  walk(objectNode, (node) => {
    if (["procedure", "trigger_declaration", "event_declaration", "interface_procedure"].includes(node.type)) {
      const name = fieldText(node, "name", source);
      if (name) {
        const returnTypeNode = node.childForFieldName("return_type");
        const returnType = returnTypeNode
          ? declaredType(source.slice(returnTypeNode.startIndex, returnTypeNode.endIndex).trim())
          : {};
        const attributes = [
          ...node.namedChildren
          .filter((child) => child.type === "attribute_item")
          .map((child) => source.slice(child.startIndex, child.endIndex)),
          ...attributesFor(node, source)
        ];
        procedures.push({
          name,
          scope: node.startPosition.row + 1,
          kind: node.type === "trigger_declaration"
            ? "trigger"
            : node.type === "event_declaration"
              ? "event"
              : attributes.some((attribute) => /\[(?:Integration|Business)Event\b/iu.test(attribute))
                ? "event"
              : "procedure",
          location: locationFor(node, file),
          calls: callsFor(node, source, file),
          attributes,
          returnType: returnType.type,
          returnTargetType: returnType.targetType,
          returnTarget: returnType.target,
          action: node.type === "trigger_declaration"
            ? enclosingActionName(node, source)
            : undefined
        });
      }
    }
    if (node.type === "field_declaration" || node.type === "page_field") {
      const name = fieldText(node, "name", source);
      fields.push({
        name: name ?? `(field ${fields.length + 1})`,
        kind: node.type === "page_field" ? "page-field" : "field",
        location: locationFor(node, file)
      });
    }
    if (["action_declaration", "customaction_declaration", "systemaction_declaration"].includes(node.type)) {
      const name = fieldText(node, "name", source);
      actions.push({
        name: name ?? `(action ${actions.length + 1})`,
        location: locationFor(node, file),
        calls: callsFor(node, source, file)
      });
    }
    if (node.type === "actionref_declaration") {
      const name = fieldText(node, "promoted_name", source);
      actions.push({
        name: name ?? `(action ${actions.length + 1})`,
        kind: "action-ref",
        target: fieldText(node, "action_name", source),
        location: locationFor(node, file),
        calls: []
      });
    }
    if (node.type === "view_definition") {
      views.push({
        name: fieldText(node, "name", source) ?? `(view ${views.length + 1})`,
        location: locationFor(node, file)
      });
    }
    if (node.type === "variable_declaration") {
      const names = typeof node.childrenForFieldName === "function"
        ? node.childrenForFieldName("name")
        : [node.childForFieldName("name")].filter(Boolean);
      const routine = enclosingRoutine(node);
      const type = variableType(node, source);
      for (const nameNode of names) {
        variables.push({
          name: cleanName(source.slice(nameNode.startIndex, nameNode.endIndex)),
          ...type,
          scope: routine ? routine.startPosition.row + 1 : undefined,
          location: locationFor(node, file)
        });
      }
    }
    if (node.type === "parameter") {
      const routine = enclosingRoutine(node);
      const name = fieldText(node, "name", source);
      if (routine && name) {
        variables.push({
          name,
          ...variableType(node, source),
          parameter: true,
          scope: routine.startPosition.row + 1,
          location: locationFor(node, file)
        });
      }
    }
  });
  for (const procedure of procedures) {
    procedure.parameters = variables.filter(
      ({ parameter, scope }) => parameter && scope === procedure.scope
    );
    procedure.arity = procedure.parameters.length;
    procedure.signature = `${procedure.name}(${procedure.parameters.map(({ type }) => type).join(", ")})`;
  }
  return { procedures, fields, actions, views, variables };
}

function dataOperationRelations(members, object) {
  const reads = /^(get|find|findfirst|findlast|findset|isempty|count|calcfields|calcsums|next)$/iu;
  const writes = /^(insert|modify|modifyall|delete|deleteall|rename)$/iu;
  const relations = [];
  const sourceTable = object.type === "table"
    ? object.name
    : object.type === "tableextension"
      ? object.base
      : object.relations.find(
        ({ kind, property }) => kind === "reads" && property === "sourcetable"
      )?.target;

  for (const procedure of members.procedures) {
    const variables = new Map(
      members.variables
        .filter(({ targetType, target, scope }) =>
          targetType === "record" && target && (scope === undefined || scope === procedure.scope)
        )
        .map((variable) => [variable.name.toLowerCase(), variable])
    );
    if (sourceTable) {
      variables.set("rec", { target: sourceTable, temporary: false });
      variables.set("xrec", { target: sourceTable, temporary: false });
    }
    for (const call of procedure.calls) {
      if (!call.receiver) continue;
      const variable = variables.get(call.receiver.toLowerCase());
      if (!variable) continue;
      const kind = reads.test(call.name) ? "reads" : writes.test(call.name) ? "writes" : undefined;
      if (!kind) continue;
      relations.push({
        target: variable.target,
        targetType: "table",
        kind,
        operation: call.name,
        temporary: variable.temporary,
        member: procedure.signature,
        location: call.location
      });
    }
  }
  return relations;
}

function helperDataOperationRelations(members, directRelations) {
  const procedures = new Map();
  for (const procedure of members.procedures) {
    const key = `${procedure.name.toLowerCase()}:${procedure.arity}`;
    const candidates = procedures.get(key) ?? [];
    candidates.push(procedure);
    procedures.set(key, candidates);
  }
  const effects = new Map();
  for (const relation of directRelations) {
    const current = effects.get(relation.member) ?? [];
    current.push(relation);
    effects.set(relation.member, current);
  }
  const propagated = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const caller of members.procedures) {
      const callerEffects = effects.get(caller.signature) ?? [];
      for (const call of caller.calls.filter(({ receiver }) => !receiver)) {
        const callees = procedures.get(`${call.name.toLowerCase()}:${call.arity}`) ?? [];
        if (callees.length !== 1) continue;
        for (const effect of effects.get(callees[0].signature) ?? []) {
          const via = [callees[0].signature, ...(effect.via ?? [])];
          if (via.includes(caller.signature)) continue;
          const key = `${effect.target}:${effect.kind}:${effect.operation}:${via.join(">")}`;
          if (callerEffects.some((item) => item.effectKey === key)) continue;
          const relation = {
            ...effect,
            member: caller.signature,
            via,
            effectKey: key,
            location: call.location
          };
          callerEffects.push(relation);
          propagated.push(relation);
          changed = true;
        }
      }
      effects.set(caller.signature, callerEffects);
    }
  }
  return propagated.map(({ effectKey: _effectKey, ...relation }) => relation);
}

async function objectsFromSource(source, file) {
  const language = await getLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const namespaceNode = tree.rootNode.namedChildren.find(
    (node) => node.type === "namespace_declaration"
  );
  const namespace = namespaceNode
    ? fieldText(namespaceNode, "name", source) ?? "(global)"
    : "(global)";
  const usings = tree.rootNode.namedChildren
    .filter((node) => node.type === "using_statement")
    .map((node) => fieldText(node, "namespace", source))
    .filter(Boolean);
  const objects = [];

  walk(tree.rootNode, (node) => {
    const type = OBJECT_TYPES.get(node.type);
    if (!type) return;

    const name = fieldText(node, "object_name", source);
    if (!name) return;

    const id = fieldText(node, "object_id", source);
    let base = fieldText(node, "base_object", source);
    if (type === "pagecustomization") base = fieldText(node, "target_page", source);
    if (type === "interface") base = fieldText(node, "extends_interface", source);

    const relations = referencesFor(node, source, file);
    if (base) {
      relations.push({
        target: base,
        targetType: type === "interface" ? "interface" : EXTENSION_TARGET[type],
        kind: "extends",
        location: locationFor(node, file)
      });
    }
    const members = membersFor(node, source, file);
    const dataRelations = dataOperationRelations(members, { type, name, base, relations });
    relations.push(...dataRelations, ...helperDataOperationRelations(members, dataRelations));

    objects.push({
      id,
      name,
      type,
      namespace,
      usings,
      file,
      relations,
      procedures: members.procedures,
      fields: members.fields,
      actions: members.actions,
      views: members.views,
      variables: members.variables,
      location: locationFor(node, file),
      parseError: node.hasError
    });
  });

  const result = { objects, hasError: tree.rootNode.hasError };
  tree.delete();
  parser.delete();
  return result;
}

async function collectAlFiles(input) {
  const absolute = path.resolve(input);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) {
    if (path.extname(absolute).toLowerCase() !== ".al") {
      throw new Error(`Input file is not an AL source file: ${absolute}`);
    }
    return [absolute];
  }

  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".al") {
        files.push(entryPath);
      }
    }
  }
  await visit(absolute);
  return files.sort();
}

async function readAppManifest(file, root, cache) {
  let directory = path.dirname(file);
  const boundary = (await fs.stat(root)).isDirectory() ? root : path.dirname(root);
  while (true) {
    const candidate = path.join(directory, "app.json");
    if (cache.has(candidate)) return cache.get(candidate);
    try {
      const data = JSON.parse(await fs.readFile(candidate, "utf8"));
      const app = {
        id: data.id,
        name: data.name,
        publisher: data.publisher,
        version: data.version,
        path: path.relative(boundary, candidate) || "app.json",
        root: path.dirname(candidate),
        dependencies: data.dependencies ?? []
      };
      cache.set(candidate, app);
      return app;
    } catch (error) {
      if (error.code !== "ENOENT") {
        cache.set(candidate, undefined);
        return undefined;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

export async function analyze(input) {
  const root = path.resolve(input);
  const rootStat = await fs.stat(root);
  const base = rootStat.isDirectory() ? root : path.dirname(root);
  const files = await collectAlFiles(root);
  const objects = [];
  const parseErrors = [];
  const diagnostics = [];
  const manifestCache = new Map();
  const apps = new Map();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const relativeFile = path.relative(
      base,
      file
    );
    const result = await objectsFromSource(source, relativeFile || path.basename(file));
    objects.push(...result.objects);
    const app = await readAppManifest(file, root, manifestCache);
    if (app) {
      apps.set(app.id ?? app.name, app);
      for (const object of result.objects) object.app = app;
    }
    if (result.hasError) {
      const reportedFile = relativeFile || path.basename(file);
      parseErrors.push(reportedFile);
      diagnostics.push({
        severity: "error",
        code: "parse-error",
        message: "tree-sitter reported one or more syntax errors",
        file: reportedFile
      });
    }
  }

  const symbols = await loadSymbolPackages(base);
  objects.push(...symbols.objects);
  diagnostics.push(...symbols.diagnostics);
  for (const app of symbols.packages) apps.set(app.id ?? app.name, app);

  return {
    schemaVersion: 1,
    root,
    files: files.length,
    apps: [...apps.values()],
    symbolPackages: symbols.packages,
    objects,
    parseErrors,
    diagnostics
  };
}

export const testing = { objectsFromSource };
