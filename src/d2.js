import { resolveModel } from "./resolver.js";

const TYPE_STYLES = {
  table: ["#DCEBFF", "#2362A2"],
  tableextension: ["#DCEBFF", "#2362A2"],
  page: ["#E5F6E8", "#31783B"],
  pageextension: ["#E5F6E8", "#31783B"],
  pagecustomization: ["#E5F6E8", "#31783B"],
  codeunit: ["#FFF0D6", "#A96300"],
  report: ["#F5E5FF", "#77449A"],
  reportextension: ["#F5E5FF", "#77449A"],
  query: ["#E1F7F5", "#14766E"],
  xmlport: ["#FFE2E2", "#A23636"],
  enum: ["#EEEEEE", "#555555"],
  enumextension: ["#EEEEEE", "#555555"],
  interface: ["#FFF8C9", "#8B7400"],
  module: ["#E8ECF3", "#4E5D78"],
  procedure: ["#F3F6FA", "#55708F"],
  trigger: ["#FFF0D6", "#A96300"],
  event: ["#F5E5FF", "#77449A"],
  subscriber: ["#FCE8F3", "#A33A78"],
  action: ["#E5F6E8", "#31783B"]
};

const RELATION_STYLES = {
  calls: { color: "#4C78A8" },
  reads: { color: "#0072B2" },
  writes: { color: "#D55E00" },
  relates: { color: "#009E73" },
  uses: { color: "#6B7280", dash: 3 },
  extends: { color: "#CC79A7" },
  implements: { color: "#E69F00" },
  selects: { color: "#EA580C" },
  publishes: { color: "#A21CAF" },
  subscribes: { color: "#A21CAF", dash: 3 },
  runs: { color: "#15803D" },
  part: { color: "#0891B2", dash: 3 },
  contains: { color: "#0891B2", dash: 3 },
  permits: { color: "#7C3AED" },
  includes: { color: "#8B5CF6" },
  starts: { color: "#15803D" },
  events: { color: "#A21CAF", dash: 3 }
};

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function normalized(value) {
  return String(value).replace(/^"|"$/gu, "").trim().toLowerCase();
}

function uniqueRelations(relations) {
  const combined = new Map();
  for (const relation of relations) {
    const key =
      `${relation.from}|${relation.to}|${relation.kind}|${relation.access ?? ""}|` +
      `${relation.label ?? ""}|${relation.sequence ?? ""}|${relation.isCycle ?? ""}`;
    const existing = combined.get(key);
    if (existing) existing.weight = (existing.weight ?? 1) + (relation.weight ?? 1);
    else combined.set(key, { ...relation });
  }
  return [...combined.values()];
}

function roleFor(type) {
  if (["table", "tableextension"].includes(type)) return "Data";
  if (["page", "pageextension", "pagecustomization"].includes(type)) return "UI";
  if (["codeunit"].includes(type)) return "Services";
  if (["interface", "enum", "enumextension"].includes(type)) return "Contracts";
  if (["permissionset", "permissionsetextension", "entitlement"].includes(type)) return "Security";
  if (["report", "reportextension", "query", "xmlport"].includes(type)) {
    return "Reporting & Integration";
  }
  return "Other";
}

function groupFor(object, groupBy) {
  if (object.viewGroup) return object.viewGroup;
  if (groupBy === "type") return object.type;
  if (groupBy === "role") return roleFor(object.type);
  if (groupBy === "folder") {
    const parts = object.file.replaceAll("\\", "/").split("/");
    return parts.length > 1 ? parts[0] : "(root)";
  }
  return object.namespace;
}

function memberSummary(items, limit = 8) {
  const names = items.map(({ name }) => name).filter(Boolean);
  const shown = names.slice(0, limit);
  if (names.length > limit) shown.push(`+${names.length - limit} more`);
  return shown.join(", ");
}

function relationStyle(kind, sequence, isCycle) {
  const style = RELATION_STYLES[kind] ?? { color: "#64748B" };
  const properties = [`style.stroke: ${quote(isCycle ? "#B91C1C" : style.color)}`];
  if (style.dash || sequence === "inferred") {
    properties.push(`style.stroke-dash: ${style.dash ?? 4}`);
  }
  if (isCycle) properties.push("style.stroke-width: 3");
  return ` {${properties.join("; ")}}`;
}

