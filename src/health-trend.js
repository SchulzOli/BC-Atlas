// The trend of a health report: what changed since an earlier report of
// `bca check --format json` (new and fixed findings, counts, and metrics).

const METRICS = ["files", "objects", "relationships", "unresolved", "cycles"];
const SEVERITIES = ["error", "warning", "info"];

function change(before, after) {
  const from = Number(before) || 0;
  const to = Number(after) || 0;
  return { before: from, after: to, delta: to - from };
}

/**
 * Two findings are the same when rule, object (or file), and the exact rule of
 * an architecture violation match. The message and the line are not part of
 * it: a moved line or a changed count in the message is not a new finding.
 */
function identity(item) {
  return [item.rule, item.violation ?? item.policy ?? "", item.object ?? item.file ?? ""].join("\u0000");
}

function grouped(findings) {
  const groups = new Map();
  for (const item of findings) {
    const key = identity(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/** Findings of `after` without a partner in `before`, and the other way round. */
function difference(before, after) {
  const earlier = grouped(before);
  const fresh = [];
  const fixed = [];
  for (const [key, items] of grouped(after)) {
    const partners = [...(earlier.get(key) ?? [])];
    earlier.delete(key);
    // Same message first, so the finding that is left over is the one that changed.
    const open = [];
    for (const item of items) {
      const index = partners.findIndex(({ message }) => message === item.message);
      if (index >= 0) partners.splice(index, 1);
      else open.push(item);
    }
    fresh.push(...open.slice(partners.length));
    fixed.push(...partners.slice(open.length));
  }
  for (const items of earlier.values()) fixed.push(...items);
  return { fresh, fixed };
}

/** Throws when `previous` is not a report of `bca check --format json`. */
export function assertHealthReport(previous) {
  const valid = previous && typeof previous === "object" &&
    Array.isArray(previous.findings) &&
    previous.summary && typeof previous.summary === "object" &&
    previous.counts && typeof previous.counts === "object";
  if (!valid) throw new Error("not a report of \"bca check --format json\"");
}

export function compareHealth(report, previous, { source } = {}) {
  assertHealthReport(previous);
  const { fresh, fixed } = difference(previous.findings, report.findings);
  return {
    ...(source ? { comparedWith: source } : {}),
    previous: { passed: Boolean(previous.passed), failOn: previous.failOn },
    counts: Object.fromEntries(SEVERITIES.map((name) => [name, change(previous.counts[name], report.counts[name])])),
    summary: Object.fromEntries(METRICS.map((name) => [name, change(previous.summary[name], report.summary[name])])),
    new: fresh,
    fixed
  };
}

function arrow({ before, after, delta }) {
  if (!delta) return String(after);
  return `${before} -> ${after} (${delta > 0 ? "+" : ""}${delta})`;
}

function location(item) {
  return item.file ? ` (${item.file}${item.line ? `:${item.line}` : ""})` : "";
}

const LABELS = {
  error: "Errors", warning: "Warnings", info: "Info",
  files: "Files", objects: "Objects", relationships: "Relationships", unresolved: "Unresolved", cycles: "Cycles"
};

function rows(trend) {
  return [
    ...SEVERITIES.map((name) => [LABELS[name], trend.counts[name]]),
    ...METRICS.map((name) => [LABELS[name], trend.summary[name]])
  ];
}

function title(trend) {
  return `Trend${trend.comparedWith ? ` (compared with ${trend.comparedWith})` : ""}`;
}

export function formatTrendText(trend, { limit = 50 } = {}) {
  const labels = { error: "ERROR", warning: "WARN ", info: "INFO " };
  const lines = [title(trend), `  ${"Findings".padEnd(15)}${trend.new.length} new, ${trend.fixed.length} fixed`];
  for (const [label, value] of rows(trend)) lines.push(`  ${label.padEnd(15)}${arrow(value)}`);
  for (const [heading, items] of [["New findings", trend.new], ["Fixed findings", trend.fixed]]) {
    if (!items.length) continue;
    lines.push("", heading);
    for (const item of items.slice(0, limit)) lines.push(`  ${labels[item.severity]}  ${item.message}${location(item)}`);
    if (items.length > limit) lines.push(`  ... ${items.length - limit} more; use --format json for the full list`);
  }
  return lines;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/gu, " ");
}

export function formatTrendMarkdown(trend, { limit = 100 } = {}) {
  const names = { error: "Error", warning: "Warning", info: "Info" };
  const lines = [
    `**${title(trend)}** - ${trend.new.length} new finding(s), ${trend.fixed.length} fixed.`,
    "",
    "| Metric | Before | Now | Change |",
    "| --- | --- | --- | --- |"
  ];
  for (const [label, { before, after, delta }] of rows(trend)) {
    lines.push(`| ${label} | ${before} | ${after} | ${delta ? `${delta > 0 ? "+" : ""}${delta}` : ""} |`);
  }
  lines.push("");
  if (trend.new.length || trend.fixed.length) {
    lines.push("| Change | Severity | Rule | Finding |", "| --- | --- | --- | --- |");
    for (const [label, items] of [["New", trend.new], ["Fixed", trend.fixed]]) {
      for (const item of items.slice(0, limit)) {
        const where = location(item) ? ` (\`${escapeCell(location(item).slice(2, -1))}\`)` : "";
        lines.push(`| ${label} | ${names[item.severity]} | \`${item.rule}\` | ${escapeCell(item.message)}${where} |`);
      }
      if (items.length > limit) lines.push(`| ${label} | | | ${items.length - limit} more finding(s) |`);
    }
    lines.push("");
  }
  return lines;
}
