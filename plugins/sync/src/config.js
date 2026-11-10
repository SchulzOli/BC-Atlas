// The sync manifest: the "sync" section of .bca.json.
//
//   "sync": {
//     "state": ".bca/sync-state.json",
//     "sources": {
//       "bc":    { "type": "fact-snapshots", "path": "bc-snapshots" },
//       "atlas": { "type": "atlas-model" }
//     },
//     "channels": [{
//       "id": "process-docs",
//       "what": { "from": "bc", "processes": ["*"], "versions": "latest" },
//       "when": { "triggers": ["ci", "schedule", "manual"], "condition": "drift" },
//       "how":  { "formats": ["documents", "architecture", "index"], "outputDir": "docs/processes", "atlas": "atlas" }
//     }]
//   }
//
// WHAT is data from a source, WHEN is a BC Atlas trigger plus a condition, HOW is a list of formats
// written to an output directory. Delivering the output (verify, stage, pull request, commit) stays
// with the BC Atlas sync mode of the trigger.

export const STATE_DEFAULT = ".bca/sync-state.json";

export const SOURCE_TYPES = Object.freeze({
  "fact-snapshots": "Fact snapshots from Business Central: JSON fact sheets or the \"Download All\" ZIPs of the BC Atlas Sync extension, in a folder",
  "atlas-model": "The BC Atlas architecture model: from the running bca (no path) or an export (HTML from \"bca export --view app\" or its model JSON)"
});

/** The triggers of BC Atlas automation; a channel runs on the ones it lists. */
export const TRIGGERS = Object.freeze(["pre-commit", "pre-push", "ci", "schedule", "manual"]);

export const CONDITIONS = Object.freeze({
  always: "Rewrite every selected process on each run",
  changed: "Write processes whose snapshot or documents changed since the last sync",
  drift: "Write processes whose fingerprint changed (the process behaves differently) or that are new"
});

export const FORMATS = Object.freeze({
  documents: "The documents generated in Business Central, one folder per process (layered, user guide, technical, sequence, inventory, page script, UI test, facts)",
  facts: "The JSON fact sheet of each process (facts.json)",
  "ui-tests": "The BC Atlas UI test of each process as <process>.Codeunit.al, ready for the docs task of BC Atlas",
  architecture: "Architecture layer: components and layers the process crosses, checked against the BC Atlas layer rules (architecture.md, architecture.json)",
  index: "One catalog of all synced processes: feature, phases, clicks, tables, fingerprint, drift (index.md, index.json)",
  "atlas-docs": "User guides, test cases, BPMN ... rendered by BC Atlas from the UI tests (needs bca)"
});

export const VERSIONS = Object.freeze(["latest", "all"]);

const ID = /^[a-z0-9][a-z0-9-]*$/u;

function fail(message) {
  throw new Error(`.bca.json sync: ${message}`);
}

function list(value, allowed, name) {
  const items = value === undefined ? undefined : Array.isArray(value) ? value : [value];
  if (items === undefined) return undefined;
  for (const item of items) {
    if (allowed && !allowed.includes(item)) fail(`${name} must be chosen from ${allowed.join(", ")}; unsupported: ${item}`);
  }
  return [...new Set(items)];
}

function normalizeFormat(format, channelId, formats) {
  const entry = typeof format === "string" ? { format } : { ...format };
  if (!formats[entry.format]) fail(`channel "${channelId}": unknown format "${entry.format}"; use ${Object.keys(formats).join(", ")}`);
  return entry;
}

/**
 * Validates the sync section and fills in the defaults.
 * @param extras source types and formats contributed by other plugins (extension points
 *   sync.sources and sync.formats): { sourceTypes: { type: summary }, formats: { id: summary } }
 */
export function normalizeSyncConfig(projectConfig = {}, extras = {}) {
  const sourceTypes = { ...SOURCE_TYPES, ...extras.sourceTypes };
  const formatTypes = { ...FORMATS, ...extras.formats };
  const section = projectConfig.sync;
  if (section === undefined) return { state: STATE_DEFAULT, sources: {}, channels: [] };
  if (!section || typeof section !== "object" || Array.isArray(section)) fail("must be an object");

  const sources = {};
  for (const [id, source] of Object.entries(section.sources ?? {})) {
    if (!ID.test(id)) fail(`source id "${id}" must be lowercase letters, digits and hyphens`);
    if (!sourceTypes[source?.type]) fail(`source "${id}" needs a type: ${Object.keys(sourceTypes).join(", ")}`);
    if (source.type === "fact-snapshots" && !source.path) fail(`source "${id}" (fact-snapshots) needs a "path"`);
    sources[id] = { id, ...source };
  }
  // Every source type except the architecture model delivers processes.
  const delivers = (type) => type !== "atlas-model";

  const ids = new Set();
  const channels = (section.channels ?? []).map((channel, index) => {
    const id = channel?.id;
    if (!id || !ID.test(id)) fail(`channel ${index + 1} needs an "id" of lowercase letters, digits and hyphens`);
    if (ids.has(id)) fail(`channel id "${id}" is used twice`);
    ids.add(id);

    const what = channel.what ?? {};
    const from = what.from ?? Object.values(sources).find(({ type }) => delivers(type))?.id;
    if (!from || !sources[from]) fail(`channel "${id}": what.from must name a source (${Object.keys(sources).join(", ") || "none defined"})`);
    if (!delivers(sources[from].type)) fail(`channel "${id}": what.from must be a source of processes, not an atlas-model`);
    const versions = what.versions ?? "latest";
    if (!VERSIONS.includes(versions)) fail(`channel "${id}": what.versions must be ${VERSIONS.join(" or ")}`);

    const when = channel.when ?? {};
    const triggers = list(when.triggers ?? ["manual", "ci"], TRIGGERS, `channel "${id}" when.triggers`);
    const condition = when.condition ?? "changed";
    if (!CONDITIONS[condition]) fail(`channel "${id}": when.condition must be ${Object.keys(CONDITIONS).join(", ")}`);

    const how = channel.how ?? {};
    const formats = (how.formats ?? ["documents", "index"]).map((format) => normalizeFormat(format, id, formatTypes));
    if (!formats.length) fail(`channel "${id}": how.formats is empty`);
    const atlas = how.atlas ?? Object.values(sources).find(({ type }) => type === "atlas-model")?.id;
    if (formats.some(({ format }) => format === "architecture")) {
      if (!atlas || sources[atlas]?.type !== "atlas-model") fail(`channel "${id}": the architecture format needs how.atlas naming an atlas-model source`);
    }
    return {
      id,
      description: channel.description ?? "",
      what: { from, processes: list(what.processes) ?? ["*"], versions },
      when: { triggers, condition },
      how: { formats, outputDir: how.outputDir ?? `docs/sync/${id}`, atlas }
    };
  });

  return { state: section.state ?? STATE_DEFAULT, sources, channels };
}

/**
 * Paths (relative to the project root) a sync writes: every channel's output directory and the
 * state file. BC Atlas uses them for verify, stage, artifacts and pull requests.
 */
export function syncOutputs(projectConfig = {}, extras = {}) {
  const config = normalizeSyncConfig(projectConfig, extras);
  if (!config.channels.length) return [];
  return [...new Set([...config.channels.map(({ how }) => how.outputDir), config.state])];
}
