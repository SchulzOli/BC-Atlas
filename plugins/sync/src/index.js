// BC Atlas Sync, a built-in BC Atlas plugin (plugin API 1). plugin.json declares what it
// contributes; activate(context) returns the implementations:
//
//   commands     bca sync plan|run|status|describe
//   tasks.sync   the "sync" task of bca run (runs before docs), with its outputs
//   healthRules  sync-outdated: a process changed in Business Central but is not synced yet
//   mcpTools     bc_atlas_sync_status
//   extension points sync.sources (what) and sync.formats (how) for other plugins
import fs from "node:fs/promises";
import path from "node:path";
import { CONDITIONS, FORMATS, normalizeSyncConfig, SOURCE_TYPES, syncOutputs, TRIGGERS } from "./config.js";
import { runSync, summarize } from "./engine.js";

const channelsOf = (values = {}) => (values.channel === undefined
  ? undefined
  : [].concat(values.channel).flatMap((item) => String(item).split(",")).filter(Boolean));

/** Human-readable lines for the CLI. */
export function withLines(result) {
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

/** @param context the BC Atlas plugin context */
export function activate(context) {
  const host = { atlasModel: () => context.services.atlasModel(), renderDocs: (options) => context.services.renderDocs(options) };

  // Sources and formats other plugins contribute (extension points sync.sources, sync.formats).
  let contributed;
  const extensions = async () => {
    contributed ??= Promise.all([context.extensions.get("sync.sources"), context.extensions.get("sync.formats")])
      .then(([sources, formats]) => ({ sources, formats }));
    return contributed;
  };
  const extras = async () => {
    const { sources, formats } = await extensions();
    return {
      sourceTypes: Object.fromEntries(sources.map(({ type, summary, plugin }) => [type, summary ?? `from plugin ${plugin}`])),
      formats: Object.fromEntries(formats.map(({ id, summary, plugin }) => [id, summary ?? `from plugin ${plugin}`]))
    };
  };
  const sync = async (options) => runSync({
    root: context.root,
    projectConfig: context.config,
    host,
    extensions: await extensions(),
    log: context.log,
    ...options
  });
  const allChannels = async () => normalizeSyncConfig(context.config, await extras()).channels.map(({ id }) => id);

  return {
    commands: {
      plan: async ({ values }) => withLines(await sync({ trigger: values.trigger ?? "manual", channels: channelsOf(values), dryRun: true })),
      run: async ({ values }) => withLines(await sync({ trigger: values.trigger ?? "manual", channels: channelsOf(values), force: Boolean(values.force) })),
      status: async ({ values }) => withLines(await sync({ channels: channelsOf(values) ?? await allChannels(), dryRun: true })),
      describe: async () => {
        const { sources, formats } = await extensions();
        const description = {
          configKey: "sync",
          sources: { ...SOURCE_TYPES, ...Object.fromEntries(sources.map(({ type, summary, plugin }) => [type, `${summary ?? ""} (plugin ${plugin})`.trim()])) },
          triggers: TRIGGERS,
          conditions: CONDITIONS,
          formats: { ...FORMATS, ...Object.fromEntries(formats.map(({ id, summary, plugin }) => [id, `${summary ?? ""} (plugin ${plugin})`.trim()])) }
        };
        const lines = [
          "Sources (what):", ...Object.entries(description.sources).map(([key, value]) => `  ${key.padEnd(15)} ${value}`),
          "Triggers (when):", `  ${TRIGGERS.join(", ")}`,
          "Conditions (when):", ...Object.entries(CONDITIONS).map(([key, value]) => `  ${key.padEnd(15)} ${value}`),
          "Formats (how):", ...Object.entries(description.formats).map(([key, value]) => `  ${key.padEnd(15)} ${value}`)
        ];
        return { ...description, lines };
      }
    },

    tasks: {
      sync: {
        async run({ trigger }) {
          const result = await sync({ trigger });
          for (const line of summarize(result)) context.log(`sync: ${line}`);
          for (const channel of result.channels) for (const warning of channel.warnings) context.log(`sync: warning: ${channel.id}: ${warning}`);
          const ran = result.channels.filter(({ status }) => status !== "skipped").length;
          return { ok: result.passed, summary: `${ran} of ${result.channels.length} channel(s) synced`, result };
        },
        outputs: async (config) => syncOutputs(config, await extras())
      }
    },

    healthRules: {
      // Processes whose recording changed in Business Central but whose documentation is not synced yet.
      "sync-outdated": async () => {
        if (!context.config.sync?.channels?.length) return [];
        const status = await sync({ channels: await allChannels(), decisionsOnly: true });
        return status.channels.flatMap((channel) => channel.processes
          .filter(({ removed }) => !removed)
          .map(({ process, snapshot, reason }) => ({
            message: `Process "${process}" (snapshot ${snapshot}) is not synced in channel "${channel.id}": ${reason}. Run "bca sync run".`,
            file: path.posix.join(normalizeSyncConfig(context.config).channels.find(({ id }) => id === channel.id)?.how.outputDir ?? ".", "index.md")
          })));
      }
    },

    mcpTools: {
      async bc_atlas_sync_status({ path: projectPath, channel }) {
        const root = path.resolve(projectPath);
        const config = JSON.parse(await fs.readFile(path.join(root, ".bca.json"), "utf8"));
        const result = await runSync({
          root,
          projectConfig: config,
          host,
          extensions: await extensions(),
          channels: channel ? [channel] : normalizeSyncConfig(config, await extras()).channels.map(({ id }) => id),
          dryRun: true
        });
        return withLines(result);
      }
    },

    // bca plugins doctor: the "sync" section of .bca.json
    validateConfig: async (settings) => normalizeSyncConfig({ sync: settings }, await extras())
  };
}

export { runSync, summarize } from "./engine.js";
export { normalizeSyncConfig, syncOutputs, SOURCE_TYPES, TRIGGERS, CONDITIONS, FORMATS } from "./config.js";
export { analyzeArchitecture, architectureMarkdown } from "./formats/architecture.js";
export { loadFactSnapshots, documentType } from "./sources/fact-snapshots.js";
export { parseAtlasExport } from "./sources/atlas-model.js";
export { readZip, writeZip } from "./zip.js";
