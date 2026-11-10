// What a step of a process test needs from the person who performs it:
// Execute on the page they open and on every object its code runs (calls,
// Codeunit.Run, event subscribers), and table-data rights for what the page
// and that code read and write. Traced on the resolved architecture model
// from the UI operation the AL test performs.
import { createCallResolver } from "../call-analysis.js";
import { operationKind } from "../operation-semantics.js";
import { normalizeIdentifier } from "../resolver.js";
import { EXECUTABLE, inherentGrants, inherentlyExecutable, inherentTableRights } from "./access.js";

const MAX_PROCEDURES = 4000;
const TABLE_TRIGGERS = { insert: "oninsert", modify: "onmodify", delete: "ondelete", rename: "onrename" };
// Where the RunTrigger argument sits: Insert(true), ModifyAll(Field, Value, true).
const RUN_TRIGGER_ARGUMENT = { insert: 0, modify: 0, delete: 0, deleteall: 0, modifyall: 2 };

const lower = (value) => String(value ?? "").toLowerCase();

function within(inner, outer) {
  if (!inner || !outer) return false;
  if (inner.file && outer.file && inner.file !== outer.file) return false;
  const after = inner.line > outer.line || (inner.line === outer.line && (inner.column ?? 0) >= (outer.column ?? 0));
  const before = inner.endLine < outer.endLine || (inner.endLine === outer.endLine && (inner.endColumn ?? 0) <= (outer.endColumn ?? Infinity));
  return after && before;
}

function sameStart(a, b) {
  return Boolean(a && b) && a.line === b.line && a.column === b.column;
}

function dataRight(edge) {
  if (edge.kind === "reads") return "read";
  const operation = lower(edge.operation);
  if (operation.startsWith("insert")) return "insert";
  if (operation.startsWith("delete")) return "delete";
  if (operation.startsWith("rename")) return "rename";
  return "modify";
}

/** The element an event subscriber names: the field of a validate event, the action of an action event. */
function subscribedElement(procedure) {
  const text = (procedure.attributes ?? []).find((attribute) => /EventSubscriber/iu.test(attribute));
  const match = /EventSubscriber\s*\(\s*ObjectType\s*::\s*\w+\s*,\s*(?:\w+\s*::\s*)?(?:"(?:""|[^"])*"|[^,]+?)\s*,\s*'[^']*'\s*,\s*'([^']*)'/iu.exec(text ?? "");
  return match?.[1] || undefined;
}

export function objectLabel(object) {
  return object ? `${object.type} ${object.id ? `${object.id} ` : ""}${object.name}` : "";
}

/**
 * @param options.label object => its name in the report (default: objectLabel)
 * @param options.memberLabel (owner, procedure) => the place in the code a reason names
 */
