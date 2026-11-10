// bc-atlas-sync as a BC Atlas module. BC Atlas loads it when .bca.json lists it under "modules"
// and talks to it only through this object (module API version 1):
//
//   tasks.sync.run(host)          the "sync" task of "bca run" (Git hooks, pipelines, schedules)
//   commands.plan|run|status       "bca sync plan|run|status"
//   outputs(projectConfig)         paths the sync writes, for verify / stage / artifacts / pull requests
//
// host = { root, config, trigger, log, atlasModel(), renderDocs() } is provided by BC Atlas.
import { readFileSync } from "node:fs";
import { CONDITIONS, FORMATS, normalizeSyncConfig, SOURCE_TYPES, syncOutputs, TRIGGERS } from "./config.js";
import { runSync, summarize } from "./engine.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const API_VERSION = 1;

function options(host, values = {}, extra = {}) {
  const channels = values.channel === undefined ? undefined : [].concat(values.channel).flatMap((item) => String(item).split(",")).filter(Boolean);
  return {
    root: host.root,
    projectConfig: host.config,
    trigger: values.trigger ?? host.trigger ?? "manual",
    channels,
    force: Boolean(values.force),
    host,
    log: host.log,
    ...extra
  };
}

/** Everything the manifest can use: sources (what), triggers and conditions (when), formats (how). */
export function describe() {
  return {
    name: pkg.name,
    version: pkg.version,
    configKey: "sync",
    sources: SOURCE_TYPES,
    triggers: TRIGGERS,
    conditions: CONDITIONS,
    formats: FORMATS
  };
}

export const bcaModule = Object.freeze({
  apiVersion: API_VERSION,
  name: pkg.name,
  version: pkg.version,
  configKey: "sync",
  summary: "Syncs Business Central process recordings (fact snapshots) into BC Atlas: documents, UI tests, architecture layer, process index",
  outputs: (projectConfig) => syncOutputs(projectConfig),
  validate: (projectConfig) => normalizeSyncConfig(projectConfig),
  describe,
  tasks: {
    sync: {
      summary: "bc-atlas-sync channels: fact snapshots from Business Central into documents, UI tests, architecture and index",
      async run(host) {
        const result = await runSync(options(host));
        const lines = summarize(result);
        for (const line of lines) host.log?.(`sync: ${line}`);
        for (const channel of result.channels) for (const warning of channel.warnings) host.log?.(`sync: warning: ${channel.id}: ${warning}`);
        const ran = result.channels.filter(({ status }) => status !== "skipped").length;
        return { ok: result.passed, summary: `${ran} of ${result.channels.length} channel(s) synced`, result };
      }
    }
  },
  commands: {
    plan: async (host, values) => withLines(await runSync(options(host, values, { dryRun: true }))),
    run: async (host, values) => withLines(await runSync(options(host, values))),
    // Status looks at every channel regardless of the trigger.
    status: async (host, values) => {
      const all = normalizeSyncConfig(host.config).channels.map(({ id }) => id);
      return withLines(await runSync(options(host, { ...values, channel: values?.channel ?? all }, { dryRun: true })));
    }
  }
});

/** Human-readable lines for the host to print (BC Atlas prints them for "bca sync ..."). */
function withLines(result) {
  const lines = [];
  for (const [index, summary] of summarize(result).entries()) {
    const channel = result.channels[index];
    lines.push(summary);
    for (const file of channel.written) lines.push(`  ${result.dryRun ? "would write" : "wrote"} ${file}`);
    for (const file of channel.removed) lines.push(`  ${result.dryRun ? "would remove" : "removed"} ${file}`);
    for (const warning of channel.warnings) lines.push(`  warning: ${warning}`);
  }
  if (!result.channels.length) lines.push("no sync channels in .bca.json (\"sync\": { \"channels\": [...] })");
  return { ...result, lines };
}

export default bcaModule;
export { runSync, summarize } from "./engine.js";
export { normalizeSyncConfig, syncOutputs, SOURCE_TYPES, TRIGGERS, CONDITIONS, FORMATS } from "./config.js";
export { analyzeArchitecture, architectureMarkdown } from "./formats/architecture.js";
export { loadFactSnapshots, documentType } from "./sources/fact-snapshots.js";
export { parseAtlasExport } from "./sources/atlas-model.js";
export { readZip, writeZip } from "./zip.js";
