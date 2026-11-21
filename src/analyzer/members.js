// The members of an object (fields, keys, procedures, triggers, actions,
// parts, ...), what each procedure calls, and the data it reads and writes,
// also through the helpers it calls.
import { isCommitCall, operationKind } from "../operation-semantics.js";
import { cyclomaticComplexity, documentationComment, fieldMetadata, procedureMetadata } from "../metadata.js";
import { SPLIT_ROUTINE_BODY, attributesFor, cleanName, containerFor, declaredType, enclosingActionName, enclosingRoutine, fieldText, headerOf, locationFor, memberType, nodeText, objectNameField, procedureHeader, propertiesFor, routineBody, splitConditions, variableType, walk } from "./syntax.js";

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

/**
 * The statements of a body split by `#if`: which branch is compiled depends on
 * the symbols, so the branches are the paths of one conditional. A branch
 * without statements (`begin end;`) is an empty path. What follows `#endif`
 * runs on every path.
 */
function splitBodyStatements(splitBody, source, file) {
  const branches = [];
  const shared = [];
  let closed = false;
  for (const child of splitBody.namedChildren) {
    if (["preproc_if", "preproc_elif", "preproc_else"].includes(child.type)) branches.push([]);
    else if (child.type === "preproc_endif") closed = true;
    else if (child.type === "statement_block") {
      if (closed || !branches.length) shared.push(...fallbackStatements(child, source, file));
      else branches.at(-1).push(...fallbackStatements(child, source, file, true));
    }
  }
  return [
    {
      kind: "conditional",
      branches,
      // Without the body of one of its branches the procedure does not compile.
      hasImplicitEmptyPath: false,
      location: locationFor(splitBody, file)
    },
    ...shared
  ];
}

function fallbackFactsFor(node, source, file, hasBody) {
  if (!hasBody) return undefined;
  const codeBlock = routineBody(node);
  const split = SPLIT_ROUTINE_BODY.includes(codeBlock?.type);
  const body = split
    ? undefined
    : codeBlock?.childForFieldName("body") ??
      codeBlock?.namedChildren.find((child) => child.type === "statement_block");
  return {
    complete: !node.hasError && !codeBlock?.hasError,
    statements: split
      ? splitBodyStatements(codeBlock, source, file)
      : fallbackStatements(body, source, file),
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

export function membersFor(objectNode, source, file) {
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
        const hasBody = Boolean(routineBody(node));
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

export function dataOperationRelations(members, object) {
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

export function subscriberRelations(procedures) {
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

export function helperDataOperationRelations(members, directRelations) {
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