export function createTracer(model, { label = objectLabel, memberLabel } = {}) {
  const describeMember = memberLabel ?? ((owner, procedure) => `${label(owner)} (${procedure.action ? `action ${procedure.action}` : procedure.name})`);
  const objects = new Map(model.objects.map((object) => [object.key, object]));
  const records = [];
  const byNode = new Map();
  for (const owner of model.objects) {
    for (const [index, procedure] of (owner.procedures ?? []).entries()) {
      const key = `${owner.key}::${procedure.kind}::${normalizeIdentifier(procedure.name)}::${procedure.location?.line ?? index}:${procedure.location?.column ?? 0}`;
      const record = { owner, procedure, node: { key } };
      records.push(record);
      byNode.set(key, record);
    }
  }
  const resolver = createCallResolver(model, records);
  const recordsOf = new Map();
  for (const record of records) {
    if (!recordsOf.has(record.owner.key)) recordsOf.set(record.owner.key, []);
    recordsOf.get(record.owner.key).push(record);
  }

  const dataEdges = new Map();
  // Objects whose Permissions property gives their code table-data rights.
  const declarers = new Set();
  const subscribers = new Map();
  const extensions = new Map();
  const extended = new Map();
  for (const edge of model.edges) {
    if (["reads", "writes"].includes(edge.kind) && edge.location) {
      if (!dataEdges.has(edge.from)) dataEdges.set(edge.from, []);
      dataEdges.get(edge.from).push(edge);
    } else if (edge.kind === "permits" && edge.permissionKind === "tabledata" && !["permissionset", "permissionsetextension"].includes(objects.get(edge.from)?.type)) {
      declarers.add(edge.from);
    } else if (edge.kind === "subscribes" && edge.to) {
      const key = `${edge.to}\u0000${normalizeIdentifier(edge.event)}`;
      if (!subscribers.has(key)) subscribers.set(key, []);
      subscribers.get(key).push(edge);
    } else if (edge.kind === "extends" && edge.to) {
      if (!extensions.has(edge.to)) extensions.set(edge.to, []);
      extensions.get(edge.to).push(objects.get(edge.from));
      extended.set(edge.from, objects.get(edge.to));
    }
  }

  const isTemporaryTable = (table) => /^temporary$/iu.test(table?.metadata?.tableType ?? "");

  /** The table whose record `Rec` is in the code of `owner`. */
  function ownTable(owner) {
    if (owner.type === "table") return owner;
    if (owner.type === "tableextension") return extended.get(owner.key);
    // A codeunit that runs on a record: TableNo = "Sales Header".
    if (owner.type === "codeunit") return owner.metadata?.tableNo ? resolver.object("table", owner.metadata.tableNo) : undefined;
    const page = owner.type === "pageextension" ? extended.get(owner.key) : owner;
    if (page?.type !== "page" || !page.metadata?.sourceTable || page.metadata.sourceTableTemporary) return undefined;
    const table = resolver.object("table", page.metadata.sourceTable);
    return isTemporaryTable(table) ? undefined : table;
  }

  /** The page and the extensions that add members to it. */
  const withExtensions = (object) => [object, ...(extensions.get(object.key) ?? []).filter(Boolean)];

  /**
   * The field of the record a page control shows: `Rec."Approval Limit"`, or
   * the bare field name. A variable or an expression is no field.
   */
  function boundField(expression, owner, table) {
    const text = String(expression ?? "").trim();
    const viaRec = /^rec\s*\.\s*(?:"((?:""|[^"])*)"|(\w+))$/iu.exec(text);
    if (viaRec) return (viaRec[1] ?? viaRec[2]).replaceAll('""', '"');
    if (!text || !table) return undefined;
    // The analyzer keeps a quoted name without its quotes: "No." arrives as No.
    const name = text.replace(/^"|"$/gu, "").replaceAll('""', '"');
    const fields = withExtensions(table).flatMap(({ fields: list }) => list ?? []).filter((field) => field.name);
    if (fields.length) return fields.some((field) => normalizeIdentifier(field.name) === normalizeIdentifier(name)) ? name : undefined;
    // A table from a symbol package has no field names here: a plain name that is no variable of the page.
    if (!/^[\w .%&/-]+$/u.test(name)) return undefined;
    return (owner.variables ?? []).some((variable) => normalizeIdentifier(variable.name) === normalizeIdentifier(name)) ? undefined : name;
  }

  function triggersOf(owner, names, inside) {
    const wanted = names.map(lower);
    const members = [...(owner.fields ?? []), ...(owner.actions ?? [])].map(({ location }) => location).filter(Boolean);
    return (recordsOf.get(owner.key) ?? []).filter(({ procedure }) => {
      if (procedure.kind !== "trigger" || !wanted.includes(lower(procedure.name))) return false;
      // A trigger of the object itself, or of one of its fields or actions.
      return inside ? within(procedure.location, inside) : !procedure.action && !members.some((location) => within(procedure.location, location));
    });
  }

  function collector() {
    const needs = new Map();
    const notes = new Map();
    return {
      need(object, right, { ui = false, reason, path = [], inherents = [] }) {
        if (!object) return;
        const executable = right === "execute";
        if (executable ? !EXECUTABLE.includes(object.type) : object.type !== "table") return;
        if (!executable && isTemporaryTable(object)) return;
        // Renaming a record takes the right to modify it.
        const needed = right === "rename" ? "modify" : right;
        const inherent = executable
          ? inherentlyExecutable(object)
          : inherentTableRights(object).includes(needed) ||
            inherents.some((grant) => grant.kind === "tabledata" && normalizeIdentifier(grant.target) === normalizeIdentifier(object.name) && grant.rights.includes(needed));
        const key = `${object.key}\u0000${needed}`;
        const current = needs.get(key);
        if (!current) {
          needs.set(key, { object, right: needed, ui, reason, inherent, executors: [path] });
          return;
        }
        // Every occurrence must be covered, so one that is not inherent decides.
        current.ui ||= ui;
        current.inherent &&= inherent;
        current.executors.push(path);
      },
      note(code, values = {}) {
        notes.set(`${code}\u0000${JSON.stringify(values)}`, { code, ...values });
      },
      result: () => ({ needs: [...needs.values()], notes: [...notes.values()] })
    };
  }

  /**
   * Subscribers of an event of `publisher`, as starts of the trace.
   * @param element the field or action the event is raised for; a subscriber
   *   that names another element does not run
   */
  function subscriberStarts(out, publisher, event, path, inherents, element) {
    const starts = [];
    for (const edge of subscribers.get(`${publisher.key}\u0000${normalizeIdentifier(event)}`) ?? []) {
      const subscriber = objects.get(edge.from);
      if (!subscriber) continue;
      const member = edge.member ?? edge.sourceProcedure;
      const procedures = (recordsOf.get(subscriber.key) ?? []).filter(({ procedure }) => normalizeIdentifier(procedure.name) === normalizeIdentifier(member));
      const running = procedures.filter(({ procedure }) => {
        const named = subscribedElement(procedure);
        return element === undefined || !named || normalizeIdentifier(named) === normalizeIdentifier(element);
      });
      if (procedures.length && !running.length) continue;
      if (/^manual$/iu.test(subscriber.metadata?.eventSubscriberInstance ?? "")) {
        out.note("manual-subscriber", { object: label(subscriber), event });
        continue;
      }
      out.need(subscriber, "execute", { reason: { code: "event", event: edge.event ?? event, publisher: label(publisher), procedure: member }, path: [...path, subscriber.key], inherents });
      starts.push(...running.map((record) => ({ record, path: [...path, subscriber.key], inherents })));
    }
    return starts;
  }

  /** The trigger events of a page: OnOpenPageEvent, OnAfterActionEvent of an action, ... */
  function pageEventStarts(out, page, events, element) {
    const base = page.type === "pageextension" ? extended.get(page.key) ?? page : page;
    return events.flatMap((event) => subscriberStarts(out, base, event, [base.key], [], element));
  }

  /** What writing a record sets off: the table's trigger and its database events. */
  function writeStarts(out, table, operation, runTrigger, path, inherents) {
    if (!table || isTemporaryTable(table)) return [];
    const starts = [];
    const name = operation.replace(/all$/u, "");
    if (runTrigger && TABLE_TRIGGERS[name]) {
      for (const owner of withExtensions(table)) {
        for (const record of triggersOf(owner, [TABLE_TRIGGERS[name]])) starts.push({ record, path: [...path, owner.key], inherents });
      }
    }
    if (TABLE_TRIGGERS[name]) {
      for (const event of [`onbefore${name}event`, `onafter${name}event`]) starts.push(...subscriberStarts(out, table, event, path, inherents));
    }
    return starts;
  }

  /** The OnValidate trigger of a table field, and the table's validate events. */
  function validateStarts(out, table, fieldName, path, inherents) {
    if (!table) return [];
    const starts = [];
    for (const owner of withExtensions(table)) {
      const field = (owner.fields ?? []).find(({ name }) => normalizeIdentifier(name) === normalizeIdentifier(fieldName));
      if (field?.location) for (const record of triggersOf(owner, ["onvalidate"], field.location)) starts.push({ record, path: [...path, owner.key], inherents });
    }
    for (const event of ["onbeforevalidateevent", "onaftervalidateevent"]) starts.push(...subscriberStarts(out, table, event, path, inherents, fieldName));
    return starts;
  }

  /** What running an object from code needs: Execute, and for a page its source table. */
  function runObject(out, target, path, inherents, reason) {
    out.need(target, "execute", { reason, path: [...path, target.key], inherents });
    const starts = [];
    if (target.type === "codeunit") {
      for (const record of triggersOf(target, ["onrun"])) starts.push({ record, path: [...path, target.key], inherents });
    } else if (target.type === "page") {
      starts.push(...openPage(out, target, { path, inherents }));
    }
    return starts;
  }

  /** What showing a page needs besides Execute on it: its source table and what its triggers run. */
  function openPage(out, page, { path = [], inherents = [] } = {}) {
    const own = [...path, page.key];
    const table = ownTable(page);
    if (table) out.need(table, "read", { ui: false, reason: { code: "read-source", page: label(page) }, path: own, inherents });
    const starts = pageEventStarts(out, page, ["onopenpageevent", "onaftergetrecordevent", "onaftergetcurrrecordevent"]);
    if (page.externalSymbol) {
      out.note("symbols-only", { object: label(page) });
      return starts;
    }
    for (const owner of withExtensions(page)) {
      for (const record of triggersOf(owner, ["oninit", "onopenpage", "onaftergetrecord", "onaftergetcurrrecord"])) starts.push({ record, path: [...path, owner.key], inherents });
    }
    return starts;
  }

  /** Follows code from its starts and collects what it needs. */
  function trace(out, starts) {
    const queue = [...starts];
    const seen = new Set();
    while (queue.length) {
      const { record, path, inherents: inherited } = queue.shift();
      // An indirect right holds where the calling code has the permission
      // itself, so a procedure is followed once per set of such callers.
      const visit = [
        record.node.key,
        [...new Set(path.filter((key) => declarers.has(key)))].sort().join(","),
        inherited.map(({ target, rights }) => `${normalizeIdentifier(target)}:${rights.join("")}`).sort().join(",")
      ].join("\u0000");
      if (seen.has(visit)) continue;
      if (seen.size >= MAX_PROCEDURES) {
        out.note("truncated", { limit: MAX_PROCEDURES });
        break;
      }
      seen.add(visit);
      const { owner, procedure } = record;
      const own = inherentGrants(procedure);
      const inherents = own.length ? [...inherited, ...own] : inherited;
      const member = describeMember(owner, procedure);
      const push = (items) => queue.push(...items);
      // The analyzer also reports what a called helper does at the place of its
      // call; that access is the helper's, which the trace reaches by itself.
      const ownAccess = ({ location, sourceProcedure }) => within(location, procedure.location) &&
        (!sourceProcedure || normalizeIdentifier(String(sourceProcedure).split("(")[0]) === normalizeIdentifier(procedure.name));

      if (procedure.kind === "event") push(subscriberStarts(out, owner, procedure.name, path, inherents));

      for (const edge of (dataEdges.get(owner.key) ?? []).filter(ownAccess)) {
        if (edge.temporary) continue;
        const table = edge.to ? objects.get(edge.to) : undefined;
        if (!table) {
          if (edge.unresolved?.name) out.note("unresolved-table", { name: edge.unresolved.name, procedure: member });
          continue;
        }
        const right = dataRight(edge);
        out.need(table, right, { reason: { code: "data", operation: edge.operation ?? right, procedure: member, object: label(owner) }, path, inherents });
        if (edge.kind !== "writes") continue;
        const operation = lower(edge.operation);
        const call = (procedure.calls ?? []).find(({ location }) => sameStart(location, edge.location));
        const argument = RUN_TRIGGER_ARGUMENT[operation];
        const runTrigger = operation === "rename" || (argument !== undefined && /^true$/iu.test(String(call?.arguments?.[argument] ?? "").trim()));
        push(writeStarts(out, table, operation, runTrigger, path, inherents));
      }

      for (const call of procedure.calls ?? []) {
        const name = lower(call.name);
        const receiver = lower(call.receiver);
        // Codeunit.Run(Codeunit::"X"), Page.RunModal(Page::"X"), Report.Run(50100)
        if (EXECUTABLE.includes(receiver) && /^run(modal|request)?|^(execute|import|export|open)$/u.test(name)) {
          const argument = String(call.arguments?.[0] ?? "").trim();
          const typed = /^(\w+)\s*::\s*(?:"((?:""|[^"])*)"|([\w.]+))$/u.exec(argument);
          const target = typed
            ? resolver.object(lower(typed[1]) === "database" ? "table" : lower(typed[1]), (typed[2] ?? typed[3]).replaceAll('""', '"'))
            : /^\d+$/u.test(argument) ? resolver.object(receiver, argument) : undefined;
          if (target) push(runObject(out, target, path, inherents, { code: "run", procedure: member, object: label(owner) }));
          else if (argument) out.note("dynamic-run", { call: `${call.receiver}.${call.name}`, procedure: member });
          continue;
        }
        const variable = call.receiver ? resolver.variableFor(owner, call, "record") : undefined;
        // The record of the object itself: Rec.Modify() anywhere, a bare Modify() in a table.
        const viaRec = !variable && /^(rec|xrec)$/u.test(receiver);
        const bare = !call.receiver && ["table", "tableextension"].includes(owner.type);
        const onRecord = Boolean(variable) || viaRec || bare;
        const table = variable ? resolver.object("table", variable.target) : viaRec || bare ? ownTable(owner) : undefined;
        const temporary = Boolean(variable?.temporary);
        const kind = operationKind(call.name);
        if (onRecord && kind) {
          // Where the analyzer saw the access, the loop above has it. It does
          // not see Rec in page extensions and TableNo codeunits, a bare call
          // in a table, or what a temporary record's triggers do.
          const known = (dataEdges.get(owner.key) ?? []).some(({ location }) => sameStart(location, call.location));
          if (!table || (known && !temporary)) continue;
          if (!temporary) out.need(table, dataRight({ kind, operation: call.name }), { reason: { code: "data", operation: call.name, procedure: member, object: label(owner) }, path, inherents });
          if (kind === "writes") {
            const argument = RUN_TRIGGER_ARGUMENT[name];
            const runTrigger = name === "rename" || (argument !== undefined && /^true$/iu.test(String(call.arguments?.[argument] ?? "").trim()));
            push(writeStarts(out, table, name, runTrigger, path, inherents));
          }
          continue;
        }
        if (name === "validate" && onRecord) {
          const field = String(call.arguments?.[0] ?? "").trim().replace(/^"|"$/gu, "");
          if (table && field) push(validateStarts(out, table, field, path, inherents));
          continue;
        }
        // A procedure of the record's table: Rec.Release().
        if (table && (variable || viaRec) && table.key !== owner.key) {
          for (const node of resolver.candidates(table, call.name)) {
            const target = byNode.get(node.key);
            if ((target.procedure.arity ?? 0) === call.arity) push([{ record: target, path: [...path, table.key], inherents }]);
          }
          continue;
        }
        const resolved = resolver.resolveCall(owner, call);
        if (resolved.builtin || !resolved.targetOwner) continue;
        const target = resolved.targetOwner;
        const next = target.key === owner.key ? path : [...path, target.key];
        const candidates = (resolved.target ? [byNode.get(resolved.target.key)] : resolved.candidates ?? []).filter(Boolean);
        // Posting.Run() and OrderLines.RunModal() on a variable run the object like Codeunit.Run does.
        if (target.key !== owner.key && !candidates.length && /^run(modal)?$/u.test(name) && EXECUTABLE.includes(target.type)) {
          push(runObject(out, target, path, inherents, { code: "run", procedure: member, object: label(owner) }));
          if (target.externalSymbol) out.note("symbols-only", { object: label(target) });
          continue;
        }
        if (target.key !== owner.key) {
          out.need(target, "execute", { reason: { code: "call", procedure: member, object: label(owner), target: call.name }, path: next, inherents });
          if (target.type === "interface") out.note("interface-call", { interface: target.name, procedure: member });
          else if (target.externalSymbol) out.note("symbols-only", { object: label(target) });
        }
        push(candidates.map((candidate) => ({ record: candidate, path: next, inherents })));
      }
    }
  }

  const pageNamed = (name) => resolver.object("page", name);

  /** The page an operation acts on: the opened page, or a part of it. */
  function pageContext(out, page, sections = []) {
    let current = page;
    for (const section of sections) {
      const part = withExtensions(current).flatMap(({ parts }) => parts ?? [])
        .find(({ name }) => normalizeIdentifier(name) === normalizeIdentifier(section));
      const target = part?.target ? pageNamed(part.target) : undefined;
      if (!target) {
        if (current.externalSymbol) out.note("symbols-only", { object: label(current) });
        else out.note("part-not-found", { part: section, page: label(current) });
        return undefined;
      }
      current = target;
    }
    return current;
  }

  function memberOf(page, name, kind) {
    for (const owner of withExtensions(page)) {
      const member = (kind === "action" ? owner.actions : (owner.fields ?? []).filter((field) => field.kind === "page-field"))
        ?.find((candidate) => normalizeIdentifier(candidate.name) === normalizeIdentifier(name));
      if (member) return { owner, member };
    }
    return undefined;
  }

  const delayedInsert = (page) => withExtensions(page).some(({ properties }) =>
    (properties ?? []).some(({ name, value }) => lower(name) === "delayedinsert" && /^true$/iu.test(String(value).trim())));

  /** A record the user creates or changes on a page: the right, the triggers, the events. */
  function editRecord(out, page, right, starts) {
    const table = ownTable(page);
    if (!table) return;
    const path = [page.key];
    out.need(table, right, { reason: { code: `${right}-source`, page: label(page) }, path });
    for (const owner of withExtensions(page)) {
      for (const record of triggersOf(owner, right === "insert" ? ["onnewrecord", "oninsertrecord"] : ["onmodifyrecord"])) starts.push({ record, path: [owner.key], inherents: [] });
    }
    starts.push(...pageEventStarts(out, page, right === "insert" ? ["onnewrecordevent", "oninsertrecordevent"] : ["onmodifyrecordevent"]));
    starts.push(...writeStarts(out, table, right, true, path, []));
  }

  /**
   * What one UI operation of a process test needs.
   * @param state { modes: Map(page key -> open mode), fresh: Set(page keys with a new record) }
   */
  function operation(op, state, out = collector()) {
    if (op.kind === "repeat" || op.kind === "dialog") {
      if (op.kind === "dialog" && op.page) {
        const page = pageNamed(op.page.name);
        if (page) {
          out.need(page, "execute", { reason: { code: "opened-page", page: label(page) }, path: [page.key] });
          trace(out, openPage(out, page));
        } else out.note("page-not-found", { page: op.page.name });
      }
      for (const child of op.steps ?? []) operation(child, state, out);
      return out.result();
    }
    if (!op.page) return out.result();
    const root = pageNamed(op.page.name);
    if (!root) {
      out.note("page-not-found", { page: op.page.name });
      return out.result();
    }
    const starts = [];
    if (op.kind === "open" || op.kind === "opened") {
      const ui = op.kind === "open";
      out.need(root, "execute", { ui, reason: { code: ui ? "open-page" : "opened-page", page: label(root) }, path: [root.key] });
      starts.push(...openPage(out, root));
      state.modes.set(root.key, op.mode);
      if (op.mode === "new") {
        state.fresh.add(root.key);
        editRecord(out, root, "insert", starts);
      }
    } else if (op.kind === "close") {
      for (const owner of withExtensions(root)) {
        for (const record of triggersOf(owner, ["onqueryclosepage", "onclosepage"])) starts.push({ record, path: [owner.key], inherents: [] });
      }
      starts.push(...pageEventStarts(out, root, ["onqueryclosepageevent", "onclosepageevent"]));
      state.modes.delete(root.key);
      state.fresh.delete(root.key);
    } else {
      const page = pageContext(out, root, op.sections);
      // A page of another app has no members here, but its extensions in the workspace do.
      const missing = (code, values) => page.externalSymbol ? out.note("symbols-only", { object: label(page) }) : out.note(code, { ...values, page: label(page) });
      if (page && op.kind === "new-line") {
        state.fresh.add(page.key);
        editRecord(out, page, "insert", starts);
      } else if (page && op.kind === "invoke") {
        starts.push(...pageEventStarts(out, page, ["onbeforeactionevent", "onafteractionevent"], op.member));
        const found = memberOf(page, op.member, "action");
        if (!found) missing("action-not-found", { action: op.member });
        else {
          const { owner, member } = found;
          const triggers = (recordsOf.get(owner.key) ?? []).filter(({ procedure }) =>
            procedure.kind === "trigger" && normalizeIdentifier(procedure.action) === normalizeIdentifier(member.name));
          starts.push(...triggers.map((record) => ({ record, path: [owner.key], inherents: [] })));
          const run = (member.properties ?? []).find(({ name }) => lower(name) === "runobject")?.value;
          const target = /^\s*(\w+)\s+(?:"((?:""|[^"])*)"|([\w.]+))/u.exec(run ?? "");
          const object = target ? resolver.object(lower(target[1]), (target[2] ?? target[3]).replaceAll('""', '"')) : undefined;
          if (object) starts.push(...runObject(out, object, [owner.key], [], { code: "run-object", action: member.name, object: label(page) }));
          else if (run) out.note("unresolved-run-object", { action: member.name, target: run.trim() });
          else if (!triggers.length) out.note("action-without-code", { action: member.name, page: label(page) });
        }
      } else if (page && ["set", "lookup", "drilldown", "assist-edit"].includes(op.kind)) {
        const found = memberOf(page, op.member, "field");
        if (op.kind === "set") starts.push(...pageEventStarts(out, page, ["onbeforevalidateevent", "onaftervalidateevent"], op.member));
        if (!found) missing("field-not-found", { field: op.member });
        if (found || page.externalSymbol) {
          const trigger = { set: "onvalidate", lookup: "onlookup", drilldown: "ondrilldown", "assist-edit": "onassistedit" }[op.kind];
          if (found?.member.location) starts.push(...triggersOf(found.owner, [trigger], found.member.location).map((record) => ({ record, path: [found.owner.key], inherents: [] })));
          // A field whose source is unknown (symbols) is taken as a field of the record.
          const table = ownTable(page);
          const field = found ? boundField(found.member.sourceExpression, found.owner, table) : undefined;
          if (op.kind === "set" && table && (field || !found)) {
            // A new record is inserted when its key is entered; what follows changes it.
            // With DelayedInsert the page inserts it complete, when the user leaves it.
            if (!(state.fresh.has(page.key) && delayedInsert(page))) editRecord(out, page, "modify", starts);
            if (field) starts.push(...validateStarts(out, table, field, [page.key], []));
          }
        }
      }
    }
    trace(out, starts);
    return out.result();
  }

  return {
    object: resolver.object,
    newState: () => ({ modes: new Map(), fresh: new Set() }),
    operation,
    objectOf: (key) => objects.get(key)
  };
}
