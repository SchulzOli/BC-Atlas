// Simulates extracting one component of the target architecture as an app of
// its own: what moves, what the new app depends on, what blocks the split
// today, the app.json it needs, and the steps in order, including moving
// tables with their data (ObsoleteState = PendingMove/Moved, MovedTo and
// MovedFrom, Business Central 2024 release wave 2 / runtime 14.0 and later).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const TABLE_TYPES = new Set(["table", "tableextension"]);
const WRONG_WAY = new Set(["undeclared-component-dependency", "outward-dependency", "same-layer-dependency", "layer-skip-dependency"]);

function objectName(node) {
  return `${node.type} ${node.objectId ? `${node.objectId} ` : ""}${node.label}`;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const mostCommon = (values) => Object.keys(countBy(values.filter(Boolean), (value) => value))[0];

/** Object ID ranges for app.json: IDs at most `gap` apart share a range. */
export function idRanges(ids, gap = 100) {
  const sorted = [...new Set(ids.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const ranges = [];
  for (const id of sorted) {
    const last = ranges.at(-1);
    if (last && id - last.to <= gap) last.to = id;
    else ranges.push({ from: id, to: id });
  }
  return ranges;
}

function readManifest(app) {
  try {
    return JSON.parse(readFileSync(path.join(app.root, "app.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * A stable app ID for the extracted component (a name-based UUID, version 5):
 * the same plan, run again, names the same app in MovedTo and MovedFrom.
 */
export function extractedAppId(sourceAppId, component) {
  const bytes = createHash("sha1").update(`bc-atlas:${sourceAppId ?? ""}:${component}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function appReference(app) {
  return { id: app.id, name: app.name, publisher: app.publisher, version: app.version };
}

/**
 * @param assessment the result of assessArchitecture (with model and levels)
 * @param name the component to extract
 */
export function planExtraction(assessment, name) {
  const { result, levels, model } = assessment;
  const component = result.components.find((item) => item.name.toLowerCase() === String(name).toLowerCase());
  if (!component) throw new Error(`no component "${name}"; components: ${result.components.map((item) => item.name).join(", ")}`);
  const componentOf = result.assignment;
  const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
  const objects = new Map(model.objects.map((object) => [object.key, object]));
  const own = levels.object.nodes.filter((node) => node.origin === "workspace" && componentOf.get(node.id) === component.name);
  if (!own.length) throw new Error(`component ${component.name} has no objects in the analyzed source`);
  const ownIds = new Set(own.map(({ id }) => id));

  // Where the objects live today; the app that keeps the rest is the "source".
  const appOf = (node) => objects.get(node.id)?.app;
  const sourceApp = model.apps.find((app) => app.name === mostCommon(own.map((node) => appOf(node)?.name))) ?? model.apps[0];
  const othersInSource = levels.object.nodes.filter((node) => node.origin === "workspace" && !ownIds.has(node.id) && appOf(node)?.name === sourceApp?.name);
  const alreadyAnApp = othersInSource.length === 0;

  // Dependencies in both directions, per component.
  const uses = new Map();
  const usedBy = new Map();
  const internalUsedBy = [];
  const symbolApps = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const edge of levels.object.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;
    const from = componentOf.get(source.id);
    const to = componentOf.get(target.id);
    if (ownIds.has(source.id) && !ownIds.has(target.id)) {
      if (to) add(uses, to, target.id);
      else if (target.origin === "symbol") {
        const app = objects.get(target.id)?.app;
        if (app?.id) symbolApps.set(app.id, app);
      }
    }
    if (ownIds.has(target.id) && !ownIds.has(source.id) && source.origin === "workspace") {
      add(usedBy, from ?? "(no component)", source.id);
      if (target.access === "internal") internalUsedBy.push({ source: objectName(source), target: objectName(target), component: from ?? "(no component)" });
    }
  }
  const usesList = [...uses].map(([other, ids]) => ({ component: other, objects: ids.size })).sort((a, b) => b.objects - a.objects);
  const usedByList = [...usedBy].map(([other, ids]) => ({ component: other, objects: ids.size })).sort((a, b) => b.objects - a.objects);

  // What blocks the split today.
  const blockers = [];
  const outgoing = result.violations.filter((violation) => violation.sourceComponent === component.name && violation.rule !== "dependency-rule");
  const wrongWay = outgoing.filter(({ rule }) => WRONG_WAY.has(rule));
  if (wrongWay.length) {
    blockers.push({
      kind: "wrong-way-dependencies",
      message: `${wrongWay.length} dependenc${wrongWay.length === 1 ? "y points" : "ies point"} the wrong way; the new app could not declare them`,
      workItems: result.workItems.filter((item) => item.sourceComponent === component.name && WRONG_WAY.has(item.rule)).map(workItemSummary)
    });
  }
  const internal = outgoing.filter(({ rule }) => rule === "internal-access");
  if (internal.length) {
    blockers.push({
      kind: "uses-internal-objects",
      message: `${internal.length} use(s) of Access = Internal objects of other components; another app cannot see them`,
      workItems: result.workItems.filter((item) => item.sourceComponent === component.name && item.rule === "internal-access").map(workItemSummary)
    });
  }
  if (internalUsedBy.length) {
    blockers.push({
      kind: "internal-objects-used",
      message: `${internalUsedBy.length} use(s) of this component's Access = Internal objects from outside; make them public, or list the using apps in internalsVisibleTo`,
      uses: internalUsedBy.slice(0, 20)
    });
  }
  // Wrong-way dependencies of other components on this one: the new app could not be a dependency of theirs.
  const incoming = result.violations.filter((violation) => violation.targetComponent === component.name && WRONG_WAY.has(violation.rule));
  if (incoming.length) {
    blockers.push({
      kind: "wrong-way-dependencies-on-it",
      message: `${incoming.length} dependenc${incoming.length === 1 ? "y" : "ies"} of other components on ${component.name} point${incoming.length === 1 ? "s" : ""} the wrong way`,
      workItems: result.workItems.filter((item) => item.targetComponent === component.name && WRONG_WAY.has(item.rule)).map(workItemSummary)
    });
  }
  const cycle = usesList.filter(({ component: other }) => usedBy.has(other)).map(({ component: other }) => other);
  if (cycle.length) {
    blockers.push({
      kind: "mutual-dependency",
      message: `${component.name} and ${cycle.join(", ")} use each other; apps cannot depend on each other in a cycle`,
      components: cycle
    });
  }
  // Components that stay behind in the source app: if the new app uses some and others use it, the two apps form a cycle.
  const staysInSource = (other) => [...(uses.get(other) ?? usedBy.get(other) ?? [])].some((id) => appOf(nodes.get(id))?.name === sourceApp?.name);
  const usedInSource = usesList.map(({ component: other }) => other).filter((other) => !cycle.includes(other) && staysInSource(other));
  const usersInSource = usedByList.map(({ component: other }) => other).filter((other) => !cycle.includes(other) && staysInSource(other));
  if (!alreadyAnApp && usedInSource.length && usersInSource.length) {
    blockers.push({
      kind: "app-cycle",
      message: `${component.name} uses ${usedInSource.join(", ")} and is used by ${usersInSource.join(", ")}, which all stay in ${sourceApp?.name}; the two apps would depend on each other. Extract them too, or turn one direction around (move the code or the permission grants, or use an event or an interface)`,
      components: [...usedInSource, ...usersInSource]
    });
  }

  // The new app's manifest.
  const manifest = sourceApp ? readManifest(sourceApp) : {};
  const appId = extractedAppId(sourceApp?.id, component.name);
  const dependencies = new Map();
  for (const { component: other } of usesList) {
    for (const id of uses.get(other)) {
      const app = objects.get(id)?.app;
      if (app?.id) dependencies.set(app.id, app);
    }
  }
  for (const [id, app] of symbolApps) dependencies.set(id, app);
  const appJson = Object.fromEntries(Object.entries({
    id: appId,
    name: component.name,
    publisher: sourceApp?.publisher,
    version: "1.0.0.0",
    brief: component.description,
    dependencies: [...dependencies.values()].map(appReference).sort((a, b) => a.name.localeCompare(b.name)),
    platform: manifest.platform,
    application: manifest.application,
    runtime: manifest.runtime,
    target: manifest.target,
    idRanges: idRanges(own.map(({ objectId }) => objectId)),
    internalsVisibleTo: internalUsedBy.length && sourceApp ? [appReference(sourceApp)] : undefined,
    features: manifest.features
  }).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)));

  // Tables keep their data when they move between apps.
  const tables = alreadyAnApp ? [] : own.filter(({ type }) => TABLE_TYPES.has(type)).map((node) => ({
    object: objectName(node),
    file: node.file,
    line: node.line
  }));

  // Permission sets elsewhere that grant objects of this component, and the reverse.
  const grants = [];
  for (const edge of levels.object.edges) {
    if (!edge.kinds?.permits && !edge.kinds?.includes) continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;
    if (!ownIds.has(source.id) && ownIds.has(target.id)) grants.push({ permissionSet: objectName(source), component: componentOf.get(source.id) ?? "(no component)", direction: "grants this component's objects" });
  }
  const grantList = [...new Map(grants.map((grant) => [grant.permissionSet, grant])).values()];

  const files = [...new Set(own.map(({ file }) => file).filter(Boolean))].sort();
  const mixedFiles = files.filter((file) => levels.object.nodes.some((node) => node.file === file && !ownIds.has(node.id) && node.origin === "workspace"));
  const steps = [];
  if (alreadyAnApp) {
    steps.push(`${component.name} is already an app of its own (${sourceApp?.name}); resolve the blockers below so it stays independent.`);
  } else {
    if (blockers.length) steps.push(`Resolve the ${blockers.length} blocker(s) first (bca architecture lists the work items; bca refactor move applies the moves).`);
    steps.push(`Create the app folder ${component.name} with the app.json below (dependencies, ID ranges${appJson.internalsVisibleTo ? ", internalsVisibleTo" : ""}).`);
    if (mixedFiles.length) steps.push(`Split ${mixedFiles.length} file(s) that also hold objects of other components (bca refactor move does this per object).`);
    steps.push(`Move ${files.length} file(s) with ${own.length} object(s) into it; keep object IDs and namespaces.`);
    if (tables.length) {
      steps.push(`Move the data of ${tables.length} table(s) and table extension(s): in ${sourceApp?.name}, set ObsoleteState = PendingMove and MovedTo = '${appId}'; in ${component.name}, set MovedFrom = '${sourceApp?.id}' (runtime 14.0, Business Central 2024 release wave 2 or later). Release both apps, then set ObsoleteState = Moved.`);
    }
    if (usedByList.length) {
      const users = new Map();
      for (const { component: other } of usedByList) {
        for (const id of usedBy.get(other)) {
          const app = appOf(nodes.get(id))?.name ?? "?";
          if (!users.has(app)) users.set(app, new Set());
          users.get(app).add(other);
        }
      }
      steps.push(`Add ${component.name} to the dependencies of the app(s) that use it: ${[...users].map(([app, list]) => `${app} (${[...list].join(", ")})`).join(", ")}.`);
    }
    if (grantList.length) steps.push(`Move ${grantList.length} permission set grant(s) for its objects into a permission set or permission set extension of ${component.name}.`);
    steps.push("Compile both apps (AL: Package, or bca check with the AL compiler) and run bca check; the architecture should report no new violations.");
  }

  const effort = [...[...outgoing, ...incoming].reduce((set, violation) => set.add(violation.resolution.effort), new Set())];
  // Cycles and internal objects used from outside have no single work item; resolving them means moving code.
  if (blockers.some(({ kind }) => ["mutual-dependency", "app-cycle", "internal-objects-used"].includes(kind))) effort.push("M");
  return {
    schema: "bc-atlas.extraction",
    component: component.name,
    layer: component.layer,
    ready: blockers.length === 0,
    alreadyAnApp,
    sourceApp: sourceApp ? { name: sourceApp.name, id: sourceApp.id } : undefined,
    objects: { total: own.length, byType: countBy(own, ({ type }) => type), files: files.length, mixedFiles },
    uses: usesList,
    usedBy: usedByList,
    blockers,
    effort: effort.includes("L") ? "large" : effort.includes("M") ? "medium" : effort.length ? "small" : "none",
    appJson,
    tables,
    permissionSets: grantList,
    steps
  };
}

function workItemSummary(item) {
  return {
    strategy: item.strategy,
    title: item.title,
    effort: item.effort,
    source: `${item.source.type} ${item.source.label}`,
    targetComponent: item.targetComponent,
    dependencies: item.violations,
    ...(item.command ? { command: item.command } : {})
  };
}

const count = (value, singular, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;

export function formatExtractionText(plan) {
  const lines = [`BC Atlas extraction plan - ${plan.component}`, ""];
  lines.push(`  ${count(plan.objects.total, "object")} in ${count(plan.objects.files, "file")} (${Object.entries(plan.objects.byType).map(([type, total]) => `${type} ${total}`).join(", ")})`);
  lines.push(`  Today in ${plan.sourceApp?.name ?? "?"}${plan.alreadyAnApp ? " (already its own app)" : ""}`);
  lines.push(`  Uses: ${plan.uses.map(({ component, objects }) => `${component} (${objects})`).join(", ") || "nothing else"}`);
  lines.push(`  Used by: ${plan.usedBy.map(({ component, objects }) => `${component} (${objects})`).join(", ") || "nothing else"}`);
  lines.push(`  ${plan.ready ? "Ready to extract" : `Blocked by ${count(plan.blockers.length, "issue")}`}; effort ${plan.effort}`, "");
  if (plan.blockers.length) {
    lines.push("Blockers");
    for (const blocker of plan.blockers) {
      lines.push(`  - ${blocker.message}`);
      for (const item of (blocker.workItems ?? []).slice(0, 5)) lines.push(`      [${item.effort}] ${item.title}: ${item.source} -> ${item.targetComponent}${item.command ? `  (${item.command})` : ""}`);
    }
    lines.push("");
  }
  lines.push("Steps");
  plan.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  lines.push("", "app.json", ...JSON.stringify(plan.appJson, null, 2).split("\n").map((line) => `  ${line}`));
  return `${lines.join("\n")}\n`;
}

export function formatExtractionMarkdown(plan) {
  const lines = [`# Extract ${plan.component} as an app`, ""];
  lines.push(`${count(plan.objects.total, "object")} in ${count(plan.objects.files, "file")}, today in ${plan.sourceApp?.name ?? "?"}${plan.alreadyAnApp ? " (already its own app)" : ""}. ` +
    `${plan.ready ? "**Ready to extract.**" : `**Blocked by ${count(plan.blockers.length, "issue")}.**`} Effort: ${plan.effort}.`, "");
  lines.push("| Uses | Objects |", "| --- | ---: |", ...plan.uses.map(({ component, objects }) => `| ${component} | ${objects} |`), "");
  lines.push("| Used by | Objects |", "| --- | ---: |", ...plan.usedBy.map(({ component, objects }) => `| ${component} | ${objects} |`), "");
  if (plan.blockers.length) {
    lines.push("## Blockers", "");
    for (const blocker of plan.blockers) {
      lines.push(`- ${blocker.message}`);
      for (const item of (blocker.workItems ?? []).slice(0, 10)) lines.push(`  - **${item.title}** (\`${item.strategy}\`, ${item.effort}): ${item.source} → ${item.targetComponent}${item.command ? ` — \`${item.command}\`` : ""}`);
      for (const use of (blocker.uses ?? []).slice(0, 10)) lines.push(`  - ${use.source} (${use.component}) uses ${use.target}`);
    }
    lines.push("");
  }
  lines.push("## Steps", "", ...plan.steps.map((step, index) => `${index + 1}. ${step}`), "");
  if (plan.tables.length) {
    lines.push("## Tables that move with their data", "", ...plan.tables.map(({ object, file, line }) => `- ${object} (\`${file}:${line}\`)`), "");
  }
  if (plan.permissionSets.length) {
    lines.push("## Permission sets to split", "", ...plan.permissionSets.map(({ permissionSet, component }) => `- ${permissionSet} (${component})`), "");
  }
  lines.push("## app.json", "", "```json", JSON.stringify(plan.appJson, null, 2), "```", "");
  return lines.join("\n");
}
