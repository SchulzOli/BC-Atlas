import fs from "node:fs/promises";
import path from "node:path";

// A baseline records the violations a team has accepted for now. New
// violations fail the check; fixed ones are reported so the baseline can only
// shrink (a ratchet), never grow by accident.

export const BASELINE_FILE = ".bca-architecture-baseline.json";
export const BASELINE_SCHEMA = "bc-atlas.architecture-baseline";

export async function readBaseline(file) {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (data.schema !== BASELINE_SCHEMA) throw new Error(`${file} is not an architecture baseline`);
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${file}: ${error.message}`);
    throw error;
  }
}

export function createBaseline(violations) {
  return {
    schema: BASELINE_SCHEMA,
    schemaVersion: 1,
    violations: violations
      .map(({ id, sourceComponent, targetComponent, source, target }) => ({
        id,
        dependency: `${sourceComponent} -> ${targetComponent}`,
        source: `${source.type} ${source.label}`,
        target: `${target.type} ${target.label}`
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}

export async function writeBaseline(file, violations) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(createBaseline(violations), null, 2)}\n`);
}

/** Splits violations into new and accepted ones; lists accepted ones that are gone. */
export function compareWithBaseline(violations, baseline) {
  if (!baseline) return { baselined: false, new: violations, known: [], fixed: [] };
  const accepted = new Map(baseline.violations.map((entry) => [entry.id, entry]));
  const current = new Set(violations.map(({ id }) => id));
  return {
    baselined: true,
    new: violations.filter(({ id }) => !accepted.has(id)),
    known: violations.filter(({ id }) => accepted.has(id)),
    fixed: baseline.violations.filter(({ id }) => !current.has(id))
  };
}
