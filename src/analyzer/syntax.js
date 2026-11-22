// The AL syntax tree as tree-sitter-al gives it: the grammar, the kinds of
// object, and reading names, headers, properties, locations, and the
// `#if` branches around a node.
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

const GRAMMAR_PATH = fileURLToPath(
  new URL("../../vendor/tree-sitter-al.wasm", import.meta.url)
);
let languagePromise;

export async function getLanguage() {
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

export const EXTENSION_TARGET = {
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
export function memberType(node) {
  return SPLIT_MEMBERS.get(node.type) ?? node.type;
}

/**
 * The header of a declaration: its named children and its fields. For a split
 * header these are the children of the first branch and what follows `#endif`;
 * the other branches are left out, so a field missing in the first branch (no
 * `local`, no return type) is not read from another one.
 */
export function headerOf(node) {
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
export function objectType(node) {
  if (node.type !== SPLIT_OBJECT) return OBJECT_TYPES.get(node.type);
  return headerOf(node).children.map((child) => OBJECT_KEYWORDS.get(child.type)).find(Boolean);
}

/** The condition of the branch a split header is read from, with those of the `#if`s around it. */
export function splitConditions(header, source) {
  return header.split && header.branch.children.length
    ? { conditionalSymbols: preprocessorConditions(header.branch.children[0], source) }
    : {};
}

export function cleanName(value) {
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
export function typeReference(node, source) {
  return objectNameField(node, "reference", source);
}

const QUALIFIED_NAME = /^[A-Za-z_]\w*(?:\s*\.\s*(?:"(?:""|[^"])*"|[A-Za-z_]\w*))+/u;

/**
 * Like fieldText, but keeps a namespace-qualified object name whole
 * (Microsoft.Sales.Document."Sales Header"); the grammar's name fields hold
 * only its first segment.
 */
export function objectNameField(node, field, source) {
  const child = node.childForFieldName(field);
  if (!child) return undefined;
  // Some nodes (Database::) end after the first segment, so read past them.
  const qualified = source.slice(child.startIndex, child.startIndex + 400).match(QUALIFIED_NAME)?.[0];
  return qualified ? qualified.replace(/\s*\.\s*/gu, ".") : fieldText(node, field, source);
}

export function nodeText(node, source) {
  return node ? cleanName(source.slice(node.startIndex, node.endIndex)) : undefined;
}

export function fieldText(node, field, source) {
  return nodeText(node.childForFieldName(field), source);
}

export function locationFor(node, file) {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1
  };
}

export function walk(node, visit) {
  visit(node);
  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

export function containsNode(parent, child) {
  return child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex;
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
export function propertiesFor(ownerNode, source) {
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
export function propertyValue(properties, wantedName) {
  const value = properties.findLast(({ name }) => name?.toLowerCase() === wantedName)?.value;
  return value === undefined ? undefined : cleanName(value);
}

export function containerFor(node, source) {
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

/** The body of a routine, as a direct child of its node. */
const ROUTINE_BODY = ["code_block", "statement_block"];
/**
 * A body split by preprocessor directives, where the grammar cannot build one
 * code_block: every branch is a body of its own (`#if` / `var ... begin ... end;`
 * / `#else` / `begin ... end;` / `#endif`), or the branches open the body and
 * its end is shared (`#if` / `begin A();` / `#else` / `begin` / `#endif` /
 * `B(); end;`). The variables and statement blocks of the branches are direct
 * children, between the directives; `begin` and `end` are not in the tree.
 */
export const SPLIT_ROUTINE_BODY = ["preproc_split_complete_body", "preproc_split_procedure_body"];
/** What follows the header of a routine: its variables (which `#if` may wrap) and its body. */
const AFTER_ROUTINE_HEADER = [
  "var_section",
  "preproc_conditional_var_block",
  ...ROUTINE_BODY,
  ...SPLIT_ROUTINE_BODY,
  "declaration_body"
];

export function routineBody(node) {
  return node.namedChildren.find((child) =>
    ROUTINE_BODY.includes(child.type) || SPLIT_ROUTINE_BODY.includes(child.type)
  );
}

/** Lines between the header of a routine and what follows it, part of neither. */
const BETWEEN_HEADER_AND_BODY = ["comment", "multiline_comment", "pragma", "preproc_region", "preproc_endregion"];

/** The declaration line of a routine as written: no variables, no body, no comment or pragma before them. */
export function procedureHeader(node, source, header) {
  // A split header is read as written in its first branch, without its attributes.
  const children = header.split ? header.branch.children : node.namedChildren;
  const start = header.split
    ? children.find((child) => !["comment", "attribute_item"].includes(child.type))?.startIndex ?? header.start
    : node.startIndex;
  let end = header.split ? header.branch.end : node.endIndex;
  let index = children.findIndex((child) => AFTER_ROUTINE_HEADER.includes(child.type));
  if (index === -1 && header.split) index = children.length;
  if (index !== -1) {
    while (index > 0 && BETWEEN_HEADER_AND_BODY.includes(children[index - 1].type)) index--;
    end = children[index]?.startIndex ?? end;
  }
  return source.slice(start, end).trim().replace(/\s+/gu, " ").replace(/;$/u, "");
}

export function enclosingMember(node, source, types) {
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

export function preprocessorConditions(node, source) {
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

export function memberExpressionParts(node, source) {
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

export function attributesFor(node, source) {
  const prefix = source.slice(Math.max(0, node.startIndex - 4000), node.startIndex);
  const block = prefix.match(/(?:\[[^\]\r\n]+\]\s*)+$/u)?.[0] ?? "";
  return [...block.matchAll(/\[[^\]\r\n]+\]/gu)].map(([attribute]) => attribute);
}

export function enclosingActionName(node, source) {
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

export function enclosingRoutine(node) {
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

export function declaredType(type) {
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

export function variableType(node, source) {
  const typeNode = node.childForFieldName("type");
  const type = typeNode
    ? source.slice(typeNode.startIndex, typeNode.endIndex).trim()
    : undefined;
  return declaredType(type);
}
