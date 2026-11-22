// What an object refers to by its declaration: what it extends and
// implements, its table relations and CalcFormulas, its permissions, and the
// types of its variables and parameters.
import { includedPermissionSets, permissionGrant } from "../permission-semantics.js";
import { cleanName, containsNode, enclosingMember, fieldText, locationFor, memberExpressionParts, objectNameField, preprocessorConditions, typeReference, walk } from "./syntax.js";

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

export function referencesFor(objectNode, source, file) {
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
