import { FAIL_LEVELS, SEVERITIES } from "./capabilities.js";

const SEVERITY_RANK = { error: 3, warning: 2, info: 1 };

function positive(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

export function objectLabel(object) {
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

// Wrong-way dependencies share one finding rule; the violation names the exact rule.
const DIRECTION_RULES = new Set(["undeclared-component-dependency", "outward-dependency", "same-layer-dependency", "layer-skip-dependency"]);

function violationMessage({ violation, count, targets }) {
  const { source, sourceComponent, targetComponent, resolution } = violation;
  const what = `${source.type} ${source.label} (${sourceComponent})`;
  const fix = `${resolution.title.toLowerCase()} (${resolution.strategy})`;
  if (violation.rule === "dependency-rule") {
    return `${what} breaks rule "${violation.policy}": ${violation.message ?? `depends on ${targets}`}${violation.message ? ` (${targets})` : ""}`;
  }
  if (violation.rule === "internal-access") {
    return `${what} uses ${count} internal object(s) of ${targetComponent} (${targets}); ${fix}`;
  }
  if (violation.rule === "layer-skip-dependency") {
    return `${what} skips a layer: it depends on ${count} object(s) in ${targetComponent}; ${fix}`;
  }
  return `${what} depends on ${count} object(s) in ${targetComponent}; ${fix}`;
}

/**
 * Findings for the target architecture: one per work item that is not in the
 * baseline, progress notes for accepted and fixed violations, and the checks
 * of the architecture as a whole (cycles, configuration, size, stability).
 */
function architectureFindings({ result, baseline, architecture }) {
  const severity = architecture.severity ?? "error";
  if (!SEVERITIES.includes(severity)) throw new Error(`architecture.severity must be one of: ${SEVERITIES.join(", ")}`);
  const findings = [];
  const fresh = new Set(baseline.new.map(({ id }) => id));
  const items = new Map();
  for (const violation of result.violations.filter(({ id }) => fresh.has(id))) {
    const key = `${violation.source.id}|${violation.targetComponent}|${violation.rule}|${violation.policy ?? ""}`;
    const item = items.get(key) ?? { violation, count: 0, names: [] };
    item.count++;
    if (item.names.length < 3) item.names.push(`${violation.target.type} ${violation.target.label}`);
    items.set(key, item);
  }
  for (const { violation, count, names } of items.values()) {
    const targets = `${names.join(", ")}${count > names.length ? `, +${count - names.length} more` : ""}`;
    const rule = DIRECTION_RULES.has(violation.rule) ? "architecture-violation" : violation.rule;
    findings.push(finding(violation.severity ?? severity, rule, violationMessage({ violation, count, targets }), {
      file: violation.evidence[0]?.file ?? violation.source.file,
      line: violation.evidence[0]?.line ?? violation.source.line,
      strategy: violation.resolution.strategy,
      violation: violation.rule,
      ...(violation.policy ? { policy: violation.policy } : {}),
      component: violation.sourceComponent,
      targetComponent: violation.targetComponent
    }));
  }
  if (baseline.known.length) {
    findings.push(finding("info", "architecture-baseline", `${baseline.known.length} accepted architecture violation(s) remain in the baseline`));
  }
  if (baseline.fixed.length) {
    findings.push(finding("info", "architecture-progress",
      `${baseline.fixed.length} accepted architecture violation(s) are fixed; run "bca architecture --update-baseline" to lock in the progress`));
  }
  for (const { rule, severity: level, message, component, file, line } of result.checks ?? []) {
    findings.push(finding(level, rule, message, Object.fromEntries(Object.entries({ component, file, line }).filter(([, value]) => value !== undefined))));
  }
  return findings;
}

/**
 * Builds a health report for a project-view architecture model.
 * Thresholds come from CLI options or the `check` section of .bca.json.
 */
export function assessHealth(model, settings = {}) {
  const failOn = settings.failOn ?? "error";
  if (!FAIL_LEVELS.includes(failOn)) throw new Error(`fail-on must be one of: ${FAIL_LEVELS.join(", ")}`);
  const maxFanIn = positive(settings.maxFanIn, "max-fan-in", 25);
  const maxFanOut = positive(settings.maxFanOut, "max-fan-out", 25);
  const cycleSeverity = settings.cycles ?? "warning";
  if (![...SEVERITIES, "off"].includes(cycleSeverity)) {
    throw new Error(`check.cycles must be one of: ${[...SEVERITIES, "off"].join(", ")}`);
  }

  const objects = model.objects.filter(({ externalSymbol, boundaryCategory }) => !externalSymbol && !boundaryCategory);
  const byKey = new Map(model.objects.map((object) => [object.key, object]));
  const internal = new Set(objects.map(({ key }) => key));
  const findings = [];

  // BC Atlas's own info diagnostics are noise; the AL compiler's are findings.
  for (const diagnostic of model.diagnostics.filter(({ severity, origin }) => severity !== "info" || origin === "al")) {
    const al = diagnostic.origin === "al";
    findings.push(finding(al ? diagnostic.severity : diagnostic.severity === "error" ? "error" : "warning", diagnostic.code,
      al ? `${diagnostic.code}: ${diagnostic.message}` : diagnostic.message, Object.fromEntries(Object.entries({
        file: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.column,
        endLine: diagnostic.endLine,
        endColumn: diagnostic.endColumn,
        helpLink: diagnostic.helpLink,
        origin: diagnostic.origin
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
  const unresolved = model.edges.filter(({ to }) => !to);
  if (unresolved.length) {
    const targets = [...new Set(unresolved.map(({ unresolved: target }) =>
      target ? `${target.type ?? "object"} ${target.name}` : "unknown"))].sort();
    findings.push(finding("info", "unresolved-references",
      `${unresolved.length} reference(s) to ${targets.length} external or unresolved target(s); add .alpackages symbols to resolve them`,
      { targets }));
  }

  if (settings.architecture) findings.push(...architectureFindings(settings.architecture, model));

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
    thresholds: { maxFanIn, maxFanOut, cycles: cycleSeverity },
    summary: {
      apps: (model.apps ?? []).map(({ name, publisher, version }) => ({ name, publisher, version })),
      files: model.files,
      objects: objects.length,
      relationships: model.edges.length,
      unresolved: unresolved.length,
      cycles: model.insights?.cycles?.length ?? 0,
      objectsByType: countBy(objects, ({ type }) => type),
      relationshipsByKind: countBy(model.edges, ({ kind }) => kind),
      ...(model.al ? { compiler: compilerSummary(model.al) } : {})
    },
    counts,
    hubs,
    findings
  };
}

function list(counts) {
  return Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(", ") || "none";
}

function appLine(summary) {
  return summary.apps.map(({ name, version }) => version ? `${name} ${version}` : name).join(", ") || "AL project";
}

function compilerSummary(al) {
  return Object.fromEntries(Object.entries({
    tool: al.description,
    projects: al.projects?.length,
    failedProjects: al.projects?.filter(({ succeeded }) => !succeeded).map(({ name }) => name),
    diagnostics: al.diagnostics,
    imported: al.imported || undefined,
    resolvedCalls: al.calls?.resolved,
    builtinCalls: al.calls?.builtin
  }).filter(([, value]) => value !== undefined));
}

/** One line on what the AL toolchain contributed, for text and Markdown reports. */
export function compilerLine(compiler) {
  if (!compiler) return undefined;
  const parts = [];
  if (compiler.tool) {
    const failed = compiler.failedProjects?.length ? `, ${compiler.failedProjects.length} with errors` : "";
    parts.push(`${compiler.tool}: ${compiler.projects} project(s) compiled${failed}`);
  }
  if (compiler.resolvedCalls !== undefined) parts.push(`${compiler.resolvedCalls} call(s) resolved by the compiler`);
  if (compiler.imported) parts.push("diagnostics imported from an error log");
  parts.push(`${compiler.diagnostics} compiler diagnostic(s)`);
  return parts.join("; ");
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
    ...(summary.compiler ? [`  AL compiler    ${compilerLine(summary.compiler)}`] : []),
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
    lines.push(`  ${labels[item.severity]}  ${item.message}${location}`);
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
    ...(summary.compiler ? [`| AL compiler | ${escapeCell(compilerLine(summary.compiler))} |`] : []),
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
    lines.push("| Severity | Rule | Finding |", "| --- | --- | --- |");
    for (const item of report.findings.slice(0, limit)) {
      const location = item.file ? ` (\`${item.file}${item.line ? `:${item.line}` : ""}\`)` : "";
      lines.push(`| ${icon[item.severity]} | \`${item.rule}\` | ${escapeCell(item.message)}${location} |`);
    }
    if (report.findings.length > limit) lines.push(`| | | ${report.findings.length - limit} more finding(s) |`);
    lines.push("");
  } else {
    lines.push("No findings.", "");
  }
  return `${lines.join("\n")}`;
}
