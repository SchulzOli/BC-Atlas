import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import { isCommitCall, operationKind } from "./operation-semantics.js";
import { includedPermissionSets, permissionGrant } from "./permission-semantics.js";
import { loadProjectSymbols } from "./symbols.js";
import { cyclomaticComplexity, documentationComment, fieldMetadata, objectMetadata, procedureMetadata } from "./metadata.js";

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

/**
 * Declarations whose header is split by preprocessor directives, while the
 * body is shared:
 *
 *   #if CLEAN25
 *   table 50100 "New Name"
 *   #else
 *   table 50100 "Old Name"
 *   #endif
 *   { ... }
 *
 * The grammar gives them a node type of their own, with the header of every
 * branch as direct children. They are modeled as the declaration they are,
 * once, with the header of the first branch (`#if`): its ID, name, type,
 * modifier, parameters, and attributes. `conditionalSymbols` names the
 * condition of that branch. What the other branches refer to (an `implements`
 * list, another base object) still becomes a relation with the condition of
 * its branch, as for any other code inside `#if`.
 */
const SPLIT_OBJECT = "preproc_split_declaration";
const SPLIT_MEMBERS = new Map([
  ["preproc_split_table_field", "field_declaration"],
  ["preproc_split_field", "page_field"],
  ["preproc_split_procedure", "procedure"],
  ["preproc_split_procedure_preamble", "procedure"]
]);
const OBJECT_KEYWORDS = new Map(
  [...OBJECT_TYPES.values()].map((type) => [`${type}_keyword`, type])
);

/** The plain node type a member node stands for (a split table field is a field_declaration). */
function memberType(node) {
  return SPLIT_MEMBERS.get(node.type) ?? node.type;
}

/**
 * The header of a declaration: its named children and its fields. For a split
 * header these are the children of the first branch and what follows `#endif`;
 * the other branches are left out, so a field missing in the first branch (no
 * `local`, no return type) is not read from another one.
 */
function headerOf(node) {
  if (node.type !== SPLIT_OBJECT && !SPLIT_MEMBERS.has(node.type)) {
    return {
      split: false,
      start: node.startIndex,
      children: node.namedChildren,
      field: (name) => node.childForFieldName(name) ?? undefined,
      includes: () => true
    };
  }
  const children = [];
  const fields = new Map();
  // The first branch lies between `#if` and the directive after it; the other
  // branches end with `#endif`.
  const branch = {};
  const others = {};
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (child.type === "preproc_if") branch.start ??= child.endIndex;
    else if (child.type === "preproc_elif" || child.type === "preproc_else") {
      branch.end ??= child.startIndex;
      others.start ??= child.startIndex;
    } else if (child.type === "preproc_endif") {
      branch.end ??= child.startIndex;
      others.end ??= child.startIndex;
    } else if (child.isNamed && !(child.startIndex >= others.start && others.end === undefined)) {
      children.push(child);
      const field = node.fieldNameForChild(index);
      if (field && !fields.has(field)) fields.set(field, child);
    }
  }
  branch.start ??= node.startIndex;
  branch.end ??= node.endIndex;
  branch.children = children.filter((child) => child.endIndex <= branch.end);
  return {
    split: true,
    // Where the header starts: after `#if` and the comments above the declaration.
    start: branch.children.find((child) => child.type !== "comment")?.startIndex ?? branch.start,
    children,
    branch,
    field: (name) => fields.get(name),
    includes: (descendant) =>
      !(descendant.startIndex >= others.start && descendant.endIndex <= (others.end ?? node.endIndex))
  };
}

/** The type of the object a node declares, if it declares one. */
function objectType(node) {
  if (node.type !== SPLIT_OBJECT) return OBJECT_TYPES.get(node.type);
  return headerOf(node).children.map((child) => OBJECT_KEYWORDS.get(child.type)).find(Boolean);
}

/** The condition of the branch a split header is read from, with those of the `#if`s around it. */
function splitConditions(header, source) {
  return header.split && header.branch.children.length
    ? { conditionalSymbols: preprocessorConditions(header.branch.children[0], source) }
    : {};
}

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

/**
 * The referenced object of a Record, Codeunit, Page, ... type. Namespace-
 * qualified names (Microsoft.Sales.Document."Sales Header") are kept whole so
 * the resolver can match them against namespace and name; the grammar's
 * reference field holds only their first segment.
 */
function typeReference(node, source) {
  return objectNameField(node, "reference", source);
}

