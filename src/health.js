import { appKey } from "./graph/lenses/dependency.js";
import { qualityFindings } from "./quality-rules.js";
import { FAIL_LEVELS, SEVERITIES } from "./capabilities.js";
import { analyzeContractFallbacks } from "./contract-analysis.js";
import { analyzeContextResponsibilities } from "./context-analysis.js";

const SEVERITY_RANK = { error: 3, warning: 2, info: 1 };

function positive(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function objectLabel(object) {
  if (!object) return "unknown object";
  return [object.type, object.id, object.name].filter(Boolean).join(" ");
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)));
}

function distinctDegrees(model, internal) {
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of model.edges) {
    if (!edge.to || edge.from === edge.to) continue;
    if (!internal.has(edge.from) || !internal.has(edge.to)) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Set());
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    outgoing.get(edge.from).add(edge.to);
    incoming.get(edge.to).add(edge.from);
  }
  return { incoming, outgoing };
}

function finding(severity, rule, message, details = {}) {
  return { severity, rule, message, ...details };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * An app that uses another without naming it in the `dependencies` of its
 * app.json: the AL compiler does not build it. One finding per pair of apps,
 * on the first place that uses the other app.
 * @param levels what depends on what (projectLevels of src/project.js)
 */
function undeclaredDependencies(levels, model, severity) {
  if (!levels?.app || severity === "off") return [];
  const apps = new Map(levels.app.nodes.map((node) => [node.id, node]));
  const manifests = new Map((model.apps ?? []).map((app) => [appKey(app), app.path]));
  const findings = [];
  for (const edge of levels.app.edges.filter(({ dependency }) => dependency === "undeclared")) {
    const [from, to] = [apps.get(edge.source), apps.get(edge.target)];
    if (!from || !to || from.origin !== "workspace") continue;
    const uses = levels.object.edges.filter(({ sourceApp, targetApp, dependency }) =>
      sourceApp === edge.source && targetApp === edge.target && dependency === "undeclared");
    const evidence = uses.flatMap(({ evidence: items }) => items ?? []).find(({ file, line }) => file && line !== undefined);
    const objects = [...new Set(uses.map(({ source }) => levels.object.nodes.find(({ id }) => id === source)?.label).filter(Boolean))].sort();
    findings.push(finding(severity, "undeclared-app-dependency",
      `${from.label} uses ${to.label} (${plural(edge.weight ?? edge.objectEdges, "relation")}) without naming it in the dependencies of its app.json`, {
        fix: `Add ${to.label} to "dependencies" in ${manifests.get(edge.source) ?? `the app.json of ${from.label}`}, or remove the use.`,
        app: from.label,
        dependency: to.label,
        objects,
        manifest: manifests.get(edge.source),
        ...(evidence ? { file: evidence.file, line: evidence.line } : {})
      }));
  }
  return findings;
}

/**
 * Builds a health report for the model of a project (src/project.js).
 * Thresholds come from CLI options or the `check` section of .bca.json.
 * @param context { levels }: what depends on what, for the rules about apps
 */
export function assessHealth(model, settings = {}, { levels } = {}) {
  const failOn = settings.failOn ?? "error";
  if (!FAIL_LEVELS.includes(failOn)) throw new Error(`fail-on must be one of: ${FAIL_LEVELS.join(", ")}`);
  const maxFanIn = positive(settings.maxFanIn, "max-fan-in", 25);
  const maxFanOut = positive(settings.maxFanOut, "max-fan-out", 25);
  const cycleSeverity = settings.cycles ?? "warning";
  if (![...SEVERITIES, "off"].includes(cycleSeverity)) {
    throw new Error(`check.cycles must be one of: ${[...SEVERITIES, "off"].join(", ")}`);
  }
  const undeclaredSeverity = settings.undeclaredDependencies ?? "warning";
  if (![...SEVERITIES, "off"].includes(undeclaredSeverity)) {
    throw new Error(`check.undeclaredDependencies must be one of: ${[...SEVERITIES, "off"].join(", ")}`);
  }

  const objects = model.objects.filter(({ externalSymbol, boundaryCategory }) => !externalSymbol && !boundaryCategory);
  const byKey = new Map(model.objects.map((object) => [object.key, object]));
  const internal = new Set(objects.map(({ key }) => key));
  const findings = [];

  // Info diagnostics are noise in a health report.
  for (const diagnostic of model.diagnostics.filter(({ severity }) => severity !== "info")) {
    findings.push(finding(diagnostic.severity === "error" ? "error" : "warning", diagnostic.code,
      diagnostic.message, Object.fromEntries(Object.entries({
        file: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.column,
        endLine: diagnostic.endLine,
        endColumn: diagnostic.endColumn
      }).filter(([, value]) => value !== undefined))));
  }

  if (cycleSeverity !== "off") {
    for (const cycle of model.insights?.cycles ?? []) {
      const names = cycle.map((key) => objectLabel(byKey.get(key)));
      findings.push(finding(cycleSeverity, "dependency-cycle", `Dependency cycle: ${names.join(" -> ")} -> ${names[0]}`, {
        objects: names
      }));
    }
  }

  const { incoming, outgoing } = distinctDegrees(model, internal);
  for (const [key, sources] of incoming) {
    if (sources.size > maxFanIn) {
      findings.push(finding("warning", "high-fan-in",
        `${objectLabel(byKey.get(key))} is used by ${sources.size} objects (limit ${maxFanIn})`, { object: objectLabel(byKey.get(key)) }));
    }
  }
  for (const [key, targets] of outgoing) {
    if (targets.size > maxFanOut) {
      findings.push(finding("warning", "high-fan-out",
        `${objectLabel(byKey.get(key))} depends on ${targets.size} objects (limit ${maxFanOut})`, { object: objectLabel(byKey.get(key)) }));
    }
  }

  const orphans = (model.insights?.orphans ?? []).filter((key) => internal.has(key)).map((key) => objectLabel(byKey.get(key)));
  if (orphans.length) {
    findings.push(finding("info", "orphan-objects",
      `${orphans.length} object(s) without relationships: ${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? ", ..." : ""}`,
      { objects: orphans }));
  }
  const unresolved = model.edges.filter(({ to, wildcard }) => !to && !wildcard);
  if (unresolved.length) {
    const targets = [...new Set(unresolved.map(({ unresolved: target }) =>
      target ? `${target.type ?? "object"} ${target.name}` : "unknown"))].sort();
    findings.push(finding("info", "unresolved-references",
      `${unresolved.length} reference(s) to ${targets.length} external or unresolved target(s); add .alpackages symbols to resolve them`,
      { targets }));
  }

  findings.push(...undeclaredDependencies(levels, model, undeclaredSeverity));
  findings.push(...analyzeContractFallbacks(model, settings.contractExpectations));
  const contextResponsibilities = analyzeContextResponsibilities(model, settings.contexts);
  findings.push(...contextResponsibilities.findings);
  // Documentation of the public API (what the AL analyzers do not check).
  findings.push(...qualityFindings(objects, settings));

  findings.sort((left, right) =>
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.rule.localeCompare(right.rule) ||
    left.message.localeCompare(right.message)
  );
  const counts = { error: 0, warning: 0, info: 0 };
  for (const item of findings) counts[item.severity]++;
  const threshold = SEVERITY_RANK[failOn] ?? Infinity;
  const failing = findings.filter(({ severity }) => SEVERITY_RANK[severity] >= threshold);
  const hubs = objects
    .map((object) => ({
      object: objectLabel(object),
      incoming: incoming.get(object.key)?.size ?? 0,
      outgoing: outgoing.get(object.key)?.size ?? 0
    }))
    .map((item) => ({ ...item, total: item.incoming + item.outgoing }))
    .filter(({ total }) => total > 0)
    .sort((left, right) => right.total - left.total || left.object.localeCompare(right.object))
    .slice(0, 10);

  return {
    schemaVersion: 1,
    passed: failing.length === 0,
    failOn,
    thresholds: { maxFanIn, maxFanOut, cycles: cycleSeverity, undeclaredDependencies: undeclaredSeverity },
    summary: {
      apps: (model.apps ?? []).map(({ name, publisher, version }) => ({ name, publisher, version })),
      files: model.files,
      objects: objects.length,
      relationships: model.edges.length,
      unresolved: unresolved.length,
      cycles: model.insights?.cycles?.length ?? 0,
      objectsByType: countBy(objects, ({ type }) => type),
      relationshipsByKind: countBy(model.edges, ({ kind }) => kind)
    },
    counts,
    hubs,
    findings,
    ...(settings.contexts !== undefined ? { contextResponsibilities } : {})
  };
}

function list(counts) {
  return Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(", ") || "none";
}

function appLine(summary) {
  return summary.apps.map(({ name, version }) => version ? `${name} ${version}` : name).join(", ") || "AL project";
}

const MAX_DISPLAY_EVIDENCE = 5;

function evidenceLocation(item) {
  return item.file ? `${item.file}${item.line ? `:${item.line}` : ""}` : undefined;
}

function evidenceDescription(item) {
  const details = [item.kind, item.operation, item.member].filter(Boolean);
  return details.length ? `${details.join(" ")} (${evidenceLocation(item) ?? "location unavailable"})` : evidenceLocation(item);
}

function primaryEvidenceOf(item) {
  return item.primaryEvidence ?? item.evidence?.find(({ file, line }) => file && line !== undefined);
}

function sameEvidence(left, right) {
  return left === right || Boolean(left && right &&
    left.file === right.file && left.line === right.line &&
    left.kind === right.kind && left.operation === right.operation && left.member === right.member);
}

function supportingEvidence(item) {
  const primary = primaryEvidenceOf(item);
  const evidence = item.evidence ?? [];
  const primaryIndex = evidence.findIndex((item) => sameEvidence(item, primary));
  return evidence.filter((_, index) => index !== primaryIndex);
}

function evidenceSummary(item, { markdown = false } = {}) {
  const primary = primaryEvidenceOf(item);
  const support = supportingEvidence(item);
  const shown = support.slice(0, Math.max(0, MAX_DISPLAY_EVIDENCE - (primary ? 1 : 0)));
  const omitted = Math.max(0, support.length - shown.length);
  const label = (value) => markdown ? `\`${escapeCell(value)}\`` : value;
  return [
    ...(primary && evidenceLocation(primary) ? [`Primary location: ${label(evidenceLocation(primary))}`] : []),
    ...(shown.length ? [`Supporting locations: ${shown.map(evidenceDescription).filter(Boolean).map(label).join(", ")}`] : []),
    ...(omitted ? [`${omitted} additional evidence item(s) omitted; use JSON for all evidence`] : []),
    ...(item.limitations?.length
      ? [`Limitations: ${markdown ? escapeCell(item.limitations.join("; ")) : item.limitations.join("; ")}`]
      : [])
  ];
}

export function healthResultLine(report) {
  const { counts } = report;
  return `Result: ${report.passed ? "PASSED" : "FAILED"} - ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info (fail on: ${report.failOn})`;
}

export function formatHealthText(report, { limit = 50 } = {}) {
  const { summary } = report;
  const labels = { error: "ERROR", warning: "WARN ", info: "INFO " };
  const lines = [
    `BC Atlas health check - ${appLine(summary)}`,
    "",
    `  Files          ${summary.files}`,
    `  Objects        ${summary.objects} (${list(summary.objectsByType)})`,
    `  Relationships  ${summary.relationships} (${list(summary.relationshipsByKind)})`,
    `  Unresolved     ${summary.unresolved}`,
    `  Cycles         ${summary.cycles}`,
    ""
  ];
  if (report.hubs.length) {
    lines.push("Most connected objects");
    for (const hub of report.hubs.slice(0, 5)) {
      lines.push(`  ${hub.object.padEnd(48)} in ${String(hub.incoming).padStart(3)}  out ${String(hub.outgoing).padStart(3)}`);
    }
    lines.push("");
  }
  lines.push(report.findings.length ? "Findings" : "Findings: none");
  for (const item of report.findings.slice(0, limit)) {
    const location = item.file ? ` (${item.file}${item.line ? `:${item.line}` : ""})` : "";
    const metadata = item.basis
      ? ` [basis: ${item.basis}]`
      : "";
    lines.push(`  ${labels[item.severity]}  ${item.message}${location}${metadata}`);
    for (const detail of evidenceSummary(item)) lines.push(`      ${detail}`);
  }
  if (report.findings.length > limit) {
    lines.push(`  ... ${report.findings.length - limit} more; use --format json for the full list`);
  }
  lines.push("", healthResultLine(report));
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
}

export function formatHealthMarkdown(report, { heading = "## Architecture health", limit = 100 } = {}) {
  const { summary, counts } = report;
  const icon = { error: "Error", warning: "Warning", info: "Info" };
  const lines = [
    heading,
    "",
    `**${report.passed ? "Passed" : "Failed"}** - ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info. Fails on: \`${report.failOn}\`.`,
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Apps | ${escapeCell(appLine(summary))} |`,
    `| Files | ${summary.files} |`,
    `| Objects | ${summary.objects} |`,
    `| Relationships | ${summary.relationships} |`,
    `| Unresolved references | ${summary.unresolved} |`,
    `| Dependency cycles | ${summary.cycles} |`,
    ""
  ];
  if (Object.keys(summary.objectsByType).length) {
    lines.push("| Object type | Count |", "| --- | --- |");
    for (const [type, count] of Object.entries(summary.objectsByType)) lines.push(`| ${type} | ${count} |`);
    lines.push("");
  }
  if (report.hubs.length) {
    lines.push("**Most connected objects**", "", "| Object | Used by | Depends on |", "| --- | --- | --- |");
    for (const hub of report.hubs) lines.push(`| ${escapeCell(hub.object)} | ${hub.incoming} | ${hub.outgoing} |`);
    lines.push("");
  }
  if (report.findings.length) {
    lines.push("| Severity | Rule | Finding | Evidence |", "| --- | --- | --- | --- |");
    for (const item of report.findings.slice(0, limit)) {
      const location = item.file ? ` (\`${escapeCell(`${item.file}${item.line ? `:${item.line}` : ""}`)}\`)` : "";
      const metadata = item.basis
        ? `<br>Basis: \`${item.basis}\``
        : "";
      const evidence = evidenceSummary(item, { markdown: true }).join("<br>");
      lines.push(`| ${icon[item.severity]} | \`${item.rule}\` | ${escapeCell(item.message)}${location}${metadata} | ${evidence} |`);
    }
    if (report.findings.length > limit) lines.push(`| | | ${report.findings.length - limit} more finding(s) | |`);
    lines.push("");
  } else {
    lines.push("No findings.", "");
  }
  return `${lines.join("\n")}`;
}
