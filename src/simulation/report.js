// The battle test report for the terminal and as Markdown documentation:
// result, who can do what, findings, the fit-gap analysis, the processes,
// one card per agent, and what every step of every process test needs and why.
import { simulationText } from "./text.js";

const cell = (value) => value === undefined || value === null ? "" : String(value).replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
const table = (headers, rows) => rows.length ? [
  `| ${headers.map(cell).join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ""
] : [];

const MATRIX = {
  completed: "✅",
  blocked: "❌",
  unverified: "❔",
  "denied-as-expected": "🚫",
  "forbidden-possible": "⚠️",
  "forbidden-unverified": "❔",
  able: "○",
  unable: "–"
};
const MATRIX_TEXT = { completed: "ok", blocked: "BLOCKED", unverified: "?", "denied-as-expected": "denied", "forbidden-possible": "CAN", "forbidden-unverified": "?", able: "(can)", unable: "-" };

export function simulationResultLine(report) {
  const t = simulationText(report.language);
  const { assigned, forbidden } = report.summary;
  return `${report.passed ? t.line.passed : t.line.failed} - ${t.report.attemptCounts(assigned.completed, assigned.blocked, assigned.unverified)}`
    + `${forbidden.total ? `; ${t.report.forbiddenCounts(forbidden.denied, forbidden.possible, forbidden.unverified)}` : ""}`
    + `; ${t.report.counts(report.counts)} (${t.line.failOn(report.failOn)})`;
}

const agentLabel = ({ name, roles }) => roles?.length && !(roles.length === 1 && roles[0] === name) ? `${name} (${roles.join(", ")})` : name;

export function formatSimulationText(report) {
  const t = simulationText(report.language);
  const text = t.report;
  const { summary } = report;
  const lines = [report.title, ""];
  const pad = (label) => `  ${label.padEnd(38)}`;
  lines.push(
    `${pad(text.agents)}${summary.agents} (${text.roles}: ${summary.roles})`,
    `${pad(text.tasks)}${summary.tasks} (${report.tests})`,
    `${pad(text.attempts)}${text.attemptCounts(summary.assigned.completed, summary.assigned.blocked, summary.assigned.unverified)}`,
    ...(summary.forbidden.total ? [`${pad(text.forbidden)}${text.forbiddenCounts(summary.forbidden.denied, summary.forbidden.possible, summary.forbidden.unverified)}`] : []),
    `${pad(text.processes)}${text.processCounts(summary.processes.runs, summary.processes.total)}`,
    `${pad(text.requirements)}${text.requirementCounts(summary.requirements.fit, summary.requirements.total)}`,
    ""
  );

  // Process tests down, agents across: a company has more tasks than roles.
  lines.push(text.matrix);
  const names = report.matrix.rows.map((row) => row.agent);
  const width = Math.max(...report.matrix.tasks.map(({ id }) => id.length), 4) + 2;
  const columns = names.map((name) => Math.max(name.length, 7) + 2);
  lines.push(`  ${"".padEnd(width)}${names.map((name, index) => name.padEnd(columns[index])).join("")}`.trimEnd());
  for (const [index, task] of report.matrix.tasks.entries()) {
    lines.push(`  ${task.id.padEnd(width)}${report.matrix.rows.map(({ cells }, column) => MATRIX_TEXT[cells[index]].padEnd(columns[column])).join("")}`.trimEnd());
  }
  lines.push("");

  lines.push(text.processes);
  for (const process of report.processes) {
    lines.push(`  ${process.title}: ${t.process[process.status]}`);
    for (const step of process.steps) {
      const performers = step.performers.map(({ agent }) => agent).join(", ") || text.nobody;
      lines.push(`    ${t.taskStatus[step.status].padEnd(18)}${step.title} (${performers})`);
    }
  }
  lines.push("");

  lines.push(text.fitGap);
  const labelWidth = Math.max(...report.fitGap.requirements.map(({ label }) => label.length), 0) + 2;
  for (const requirement of report.fitGap.requirements) {
    lines.push(`  ${requirement.label.padEnd(labelWidth)}${report.fitGap.derived ? requirement.title : `${requirement.id} ${requirement.title}`}`);
  }
  lines.push("");

  lines.push(text.findings);
  const severityWidth = Math.max(...Object.values(t.severities).map((label) => label.length)) + 1;
  if (!report.findings.length) lines.push(`  ${text.noFindings}`);
  for (const item of report.findings) {
    lines.push(`  ${t.severities[item.severity].toUpperCase().padEnd(severityWidth)}${item.message}`);
    if (item.action) lines.push(`  ${"".padEnd(severityWidth)}-> ${item.action.replaceAll("`", "")}`);
  }
  lines.push("", simulationResultLine(report), "");
  return lines.join("\n");
}

/**
 * The report as one Markdown document.
 * @param options.marker start with the generated-file comment (files)
 * @param options.taskLink id => link target of a process test (default: its
 *   section in this document); with it, the sections carry no HTML anchors
 * @param options.lineBreak what separates several entries of a table cell
 */
export function formatSimulationMarkdown(report, { marker = false, taskLink, lineBreak = "<br>" } = {}) {
  const t = simulationText(report.language);
  const text = t.report;
  const { summary } = report;
  const taskTitle = new Map(report.tasks.map(({ id, title }) => [id, title]));
  const anchor = (id) => `[${taskTitle.get(id) ?? id}](${taskLink ? taskLink(id) : `#${id}`})`;
  const lines = [];
  if (marker) lines.push(text.marker, "");
  lines.push(`# ${report.title}`, "", text.intro, "");
  if (report.company.derived) lines.push(text.derived, "");
  lines.push(`**${text.result}: ${report.passed ? text.passed : text.failed}** (${text.counts(report.counts)})`, "");

  lines.push(`## ${text.summary}`, "", ...[
    [text.agents, `${summary.agents} (${text.roles}: ${summary.roles})`],
    [text.tasks, `${summary.tasks} (\`${report.tests}\`)`],
    [text.attempts, text.attemptCounts(summary.assigned.completed, summary.assigned.blocked, summary.assigned.unverified)],
    ...(summary.forbidden.total ? [[text.forbidden, text.forbiddenCounts(summary.forbidden.denied, summary.forbidden.possible, summary.forbidden.unverified)]] : []),
    [text.processes, text.processCounts(summary.processes.runs, summary.processes.total)],
    [text.requirements, text.requirementCounts(summary.requirements.fit, summary.requirements.total)]
  ].map(([label, value]) => `- **${label}:** ${value}`), "");

  lines.push(`## ${text.matrix}`, "", text.matrixIntro, "",
    ...table([text.task, ...report.matrix.rows.map((row) => agentLabel({ name: row.agent, roles: row.roles }))],
      report.matrix.tasks.map(({ id }, index) => [anchor(id), ...report.matrix.rows.map(({ cells }) => MATRIX[cells[index]])])),
    text.legend, "");

  lines.push(`## ${text.findings}`, "");
  if (!report.findings.length) lines.push(text.noFindings, "");
  lines.push(...table([text.severity, text.finding, text.todo], report.findings.map(({ severity, message, action }) => [t.severities[severity], message, action])));

  lines.push(`## ${text.fitGap}`, "", text.fitGapIntro, "");
  if (report.fitGap.derived) lines.push(text.fitGapDerived, "");
  lines.push(...table([text.requirement, text.status, text.coveredBy, text.todo], report.fitGap.requirements.map((requirement) => [
    report.fitGap.derived ? requirement.title : `**${requirement.id}** ${requirement.title}`,
    requirement.label,
    [...requirement.tasks.map(({ id, status }) => `${anchor(id)} (${t.taskStatus[status]})`), ...(requirement.objects ?? []).filter(({ object }) => object).map(({ object }) => object)].join(lineBreak),
    requirement.action
  ])));
  if (report.fitGap.untestedPages.length) {
    lines.push(`### ${text.untestedPages}`, "", text.untestedPagesIntro, "",
      ...report.fitGap.untestedPages.map(({ object, usageCategory }) => `- ${object} (${usageCategory})`), "");
  }
  if (report.fitGap.notRequired.length) {
    lines.push(`### ${text.notRequired}`, "", text.notRequiredIntro, "", ...report.fitGap.notRequired.map(({ task }) => `- ${anchor(task)}`), "");
  }

  lines.push(`## ${text.processes}`, "");
  for (const process of report.processes) {
    lines.push(`### ${process.title}: ${t.process[process.status]}`, "",
      `${text.processIntro(process.steps.length)}${process.handovers ? ` ${text.handovers(process.handovers)}.` : ""}`, "",
      ...table([text.step, text.task, text.performedBy, text.status], process.steps.map((step, index) => [
        index + 1,
        anchor(step.task),
        step.performers.map(({ agent, roles, outcome }) => `${agentLabel({ name: agent, roles })}: ${t.outcomes[outcome]}`).join(lineBreak) || text.nobody,
        t.taskStatus[step.status] + (step.waitsFor?.length ? ` (${step.waitsFor.map((id) => taskTitle.get(id) ?? id).join(", ")})` : "")
      ])));
  }

  lines.push(`## ${text.agentsTitle}`, "");
  const roles = new Map(report.roles.map((role) => [role.name, role]));
  for (const agent of report.agents) {
    lines.push(`### ${agentLabel(agent)}`, "");
    const descriptions = [agent.description, ...agent.roles.map((name) => roles.get(name)?.description)].filter(Boolean);
    if (descriptions.length) lines.push(descriptions.join(" "), "");
    lines.push(`- **${text.permissionSets}:** ${agent.permissionSets.map((set) =>
      `${set.name}${set.includedBy ? ` (${text.includes(set.includedBy)})` : ""}${set.unknown || set.inSource === false ? ` (${text.notInSource})` : ""}`).join(", ") || "–"}`);
    if (agent.taskGroups.length) lines.push(`- **${text.taskGroups}:** ${agent.taskGroups.join(", ")}`);
    lines.push("", ...table([text.task, text.expected, text.outcome, text.missing], agent.attempts.map((attempt) => [
      anchor(attempt.task),
      attempt.expected === "deny" ? text.expectDeny : text.expectComplete,
      `${attempt.expected === "deny" ? (attempt.outcome === "completed" ? "⚠️" : attempt.outcome === "unverified" ? "❔" : "🚫") : MATRIX[attempt.outcome]} ${t.outcomes[attempt.outcome]}${attempt.blockedAt ? ` (${text.step} ${attempt.blockedAt})` : ""}`,
      // What a forbidden task lacks is the reason it is denied, not a defect.
      attempt.missing.map(({ step, right, object, why, because }) => `${text.step} ${step}: ${t.need(t.rights[right], object)}: ${why}${because ? ` (${because})` : ""}`).join(lineBreak)
    ])));
    if (agent.alsoAble.length) lines.push(`**${text.alsoAble}:** ${agent.alsoAble.map(({ task }) => anchor(task)).join(", ")}`, "");
    if (agent.assumedPermissions?.length) {
      lines.push(`**${text.assumed}:** ${agent.assumedPermissions.map((line) => `\`${line}\``).join(", ")}. ${text.assumedIntro}`, "");
    }
    if (agent.unusedPermissions.length) {
      lines.push(`**${text.unused}:** ${agent.unusedPermissions.map(({ line }) => `\`${line}\``).join(", ")}. ${text.unusedIntro}`, "");
    }
  }

  lines.push(`## ${text.tasksTitle}`, "", text.tasksIntro, "");
  for (const task of report.tasks) {
    lines.push(`### ${taskLink ? "" : `<a id="${task.id}"></a>`}${task.title}`, "");
    if (task.goal && task.goal.replace(/[.\s]+$/u, "") !== task.title) lines.push(task.goal, "");
    lines.push(`- **${text.source}:** \`${task.source.file}\` (\`${task.source.procedure}\`)`);
    if (task.permissions.length) lines.push(`- **${text.namedSets}:** ${task.permissions.join(", ")}`);
    lines.push("", ...table([text.step, text.does, text.needs, text.because], task.steps.flatMap((step) => {
      const rows = step.needs.length
        ? step.needs.map((need, index) => [index ? "" : step.index, index ? "" : step.text, t.need(t.rights[need.right], need.object), need.because])
        : [[step.index, step.text, text.nothing, ""]];
      return [...rows, ...(step.notes ?? []).map((note) => ["", "", `*${text.notes}*`, note])];
    })));
  }

  lines.push(`## ${text.rules}`, "", ...text.ruleList.map((rule) => `- ${rule}`), "");
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim()}\n`;
}

export function renderSimulation(report, format = "text", options = {}) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return formatSimulationMarkdown(report, options);
  return formatSimulationText(report);
}
