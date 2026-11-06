// Rules for bca check that read what characterizes objects (metadata.js) and
// that no AL analyzer (CodeCop, UICop, AppSourceCop, PerTenantExtensionCop,
// LinterCop) reports already:
//
//   undocumented-public-api   public procedures of public codeunits and
//                             interfaces without a /// summary
//
// DataClassification, ToolTips, ObsoleteTag and ObsoleteReason, and
// cyclomatic complexity are left to the analyzers: bca check runs the AL
// compiler with the analyzers of al.codeAnalyzers and reports what they find.
//
// One finding per object, listing what it concerns, so a large app does not
// produce thousands of lines. check.severities sets each rule to error,
// warning, info, or off.
import { SEVERITIES } from "./capabilities.js";

export const QUALITY_RULES = Object.freeze({
  "undocumented-public-api": "info"
});

const LEVELS = [...SEVERITIES, "off"];
const SHOWN = 8;

const label = (object) => [object.type, object.id, object.name].filter(Boolean).join(" ");
const list = (names) => `${names.slice(0, SHOWN).join(", ")}${names.length > SHOWN ? `, and ${names.length - SHOWN} more` : ""}`;
const at = (object, location = object.location) => ({
  object: label(object),
  ...(object.file && !String(object.file).includes("#") ? { file: object.file } : {}),
  ...(location?.line ? { line: location.line } : {})
});

/** The severities of the quality rules: defaults, then check.severities. */
export function qualitySettings(settings = {}) {
  const severities = { ...QUALITY_RULES };
  for (const [rule, level] of Object.entries(settings.severities ?? {})) {
    if (!(rule in QUALITY_RULES)) continue;
    if (!LEVELS.includes(level)) throw new Error(`check.severities.${rule} must be one of: ${LEVELS.join(", ")}`);
    severities[rule] = level;
  }
  return { severities };
}

/**
 * @param objects the workspace objects of the model (with metadata)
 * @returns findings { severity, rule, message, object, file, line }
 */
export function qualityFindings(objects, settings = {}) {
  const { severities } = qualitySettings(settings);
  const findings = [];
  const add = (rule, message, details) => {
    if (severities[rule] !== "off") findings.push({ severity: severities[rule], rule, message, ...details });
  };

  for (const object of objects) {
    const meta = object.metadata ?? {};
    // The public API of public codeunits and interfaces.
    if (["codeunit", "interface"].includes(object.type) && (meta.access ?? "public") === "public" && !/^test/iu.test(meta.subtype ?? "")) {
      const undocumented = (object.procedures ?? []).filter(({ kind, visibility, metadata }) => kind === "procedure" && (visibility ?? "public") === "public" && !metadata?.documentation);
      if (undocumented.length) {
        add("undocumented-public-api", `${label(object)}: ${undocumented.length} public procedure(s) without a /// summary: ${list(undocumented.map(({ name }) => name))}`, at(object, undocumented[0].location));
      }
    }
  }
  return findings;
}
