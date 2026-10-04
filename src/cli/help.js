import { FEATURE_AREAS, VIEWS } from "../capabilities.js";

const DOCS_URL = "https://github.com/SchulzOli/BC-Atlas/tree/main/docs";

function columns(rows, indent = 2, gap = 2) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) =>
    right ? `${" ".repeat(indent)}${left.padEnd(width + gap)}${right}` : `${" ".repeat(indent)}${left}`
  );
}

const OVERVIEW_WIDTH = 16;

function aligned(rows) {
  return rows.map(([left, right]) => `  ${left.padEnd(OVERVIEW_WIDTH)}${right}`);
}

function commandName(definition) {
  return definition.argv.slice(1).filter((token) => !/^[<[]/u.test(token)).join(" ");
}

function visibleCommands(capabilities) {
  return capabilities.commands.filter(({ variantOf }) => !variantOf);
}

function topLevelName(definition) {
  return definition.id.split(".")[0];
}

export function overviewHelp(capabilities) {
  const lines = [
    `BC Atlas ${capabilities.version} - architecture maps, health checks, and documentation for Business Central AL`,
    "",
    "Usage",
    "  bca <command> [app-root] [options]",
    "  bca <app-root> [options]          shortcut for: bca graph <app-root>",
    ""
  ];
  for (const area of FEATURE_AREAS) {
    const seen = new Set();
    const rows = [];
    for (const definition of visibleCommands(capabilities).filter((item) => item.area === area.id)) {
      const name = topLevelName(definition);
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push(name === "docs"
        ? ["docs", "Turn AL UI tests into user guides (list, validate, generate, ...)"]
        : [name, definition.purpose.replace(/\.$/u, "")]);
    }
    lines.push(area.title, ...aligned(rows), "");
  }
  lines.push(
    "Views for graph, watch, and inspect (--view)",
    ...aligned(VIEWS.map(([id, summary]) => [id, summary])),
    "",
    "Common options",
    ...aligned([
      ["-h, --help", "Show help for any command"],
      ["-V, --version", "Show the installed version"]
    ]),
    "",
    "Next steps",
    "  bca init               create .bca.json for the current AL project",
    "  bca report             write docs/atlas/README.md with diagrams and a health summary",
    "  bca help <command>     show options and examples for one command",
    "",
    `Documentation: ${DOCS_URL}`
  );
  return `${lines.join("\n")}\n`;
}

export function docsOverviewHelp(capabilities) {
  const commands = visibleCommands(capabilities).filter(({ id }) => id.startsWith("docs."));
  return [
    "bca docs - user guides generated from AL UI tests",
    "",
    "Usage",
    "  bca docs <command> <test-root> [options]",
    "",
    "Commands",
    ...columns(commands.map((definition) => [definition.id.slice(5), definition.purpose.replace(/\.$/u, "")]), 2, 4),
    "",
    "Run \"bca docs <command> --help\" for options and examples.",
    ""
  ].join("\n");
}

const MAX_INLINE_ENUM = 24;

function longEnum(option) {
  return option.enum && option.enum.join("|").length > MAX_INLINE_ENUM;
}

function optionLabel(option) {
  const names = option.short ? `${option.short}, ${option.cli}` : `    ${option.cli}`;
  if (option.type === "boolean") return names;
  const value = longEnum(option)
    ? option.cli.slice(2).split("-").at(-1)
    : option.enum?.join("|") ?? option.const ?? option.value ?? "value";
  return `${names} <${value}>`;
}

function optionDescription(option) {
  const notes = [];
  if (longEnum(option)) notes.push(`one of: ${option.enum.join(", ")}`);
  if (option.required) notes.push("required");
  if (option.repeatable) notes.push("repeatable");
  if (option.default !== undefined) notes.push(`default: ${option.default}`);
  return notes.length ? `${option.description} (${notes.join("; ")})` : option.description;
}

export function commandHelp(definition) {
  const usage = [`  ${definition.argv.join(" ")} [options]`, ...(definition.aliases ?? []).map((alias) => `  ${alias} [options]`)];
  const lines = [`bca ${commandName(definition)} - ${definition.purpose}`, "", "Usage", ...usage, ""];
  const groups = new Map();
  for (const option of Object.values(definition.options)) {
    const group = option.group ?? "Options";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([optionLabel(option), optionDescription(option)]);
  }
  groups.set("General", [...(groups.get("General") ?? []), ["-h, --help", "Show this help."]]);
  const width = Math.max(...[...groups.values()].flat().map(([label]) => label.length));
  for (const [group, rows] of groups) {
    lines.push(group === "Options" ? "Options" : group);
    for (const [label, description] of rows) lines.push(`  ${label.padEnd(width + 2)}${description}`);
    lines.push("");
  }
  if (definition.rules.length) lines.push("Rules", ...definition.rules.map((rule) => `  - ${rule}`), "");
  if (definition.examples.length) lines.push("Examples", ...definition.examples.map((example) => `  ${example}`), "");
  return lines.join("\n");
}