const QUALIFIED_NAME = /^[A-Za-z_]\w*(?:\s*\.\s*(?:"(?:""|[^"])*"|[A-Za-z_]\w*))+/u;

/**
 * Like fieldText, but keeps a namespace-qualified object name whole
 * (Microsoft.Sales.Document."Sales Header"); the grammar's name fields hold
 * only its first segment.
 */
function objectNameField(node, field, source) {
  const child = node.childForFieldName(field);
  if (!child) return undefined;
  // Some nodes (Database::) end after the first segment, so read past them.
  const qualified = source.slice(child.startIndex, child.startIndex + 400).match(QUALIFIED_NAME)?.[0];
  return qualified ? qualified.replace(/\s*\.\s*/gu, ".") : fieldText(node, field, source);
}

function nodeText(node, source) {
  return node ? cleanName(source.slice(node.startIndex, node.endIndex)) : undefined;
}

function fieldText(node, field, source) {
  return nodeText(node.childForFieldName(field), source);
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
      property: "tablerelation",
      relationClass: "schema",
      sourceField: enclosingMember(node, source, ["field_declaration", "preproc_split_table_field"]),
      relatedField: parts.length > 1 ? parts.at(-1) : undefined,
      condition: tableRelationCondition(node, source),
      filters: tableRelationFilters(node, source)
    });
  });
}

function permissionRelations(value, node, add) {
  const pattern =
    /\btabledata\s+(?:"((?:""|[^"])*)"|([A-Za-z_][\w]*)|(\*))\s*=\s*([RIMDX]+)/giu;
  for (const match of value.matchAll(pattern)) {
    add(node, {
      target: (match[1] ?? match[2] ?? match[3]).replaceAll('""', '"'),
      kind: "permits",
      ...(match[3] ? { wildcard: true } : {}),
      ...permissionGrant("tabledata", match[4])
    });
  }
}

function includedPermissionSetRelations(value, node, add) {
  for (const relation of includedPermissionSets(value)) add(node, relation);
}

/**
 * Nodes that only wrap what a declaration holds: its braces (declaration_body,
 * layout_container_body, report_body, ...) and `#if` blocks around some of its
 * lines. Everything else that holds properties owns them itself.
 */
function wrapsOwnerContent(node) {
  return node.type.endsWith("_body") || node.type.startsWith("preproc_conditional");
}

/**
 * The properties of this declaration itself, in source order. The properties
 * of what it contains stay with their owner, whether the analyzer models that
 * owner (a field, an action, a data item) or not (a group, a repeater, a grid,
 * a request page, a rendering layout, a field group, a modify), so the Caption
 * of a group never reads as the caption of its page.
 */
function propertiesFor(ownerNode, source) {
  const properties = [];
  const collect = (node) => {
    for (const child of node.namedChildren) {
      if (child.type === "property") {
        const valueNode = child.childForFieldName("value");
        properties.push({
          name: fieldText(child, "name", source),
          value: valueNode
            ? source.slice(valueNode.startIndex, valueNode.endIndex).trim()
            : undefined
        });
      } else if (wrapsOwnerContent(child)) collect(child);
    }
  };
  collect(ownerNode);
  return properties;
}

/** The value of one of a declaration's own properties (the last one wins, as in AL). */
function propertyValue(properties, wantedName) {
  const value = properties.findLast(({ name }) => name?.toLowerCase() === wantedName)?.value;
  return value === undefined ? undefined : cleanName(value);
}