export function renderD2(model, options = {}) {
  if (!model.edges) model = resolveModel(model);
  const direction = options.direction ?? "right";
  const includeExternal = options.includeExternal ?? true;
  const maxEdges = Number(options.maxEdges ?? 500);
  const lines = [
    `direction: ${direction}`,
    `title: ${quote(options.title ?? "AL architecture")} {`,
    "  shape: text",
    "  near: top-center",
    "  style.font-size: 28",
    "}",
    ""
  ];
  const nodes = new Map();
  const keyIndex = new Map();

  model.objects.forEach((object, index) => {
    const key = `n${index}`;
    nodes.set(object, key);
    keyIndex.set(object.key, object);
  });

  if (!model.objects.length && model.emptyMessage) {
    lines.push(`empty: ${quote(model.emptyMessage)} {`);
    lines.push("  shape: text");
    lines.push('  style.font-color: "#666666"');
    lines.push("}", "");
  }

  const namespaces = new Map();
  for (const object of model.objects) {
    const group = groupFor(object, options.groupBy ?? "namespace");
    const list = namespaces.get(group) ?? [];
    list.push(object);
    namespaces.set(group, list);
  }

  let groupIndex = 0;
  for (const [namespace, objects] of [...namespaces].sort(([a], [b]) => a.localeCompare(b))) {
    const group = `g${groupIndex++}`;
    lines.push(`${group}: ${quote(namespace)} {`);
    lines.push("  style.stroke-dash: 3");
    for (const object of objects.sort((a, b) => a.name.localeCompare(b.name))) {
      const key = nodes.get(object);
      const label = object.id
        ? `${object.type} ${object.id}\n${object.name}`
        : `${object.type}\n${object.name}`;
      const details = options.details
        ? [
            object.members?.length ? `${object.members.length} objects` : undefined,
            object.fields?.length ? `${object.fields.length} fields` : undefined,
            object.actions?.length ? `${object.actions.length} actions` : undefined,
            object.procedures?.length ? `${object.procedures.length} procedures` : undefined,
            options.memberNames && object.isFocus && object.fields?.length
              ? `Fields: ${memberSummary(object.fields)}`
              : undefined,
            options.memberNames && object.isFocus && object.actions?.length
              ? `Actions: ${memberSummary(object.actions)}`
              : undefined,
            options.memberNames && object.isFocus && object.procedures?.length
              ? `Procedures: ${memberSummary(object.procedures, 10)}`
              : undefined
          ].filter(Boolean)
        : [];
      const annotations = [
        object.workflowEntry ? "entry" : undefined,
        object.cycle ? `cycle ${object.cycle}` : undefined,
        object.shared ? `shared by ${object.shared} branches` : undefined
      ].filter(Boolean);
      const fullDetails = [...details, ...annotations];
      const fullLabel = fullDetails.length ? `${label}\n${fullDetails.join(" • ")}` : label;
      const [fill, stroke] = TYPE_STYLES[object.type] ?? ["#F5F5F5", "#666666"];
      lines.push(`  ${key}: ${quote(fullLabel)} {`);
      lines.push("    shape: rectangle");
      const source = object.location?.line
        ? `${object.file}:${object.location.line}`
        : object.file;
      if (source) lines.push(`    tooltip: ${quote(source)}`);
      if (options.sourceUrlTemplate && object.file) {
        const link = options.sourceUrlTemplate
          .replaceAll("{file}", object.file.replaceAll("\\", "/"))
          .replaceAll("{line}", String(object.location?.line ?? 1));
        lines.push(`    link: ${quote(link)}`);
      }
      lines.push(`    style.fill: ${quote(fill)}`);
      lines.push(`    style.stroke: ${quote(stroke)}`);
      if (object.type.endsWith("extension")) lines.push("    style.stroke-dash: 4");
      lines.push("  }");
    }
    lines.push("}", "");
    for (const object of objects) nodes.set(object, `${group}.${nodes.get(object)}`);
  }

  const external = new Map();
  const edges = [];
  for (const edge of model.edges.slice(0, maxEdges)) {
    const source = keyIndex.get(edge.from);
    const target = edge.to ? keyIndex.get(edge.to) : undefined;
    if (!source) continue;
    let targetKey = target ? nodes.get(target) : undefined;
    if (!targetKey && includeExternal && edge.unresolved) {
      const externalKey = `${edge.unresolved.type}:${normalized(edge.unresolved.name)}`;
      if (!external.has(externalKey)) external.set(externalKey, `external.e${external.size}`);
      targetKey = external.get(externalKey);
    }
    if (targetKey) {
      edges.push({
        from: nodes.get(source),
        to: targetKey,
        kind: edge.kind,
        access: edge.access,
        label: edge.label,
        weight: edge.weight,
        sequence: edge.sequence,
        isCycle: edge.isCycle
      });
    }
  }

  if (external.size) {
    lines.push(`external: ${quote("External / unresolved")} {`);
    lines.push("  style.stroke-dash: 5");
    for (const [lookup, key] of external) {
      const [type, ...nameParts] = lookup.split(":");
      const localKey = key.split(".")[1];
      lines.push(`  ${localKey}: ${quote(`${type}\n${nameParts.join(":")}`)} {`);
      lines.push(`    style.fill: ${quote("#FAFAFA")}`);
      lines.push(`    style.stroke: ${quote("#999999")}`);
      lines.push("  }");
    }
    lines.push("}", "");
  }

  for (const edge of uniqueRelations(edges)) {
    const arrow = edge.kind === "extends" || edge.kind === "implements" ? "-->" : "->";
    const relationLabel = edge.label ?? edge.kind;
    const certainty = edge.sequence ? ` [${edge.sequence}]` : "";
    const cycle = edge.isCycle ? " [cycle]" : "";
    const baseLabel =
      `${edge.access ? `${relationLabel} [${edge.access}]` : relationLabel}${certainty}${cycle}`;
    const label = edge.weight && edge.weight > 1
      ? `${baseLabel} (${edge.weight})`
      : baseLabel;
    lines.push(
      `${edge.from} ${arrow} ${edge.to}: ${quote(label)}${relationStyle(
        edge.kind,
        edge.sequence,
        edge.isCycle
      )}`
    );
  }

  if (model.edges.length > maxEdges) {
    lines.push("", `# ${model.edges.length - maxEdges} edges omitted by maxEdges=${maxEdges}`);
  }
  lines.push("");
  return lines.join("\n");
}
