// SARIF 2.1.0 for `bca check --format sarif`: BC Atlas findings and AL
// compiler/analyzer diagnostics in one run, for GitHub code scanning
// (github/codeql-action/upload-sarif) and the Azure DevOps SARIF viewer.
import { pathToFileURL } from "node:url";

const LEVEL = { error: "error", warning: "warning", info: "note" };
const RULE_HELP = "https://schulzoli.github.io/BC-Atlas/docs/health-checks";

function ruleFor(finding) {
  const al = finding.origin === "al";
  return Object.fromEntries(Object.entries({
    id: finding.rule,
    name: finding.rule,
    shortDescription: { text: al ? finding.message.replace(/^[A-Z]+\d+: /u, "") : finding.rule.replaceAll("-", " ") },
    helpUri: finding.helpLink ?? (al ? undefined : RULE_HELP),
    properties: { tags: [al ? "al-compiler" : "bc-atlas"] }
  }).filter(([, value]) => value !== undefined));
}

/**
 * @param report health report from assessHealth()
 * @param options { root, fallbackFile, version } fallbackFile anchors
 *   findings without a file (cycles, hot spots), as code scanning needs a location.
 */
export function renderSarif(report, { root, fallbackFile = "app.json", version } = {}) {
  const rules = [];
  const ruleIndex = new Map();
  const results = report.findings.map((finding) => {
    if (!ruleIndex.has(finding.rule)) {
      ruleIndex.set(finding.rule, rules.length);
      rules.push(ruleFor(finding));
    }
    const region = Object.fromEntries(Object.entries({
      startLine: finding.line ?? 1,
      startColumn: finding.column,
      endLine: finding.endLine,
      endColumn: finding.endColumn
    }).filter(([, value]) => value !== undefined));
    return {
      ruleId: finding.rule,
      ruleIndex: ruleIndex.get(finding.rule),
      level: LEVEL[finding.severity] ?? "note",
      message: { text: finding.message },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: String(finding.file ?? fallbackFile).replaceAll("\\", "/"), uriBaseId: "SRCROOT" },
          region
        }
      }]
    };
  });
  const run = {
    tool: {
      driver: Object.fromEntries(Object.entries({
        name: "BC Atlas",
        version,
        informationUri: "https://schulzoli.github.io/BC-Atlas/",
        rules
      }).filter(([, value]) => value !== undefined))
    },
    ...(root ? { originalUriBaseIds: { SRCROOT: { uri: `${pathToFileURL(root).href.replace(/\/?$/u, "/")}` } } } : {}),
    results
  };
  return `${JSON.stringify({ $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [run] }, null, 2)}\n`;
}