function containerFor(node, source) {
  let current = node.parent;
  while (current) {
    if (["area_section", "group_section", "action_area_section", "action_group_section"].includes(current.type)) {
      const header = source.slice(current.startIndex, current.namedChildren.at(-1)?.startIndex ?? current.endIndex);
      return cleanName(header.match(/\(([^)]*)\)/u)?.[1] ?? "") || undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function procedureHeader(node, source, header) {
  let start = node.startIndex;
  let end;
  if (header.split) {
    // The header as written in the first branch, without its attributes and variables.
    const { children } = header.branch;
    start = children.find((child) => !["comment", "attribute_item"].includes(child.type))?.startIndex ?? header.start;
    end = children.find((child) => child.type === "var_section")?.startIndex ?? header.branch.end;
  } else {
    const body = node.namedChildren.find((child) =>
      ["code_block", "statement_block", "declaration_body"].includes(child.type)
    );
    end = body?.startIndex ?? node.endIndex;
  }
  return source.slice(start, end).trim().replace(/\s+/gu, " ").replace(/;$/u, "");
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

function implementationRelations(property, value, node, source, add) {
  const bindingKind = {
    implementation: "explicit",
    defaultimplementation: "default",
    unknownvalueimplementation: "unknownValue"
  }[property];
  if (!bindingKind) return;
  const identifier = String.raw`(?:"((?:""|[^"])*)"|([A-Za-z_][\w.]*))`;
  const pattern = new RegExp(`${identifier}\\s*=\\s*${identifier}`, "gu");
  const member = bindingKind === "explicit"
    ? enclosingMember(node, source, ["enum_value_declaration"])
    : undefined;
  for (const match of value.matchAll(pattern)) {
    const contract = (match[1] ?? match[2]).replaceAll('""', '"');
    const target = (match[3] ?? match[4]).replaceAll('""', '"');
    add(node, {
      target,
      targetType: "codeunit",
      kind: "selects",
      bindingKind,
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
      // What follows `#endif` (the shared body of a split header) is unconditional.
      const markers = parent.namedChildren.filter(
        (child) => ["preproc_if", "preproc_elif", "preproc_else", "preproc_endif"].includes(child.type) &&
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
  const target = objectNameField(node, "table_name", source);
  const permission = fieldText(node, "permission", source);
  const type = source.slice(node.startIndex, node.endIndex).trim().match(/^([A-Za-z]+)\b/u)?.[1];
  if (!target || !permission || !type) return;
  add(node, {
    target,
    kind: "permits",
    // `tabledata * = R`: every object of the type. A quoted "*" is a name.
    ...(node.childForFieldName("table_name")?.type === "*" ? { wildcard: true } : {}),
    ...permissionGrant(type, permission)
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
    relationClass: "schema",
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
      const target = objectNameField(node, "table_name", source);
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
      const target = typeReference(node, source);
      if (target) add(node, { target, targetType: "table", kind: "uses" });
      return;
    }

    if (node.type === "object_reference_type") {
      const target = typeReference(node, source);
      const text = source.slice(node.startIndex, node.endIndex).trim();
      const type = text.split(/\s+/u)[0]?.toLowerCase();
      if (target) add(node, { target, targetType: type, kind: "uses" });
      return;
    }

    if (node.type === "database_reference") {
      const target = objectNameField(node, "table_name", source);
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
      if (name === "includedpermissionsets") {
        includedPermissionSetRelations(value, node, add);
      }
      if (["implementation", "defaultimplementation", "unknownvalueimplementation"].includes(name)) {
        implementationRelations(name, value, node, source, add);
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
    const argumentsList = argumentsNode?.namedChildren.map((argument) =>
      source.slice(argument.startIndex, argument.endIndex).trim()
    ) ?? [];
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
      ...(argumentsList.length ? { arguments: argumentsList } : {}),
      scope: node.startPosition.row + 1,
      location: locationFor(callNode, file)
    };
  };
  walk(node, (child) => {
    if (child.type !== "call_expression") return;
    const call = describe(child);
    if (call) calls.push({ ...call, order: calls.length + 1 });
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
    if (routineTypes.has(memberType(parent))) return parent;
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

function fallbackStatements(node, source, file, conditional = false) {
  if (!node) return [];
  if (node.type === "statement_block") {
    return node.namedChildren.flatMap((child) =>
      fallbackStatements(child, source, file, conditional)
    );
  }
  if (node.type === "if_statement") {
    return [{
      kind: "conditional",
      then: fallbackStatements(node.childForFieldName("then_branch"), source, file, true),
      else: node.childForFieldName("else_branch")
        ? fallbackStatements(node.childForFieldName("else_branch"), source, file, true)
        : null,
      location: locationFor(node, file)
    }];
  }
  if (node.type === "case_statement") {
    const body = node.childForFieldName("body");
    const branches = (body?.namedChildren ?? [])
      .filter((child) => child.type === "case_branch")
      .map((branch) => fallbackStatements(
        branch.childForFieldName("body"),
        source,
        file,
        true
      ));
    const elseBranch = node.namedChildren.find((child) => child.type === "case_else_branch");
    if (elseBranch) {
      branches.push(elseBranch.namedChildren
        .filter((child) => child.type !== "else_keyword")
        .flatMap((child) => fallbackStatements(child, source, file, true)));
    }
    return [{
      kind: "conditional",
      branches,
      hasImplicitEmptyPath: !elseBranch,
      location: locationFor(node, file)
    }];
  }
  if (["while_statement", "for_statement", "repeat_statement"].includes(node.type)) {
    const body = node.childForFieldName("body");
    return [{
      kind: "conditional",
      branches: [fallbackStatements(body, source, file, true)],
      hasImplicitEmptyPath: node.type !== "repeat_statement",
      location: locationFor(node, file)
    }];
  }
  if (node.type === "call_expression") {
    const functionNode = node.childForFieldName("function");
    const memberNode = functionNode?.type === "member_expression"
      ? functionNode.childForFieldName("member")
      : undefined;
    const receiverNode = functionNode?.type === "member_expression"
      ? functionNode.childForFieldName("object")
      : undefined;
    const target = functionNode
      ? cleanName(source.slice(
        (memberNode ?? functionNode).startIndex,
        (memberNode ?? functionNode).endIndex
      ))
      : undefined;
    const argumentsNode = node.childForFieldName("arguments");
    return [{
      kind: "call",
      target,
      receiver: receiverNode
        ? cleanName(source.slice(receiverNode.startIndex, receiverNode.endIndex))
        : undefined,
      arity: argumentsNode?.namedChildCount ?? 0,
      directError: !receiverNode && target?.toLocaleLowerCase("en-US") === "error",
      conditional,
      location: locationFor(node, file)
    }];
  }
  if (node.type === "exit_statement") {
    const returnNode = node.childForFieldName("return_value");
    return [{
      kind: "return",
      value: returnNode ? source.slice(returnNode.startIndex, returnNode.endIndex).trim() : undefined,
      constant: Boolean(returnNode && [
        "boolean",
        "integer",
        "decimal",
        "string_literal"
      ].includes(returnNode.type)),
      conditional,
      location: locationFor(node, file)
    }];
  }
  if (node.type === "assignment_statement") {
    const targetNode = node.childForFieldName("left");
    return [{
      kind: "assignment",
      target: targetNode
        ? cleanName(source.slice(targetNode.startIndex, targetNode.endIndex))
        : undefined,
      conditional,
      location: locationFor(node, file)
    }];
  }
  return [{
    kind: "other",
    conditional,
    location: locationFor(node, file)
  }];
}

function fallbackFactsFor(node, source, file, hasBody) {
  if (!hasBody) return undefined;
  const codeBlock = node.namedChildren.find((child) =>
    ["code_block", "statement_block"].includes(child.type)
  );
  const body = codeBlock?.childForFieldName("body") ??
    codeBlock?.namedChildren.find((child) => child.type === "statement_block");
  return {
    complete: !node.hasError && !codeBlock?.hasError,
    statements: fallbackStatements(body, source, file),
    ...((node.hasError || codeBlock?.hasError)
      ? { limitations: ["The AL parser reported errors in this procedure body."] }
      : {})
  };
}

function resolveFallbackCalls(statements, procedures) {
  for (const statement of statements) {
    if (statement.kind === "conditional") {
      if (statement.then) resolveFallbackCalls(statement.then, procedures);
      if (statement.else) resolveFallbackCalls(statement.else, procedures);
      for (const branch of statement.branches ?? []) {
        resolveFallbackCalls(branch, procedures);
      }
      continue;
    }
    if (statement.kind !== "call" || statement.directError) continue;
    const candidates = procedures.get(`${statement.target?.toLocaleLowerCase("en-US")}:${statement.arity}`) ?? [];
    const target = !statement.receiver && candidates.length === 1 ? candidates[0] : undefined;
    statement.resolved = Boolean(target?.fallbackFacts?.complete);
    if (target) statement.targetSignature = target.signature;
  }
}

function membersFor(objectNode, source, file) {
  const procedures = [];
  const fields = [];
  const parts = [];
  const actions = [];
  const views = [];
  const elements = [];
  const variables = [];
  const keys = [];
  walk(objectNode, (node) => {
    const type = memberType(node);
    if (["procedure", "trigger_declaration", "event_declaration", "interface_procedure"].includes(type)) {
      const declaration = headerOf(node);
      const name = nodeText(declaration.field("name"), source);
      if (name) {
        const returnTypeNode = declaration.field("return_type");
        const header = procedureHeader(node, source, declaration);
        const returnTypeText = returnTypeNode
          ? source.slice(returnTypeNode.startIndex, returnTypeNode.endIndex).trim()
          : header.match(/\)\s*:\s*([^;\r\n]+)$/u)?.[1]?.trim();
        const returnType = declaredType(returnTypeText);
        const attributes = [
          ...declaration.children
          .filter((child) => child.type === "attribute_item")
          .map((child) => source.slice(child.startIndex, child.endIndex)),
          ...attributesFor(node, source)
        ];
        const hasBody = node.namedChildren.some((child) =>
          ["code_block", "statement_block"].includes(child.type)
        );
        const fallbackFacts = fallbackFactsFor(node, source, file, hasBody);
        procedures.push({
          name,
          header,
          visibility: node.type === "trigger_declaration"
            ? undefined
            : nodeText(declaration.field("modifier"), source)?.toLowerCase() ?? "public",
          scope: node.startPosition.row + 1,
          kind: node.type === "trigger_declaration"
            ? "trigger"
            : node.type === "event_declaration"
              ? "event"
              : attributes.some((attribute) => /\[(?:Integration|Business)Event\b/iu.test(attribute))
                ? "event"
              : "procedure",
          hasBody,
          ...(fallbackFacts ? { fallbackFacts } : {}),
          location: locationFor(node, file),
          calls: callsFor(node, source, file),
          attributes,
          returnType: returnType.type,
          returnTargetType: returnType.targetType,
          returnTarget: returnType.target,
          action: node.type === "trigger_declaration"
            ? enclosingActionName(node, source)
            : undefined,
          properties: propertiesFor(node, source),
          ...splitConditions(declaration, source)
        });
        const procedure = procedures.at(-1);
        procedure.metadata = procedureMetadata({
          ...procedure,
          documentation: documentationComment(source, declaration.start),
          complexity: hasBody ? cyclomaticComplexity(node) : undefined
        });
      }
    }
    if (type === "field_declaration" || type === "page_field") {
      const declaration = headerOf(node);
      const nameNode = declaration.field("name");
      const name = nodeText(nameNode, source);
      const typeNode = declaration.field("type");
      const numberNode = type === "field_declaration"
        ? declaration.children.find((child) => child.type === "integer")
        : undefined;
      const directValues = declaration.children.filter((child) =>
        !["integer", "property", "declaration_body"].includes(child.type) &&
        child.id !== nameNode?.id && child.id !== typeNode?.id
      );
      fields.push({
        name: name ?? `(field ${fields.length + 1})`,
        kind: type === "page_field" ? "page-field" : "field",
        number: numberNode ? source.slice(numberNode.startIndex, numberNode.endIndex) : undefined,
        type: typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex).trim() : undefined,
        sourceExpression: type === "page_field" && directValues.length
          ? cleanName(source.slice(directValues.at(-1).startIndex, directValues.at(-1).endIndex))
          : undefined,
        container: type === "page_field" ? containerFor(node, source) : undefined,
        properties: propertiesFor(node, source),
        ...splitConditions(declaration, source),
        location: locationFor(node, file)
      });
      fields.at(-1).metadata = fieldMetadata(fields.at(-1));
    }
    if (node.type === "part_section") {
      const identifiers = node.namedChildren.filter((child) =>
        !child.type.endsWith("_keyword") && child.type !== "property"
      );
      parts.push({
        name: identifiers[0]
          ? cleanName(source.slice(identifiers[0].startIndex, identifiers[0].endIndex))
          : `(part ${parts.length + 1})`,
        target: identifiers[1]
          ? cleanName(source.slice(identifiers[1].startIndex, identifiers[1].endIndex))
          : undefined,
        container: containerFor(node, source),
        properties: propertiesFor(node, source),
        location: locationFor(node, file)
      });
    }
    if (["action_declaration", "customaction_declaration", "systemaction_declaration"].includes(node.type)) {
      const name = fieldText(node, "name", source);
      actions.push({
        name: name ?? `(action ${actions.length + 1})`,
        container: containerFor(node, source),
        properties: propertiesFor(node, source),
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
        container: containerFor(node, source),
        properties: propertiesFor(node, source),
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
    if (node.type === "enum_value_declaration") {
      const ordinal = node.namedChildren.find((child) => child.type === "integer");
      elements.push({
        kind: "enum-value",
        name: fieldText(node, "value_name", source),
        ordinal: ordinal ? source.slice(ordinal.startIndex, ordinal.endIndex) : undefined,
        properties: propertiesFor(node, source),
        location: locationFor(node, file)
      });
    }
    if (["report_dataitem", "query_dataitem"].includes(node.type)) {
      elements.push({
        kind: "dataitem",
        name: fieldText(node, "name", source),
        source: objectNameField(node, "table_name", source),
        properties: propertiesFor(node, source),
        location: locationFor(node, file)
      });
    }
    if (["report_column", "query_column", "query_filter"].includes(node.type)) {
      const name = fieldText(node, "name", source);
      const values = node.namedChildren.filter((child) =>
        !child.type.endsWith("_keyword") && child !== node.childForFieldName("name") &&
        child.type !== "declaration_body"
      );
      let parent = node.parent;
      while (parent && !["report_dataitem", "query_dataitem"].includes(parent.type)) parent = parent.parent;
      elements.push({
        kind: node.type === "query_filter" ? "filter" : "column",
        name,
        source: fieldText(node, "source", source) ?? (
          values.length ? cleanName(source.slice(values.at(-1).startIndex, values.at(-1).endIndex)) : undefined
        ),
        parent: parent ? fieldText(parent, "name", source) : undefined,
        properties: propertiesFor(node, source),
        location: locationFor(node, file)
      });
    }
    if (node.type === "xmlport_element") {
      elements.push({
        kind: source.slice(node.startIndex, node.endIndex).trim().match(/^([A-Za-z]+)/u)?.[1]?.toLowerCase(),
        name: fieldText(node, "name", source),
        source: fieldText(node, "source", source),
        properties: propertiesFor(node, source),
        location: locationFor(node, file)
      });
    }
    if (node.type === "key_declaration") {
      const fieldsNode = node.childForFieldName("fields");
      keys.push({
        name: fieldText(node, "name", source),
        fields: fieldsNode?.namedChildren.map((field) =>
          cleanName(source.slice(field.startIndex, field.endIndex))
        ) ?? [],
        properties: propertiesFor(node, source)
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
      // The parameters of a split header are those of its first branch.
      if (routine && name && headerOf(routine).includes(node)) {
        variables.push({
          name,
          ...variableType(node, source),
          parameter: true,
          byReference: /^\s*var\b/iu.test(source.slice(node.startIndex, node.endIndex)),
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
    procedure.transactionBoundaries = procedure.calls
      .filter(isCommitCall)
      .map(({ order, location }) => ({ kind: "commit", order, location }));
    procedure.transactionSegments = procedure.transactionBoundaries.length + 1;
  }
  const localProcedures = new Map();
  for (const procedure of procedures) {
    const key = `${procedure.name.toLocaleLowerCase("en-US")}:${procedure.arity}`;
    const candidates = localProcedures.get(key) ?? [];
    candidates.push(procedure);
    localProcedures.set(key, candidates);
  }
  for (const procedure of procedures) {
    if (procedure.fallbackFacts) {
      resolveFallbackCalls(procedure.fallbackFacts.statements, localProcedures);
    }
  }
  const transactionBoundaries = procedures.flatMap((procedure) =>
    procedure.transactionBoundaries.map((boundary) => ({
      ...boundary,
      procedure: procedure.signature
    }))
  );
  for (const variable of variables) variable.global = variable.scope === undefined;
  return { procedures, fields, parts, actions, views, elements, variables, keys, transactionBoundaries };
}

function dataOperationRelations(members, object) {
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
      variables.set("rec", { target: sourceTable, temporary: object.sourceTableTemporary });
      variables.set("xrec", { target: sourceTable, temporary: object.sourceTableTemporary });
    }
    let transactionSegment = 1;
    for (const call of procedure.calls) {
      if (isCommitCall(call)) {
        transactionSegment++;
        continue;
      }
      if (!call.receiver) continue;
      const variable = variables.get(call.receiver.toLowerCase());
      if (!variable) continue;
      const kind = operationKind(call.name);
      if (!kind) continue;
      relations.push({
        target: variable.target,
        targetType: "table",
        kind,
        relationClass: "runtime",
        operation: call.name,
        recordVariable: call.receiver,
        temporary: variable.parameter && variable.temporary !== true
          ? undefined
          : variable.temporary,
        member: procedure.signature,
        sourceProcedure: procedure.signature,
        transactionSegment,
        location: call.location
      });
    }
  }
  return relations;
}

function subscriberRelations(procedures) {
  const relations = [];
  for (const procedure of procedures) {
    for (const attribute of procedure.attributes ?? []) {
      const match = attribute.match(/^\[\s*EventSubscriber\s*\(\s*ObjectType::(Codeunit|Table|Page|Report|XmlPort)\s*,\s*(?:Codeunit|Database|Page|Report|XmlPort)::\s*(?:"((?:""|[^"])*)"|([^,\]\s]+))(?:\s*,\s*'((?:''|[^'])*)')?/iu);
      if (!match) continue;
      relations.push({
        target: (match[2] ?? match[3]).replaceAll('""', '"'),
        targetType: match[1].toLowerCase(),
        kind: "subscribes",
        member: procedure.name,
        ...(match[4] ? { event: match[4].replaceAll("''", "'") } : {}),
        location: procedure.location
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
    const type = objectType(node);
    if (!type) return;

    const declaration = headerOf(node);
    const name = nodeText(declaration.field("object_name"), source);
    if (!name) return;

    const id = nodeText(declaration.field("object_id"), source);
    let base = nodeText(declaration.field("base_object"), source);
    if (type === "pagecustomization") base = nodeText(declaration.field("target_page"), source);
    if (type === "interface") base = nodeText(declaration.field("extends_interface"), source);

    const relations = referencesFor(node, source, file);
    // The branches of a split header may extend different objects: one
    // relation each, with the condition of its branch.
    const otherBases = new Map();
    if (declaration.split && base) {
      for (const baseNode of node.childrenForFieldName("base_object")) {
        const target = nodeText(baseNode, source);
        const key = target.toLowerCase();
        if (key !== base.toLowerCase() && !otherBases.has(key)) otherBases.set(key, { target, baseNode });
      }
    }
    if (base) {
      relations.push({
        target: base,
        targetType: type === "interface" ? "interface" : EXTENSION_TARGET[type],
        kind: "extends",
        relationClass: "schema",
        ...(otherBases.size
          ? { conditionalSymbols: preprocessorConditions(declaration.field("base_object"), source) }
          : {}),
        location: locationFor(node, file)
      });
    }
    for (const { target, baseNode } of otherBases.values()) {
      relations.push({
        target,
        targetType: EXTENSION_TARGET[type],
        kind: "extends",
        relationClass: "schema",
        conditionalSymbols: preprocessorConditions(baseNode, source),
        location: locationFor(baseNode, file)
      });
    }
    const members = membersFor(node, source, file);
    const properties = propertiesFor(node, source);
    const sourceTableTemporary = /^true$/iu.test(
      propertyValue(properties, "sourcetabletemporary") ?? "false"
    );
    relations.push(...subscriberRelations(members.procedures));
    const dataRelations = dataOperationRelations(members, {
      type,
      name,
      base,
      relations,
      sourceTableTemporary
    });
    relations.push(...dataRelations, ...helperDataOperationRelations(members, dataRelations));

    const assignableValue = type === "permissionset"
      ? propertyValue(properties, "assignable")
      : undefined;
    const objectAccess = ["permissionset", "permissionsetextension"].includes(type)
      ? propertyValue(properties, "access")?.toLowerCase() ?? "public"
      : undefined;
    objects.push({
      id,
      name,
      type,
      namespace,
      usings,
      file,
      properties,
      relations,
      procedures: members.procedures,
      fields: members.fields,
      parts: members.parts,
      actions: members.actions,
      views: members.views,
      elements: members.elements,
      keys: members.keys,
      primaryKeyFields: members.keys[0]?.fields ?? [],
      variables: members.variables,
      transactionBoundaries: members.transactionBoundaries,
      assignable: type === "permissionset" ? /^true$/iu.test(assignableValue ?? "false") : undefined,
      objectAccess,
      ...splitConditions(declaration, source),
      location: locationFor(node, file),
      parseError: node.hasError
    });
    objects.at(-1).metadata = objectMetadata({
      ...objects.at(-1),
      documentation: documentationComment(source, declaration.start)
    });
  });

  const result = { objects, hasError: tree.rootNode.hasError };
  tree.delete();
  parser.delete();
  return result;
}

async function cachedObjectsFromSource(source, file, cache) {
  if (!cache) return objectsFromSource(source, file);
  const key = `${file}\u0000${createHash("sha1").update(source).digest("hex")}`;
  if (!cache.has(key)) cache.set(key, await objectsFromSource(source, file));
  // Callers attach apps and keys to the objects, so every caller gets a copy.
  return structuredClone(cache.get(key));
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

async function manifestAt(candidate, boundary, cache) {
  if (cache.has(candidate)) return cache.get(candidate);
  let app;
  try {
    const data = JSON.parse(await fs.readFile(candidate, "utf8"));
    app = {
      id: data.id,
      name: data.name,
      publisher: data.publisher,
      version: data.version,
      path: path.relative(boundary, candidate) || "app.json",
      root: path.dirname(candidate),
      dependencies: data.dependencies ?? []
    };
  } catch {
    app = undefined;
  }
  cache.set(candidate, app);
  return app;
}

const outside = (boundary, directory) => {
  const relative = path.relative(boundary, directory);
  return relative.startsWith("..") || path.isAbsolute(relative);
};

/**
 * Finds the app that compiles a file and, when app.json files are nested, the
 * module it belongs to. The AL compiler builds every file below an app
 * folder, so a nested app.json (as in BCApps' System Application or Base
 * Application) marks a module of the outer app, not an app of its own. Above
 * the analyzed root only the nearest manifest counts.
 */
async function readAppManifest(file, root, cache) {
  const boundary = (await fs.stat(root)).isDirectory() ? root : path.dirname(root);
  const found = [];
  let directory = path.dirname(file);
  while (true) {
    const app = await manifestAt(path.join(directory, "app.json"), boundary, cache);
    if (app) found.push(app);
    const parent = path.dirname(directory);
    if (parent === directory || (found.length && outside(boundary, parent))) break;
    directory = parent;
  }
  if (!found.length) return {};
  return { app: found.at(-1), module: found.length > 1 ? found[0] : undefined };
}

/**
 * Parses every AL file below `input`. Pass a shared `parseCache` Map to reuse
 * parse results for unchanged file content across calls (history replay,
 * watch), preloaded `symbols` to skip reading .alpackages again, and a
 * `fileFilter` for root-relative paths to analyze part of a large repository.
 */
export async function analyze(input, { parseCache, symbols: preloadedSymbols, fileFilter, al } = {}) {
  const root = path.resolve(input);
  const rootStat = await fs.stat(root);
  const base = rootStat.isDirectory() ? root : path.dirname(root);
  const files = (await collectAlFiles(root))
    .filter((file) => !fileFilter || fileFilter(path.relative(base, file).replaceAll("\\", "/")));
  const objects = [];
  const parseErrors = [];
  const diagnostics = [];
  const manifestCache = new Map();
  const apps = new Map();
  const modules = new Map();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const relativeFile = path.relative(
      base,
      file
    );
    const result = await cachedObjectsFromSource(source, relativeFile || path.basename(file), parseCache);
    objects.push(...result.objects);
    const { app, module } = await readAppManifest(file, root, manifestCache);
    if (app) {
      apps.set(app.id ?? app.name, app);
      for (const object of result.objects) object.app = app;
    }
    if (module) {
      modules.set(module.id ?? module.name, { ...module, app: app.id ?? app.name });
      const reference = { id: module.id, name: module.name, path: module.path };
      for (const object of result.objects) object.module = reference;
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

  const symbols = preloadedSymbols ?? await loadProjectSymbols(base, al);
  // An app of the workspace may also lie compiled in a package cache (App A's
  // .app in the .alpackages of App B that depends on it). The source is what
  // is analyzed; its symbols would only duplicate every object of the app.
  const appKey = (app) => String(app?.id ?? app?.name ?? "").toLowerCase();
  const sourceApps = new Set([...apps.values()].map(appKey).filter(Boolean));
  const shadowed = new Set();
  for (const app of symbols.packages) {
    if (sourceApps.has(appKey(app))) {
      shadowed.add(appKey(app));
      diagnostics.push({
        severity: "info",
        code: "symbol-package-shadowed",
        message: `Symbol package ${app.path} (${[app.name, app.version].filter(Boolean).join(" ")}) is ignored: the workspace contains the source of this app`,
        file: app.path
      });
    } else {
      apps.set(app.id ?? app.name, app);
    }
  }
  for (const object of symbols.objects) if (!shadowed.has(appKey(object.app))) objects.push(object);
  diagnostics.push(...symbols.diagnostics);

  return {
    schemaVersion: 1,
    root,
    files: files.length,
    apps: [...apps.values()],
    ...(modules.size ? { modules: [...modules.values()] } : {}),
    symbolPackages: symbols.packages.filter((app) => !shadowed.has(appKey(app))),
    objects,
    parseErrors,
    diagnostics
  };
}

export const testing = { objectsFromSource };
