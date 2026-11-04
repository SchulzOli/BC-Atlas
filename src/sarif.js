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

function evidenceMessage(evidence) {
  const facts = [evidence.kind, evidence.operation, evidence.member].filter(Boolean);
  return facts.join(" ") || "Supporting evidence";
}

function sameEvidence(left, right) {
  return left === right || Boolean(left && right &&
    left.file === right.file && left.line === right.line &&
    left.kind === right.kind && left.operation === right.operation && left.member === right.member);
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
    const evidence = finding.evidence ?? [];
    const primary = finding.primaryEvidence ?? { file: finding.file, line: finding.line };
    const exactPrimaryIndex = evidence.findIndex((item) => sameEvidence(item, primary));
    const primaryIndex = exactPrimaryIndex >= 0
      ? exactPrimaryIndex
      : evidence.findIndex((item) => item.file === primary.file && item.line === primary.line);
    const region = Object.fromEntries(Object.entries({
      startLine: primary.line ?? finding.line ?? 1,
      startColumn: primary.column ?? finding.column,
      endLine: primary.endLine ?? finding.endLine,
      endColumn: primary.endColumn ?? finding.endColumn
    }).filter(([, value]) => value !== undefined));
    const relatedLocations = evidence.flatMap((item, index) => {
      if (index === primaryIndex || !item.file) return [];
      const relatedRegion = Object.fromEntries(Object.entries({
        startLine: item.line,
        startColumn: item.column,
        endLine: item.endLine,
        endColumn: item.endColumn
      }).filter(([, value]) => value !== undefined));
      return [{
        id: index + 1,
        message: { text: evidenceMessage(item) },
        physicalLocation: {
          artifactLocation: { uri: String(item.file).replaceAll("\\", "/"), uriBaseId: "SRCROOT" },
          ...(Object.keys(relatedRegion).length ? { region: relatedRegion } : {})
        }
      }];
    });
    const properties = Object.fromEntries(Object.entries({
      basis: finding.basis,
      architectureOrigin: finding.architectureOrigin,
      resolution: finding.resolution,
      limitations: finding.limitations
    }).filter(([, value]) => value !== undefined));
    return {
      ruleId: finding.rule,
      ruleIndex: ruleIndex.get(finding.rule),
      level: LEVEL[finding.severity] ?? "note",
      message: { text: finding.message },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: String(primary.file ?? finding.file ?? fallbackFile).replaceAll("\\", "/"), uriBaseId: "SRCROOT" },
          region
        }
      }],
      ...(relatedLocations.length ? { relatedLocations } : {}),
      ...(Object.keys(properties).length ? { properties } : {})
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
