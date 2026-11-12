// BC Atlas Sync, a built-in BC Atlas plugin (plugin API 1). plugin.json declares what it
// contributes; activate(context) returns the implementations:
//
//   commands     bca sync plan|run|status|describe
//   tasks.sync   the "sync" task of bca run (runs before docs), with its outputs
//   healthRules  sync-outdated: a process changed in Business Central but is not synced yet
//   mcpTools     bc_atlas_sync_status
//   atlas        the recordings and channels as nodes of the BC Atlas graph: a lens, findings, a story
//   extension points sync.sources (what) and sync.formats (how) for other plugins
import fs from "node:fs/promises";
import path from "node:path";
import { CONDITIONS, FORMATS, normalizeSyncConfig, SOURCE_TYPES, syncOutputs, TRIGGERS } from "./config.js";
import { runSync, summarize, syncState } from "./engine.js";

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

    // What Business Central recorded, as part of the one graph of BC Atlas (the view and bca view):
    // every channel and every recorded process is a node; a recording points at the objects it
    // runs through and the tables it writes; what is not synced is a finding on its nodes.
    atlas: async ({ object }) => {
      if (!context.config.sync?.channels?.length) return {};
      const state = await syncState({ root: context.root, projectConfig: context.config, host, extensions: await extensions() });
      const OK = "#0F766E";
      const STALE = "#B7791F";
      const nodes = [];
      const relations = [];
      const findings = [];
      const steps = [];
      const recorded = new Map();
      const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
      const processes = (count) => `${count} recorded process${count === 1 ? "" : "es"}`;
      const typeOf = (value) => String(value ?? "").toLowerCase().replaceAll(" ", "");
      for (const { channel, items, removed } of state) {
        const pending = items.filter(({ reason }) => reason);
        const channelId = `sync::channel::${channel.id}`;
        nodes.push({
          id: channelId,
          kind: "channel",
          label: channel.id,
          color: pending.length || removed.length ? STALE : OK,
          status: pending.length || removed.length ? `${pending.length + removed.length} to sync` : "in sync",
          about: channel.description,
          source: channel.what.from,
          when: `${channel.when.triggers.join(", ")}; ${channel.when.condition}`,
          formats: channel.how.formats.map(({ format }) => format).join(", "),
          output: channel.how.outputDir
        });
        steps.push({
          title: `Channel ${channel.id}`,
          text: `${channel.description ? `${channel.description} ` : ""}Syncs ${processes(items.length)} from ${channel.what.from} as ${channel.how.formats.map(({ format }) => format).join(", ")} into ${channel.how.outputDir}, on ${channel.when.triggers.join(", ")} when ${channel.when.condition === "always" ? "run" : channel.when.condition === "drift" ? "the process drifted" : "the snapshot changed"}. ${pending.length ? `${pending.length} of them ${pending.length === 1 ? "is" : "are"} not synced: run \`bca sync run\`.` : "Everything is in sync."}`,
          lens: "sync",
          nodes: [channelId, ...items.map(({ item }) => `sync::recording::${item.key}`)],
          ...(pending.length ? { status: "warning" } : {})
        });
        for (const { item, reason } of items) {
          const id = `sync::recording::${item.key}`;
          relations.push({ from: channelId, to: id, kind: reason ? "not synced" : "syncs" });
          if (reason) {
            findings.push({
              severity: "warning",
              rule: "sync-outdated",
              message: `Process "${item.process}" (snapshot ${item.snapshotNo}) is not synced in channel "${channel.id}": ${reason}. Run "bca sync run".`,
              fix: "Run `bca sync run`, or let the sync task of `bca run` do it.",
              nodes: [id, channelId]
            });
          }
          if (recorded.has(id)) {
            if (reason) Object.assign(recorded.get(id), { color: STALE, status: reason });
            continue;
          }
          const facts = item.facts ?? {};
          const touched = [];
          let elsewhere = 0;
          for (const entry of facts.objects ?? []) {
            const node = object(typeOf(entry.objectType), String(entry.objectId)) ?? object(typeOf(entry.objectType), entry.objectName);
            if (node) {
              touched.push(node);
              relations.push({ from: id, to: node, kind: "runs through", weight: entry.hits ?? 1 });
            } else elsewhere++;
          }
          for (const table of facts.tables ?? []) {
            const node = object("table", String(table.tableId)) ?? object("table", table.tableName);
            const writes = (table.inserts ?? 0) + (table.modifies ?? 0) + (table.deletes ?? 0) + (table.renames ?? 0);
            if (!node || !writes) continue;
            touched.push(node);
            // Its own kind of relation: "writes" is what the source says, this is what was seen.
            relations.push({ from: id, to: node, kind: "changes", weight: writes });
          }
          const node = {
            id,
            kind: "recording",
            label: item.process,
            color: reason ? STALE : OK,
            status: reason ?? "in sync",
            about: `Recorded in Business Central${item.feature && item.feature !== item.process ? ` (${item.feature})` : ""}: how the process really runs, click by click, with the code behind it.`,
            snapshot: item.snapshotNo,
            fingerprint: String(item.fingerprint).slice(0, 12),
            phases: facts.phases?.length,
            steps: facts.technicalSteps?.length,
            otherApps: elsewhere || undefined,
            file: item.origin
          };
          recorded.set(id, node);
          nodes.push(node);
          steps.push({
            title: item.process,
            text: `Snapshot ${item.snapshotNo}: ${plural(facts.phases?.length ?? 0, "phase")}, ${plural(facts.technicalSteps?.length ?? 0, "technical step")}, through ${plural(new Set(touched).size, "object")} of this workspace${elsewhere ? ` and ${elsewhere} of other apps` : ""}. ${reason ? `Not synced: ${reason}.` : "In sync."}`,
            lens: "sync",
            nodes: [id, ...touched],
            ...(reason ? { status: "warning" } : {})
          });
          for (const phase of facts.phases ?? []) {
            const inPhase = (facts.technicalSteps ?? []).filter((step) => step.phase === phase.phase);
            // The objects on the call stacks of this phase.
            const ran = [...new Set(inPhase.flatMap((step) => step.callStack ?? []).map((entry) => object(typeOf(entry.objectType), String(entry.objectId)) ?? object(typeOf(entry.objectType), entry.objectName)).filter(Boolean))];
            steps.push({
              title: `${item.process} · ${phase.title}`,
              text: inPhase.length ? inPhase.slice(0, 6).map((step) => `${step.kind}: ${step.description}`).join(". ") + (inPhase.length > 6 ? `, and ${inPhase.length - 6} more.` : ".") : "No code ran in this phase.",
              lens: "sync",
              nodes: [id, ...(ran.length ? ran : touched)]
            });
          }
        }
      }
      if (!nodes.length) return {};
      return {
        nodes,
        relations,
        styles: { syncs: { color: OK }, "not synced": { color: STALE, dash: true }, "runs through": { color: "#15803D" }, changes: { color: "#D55E00" } },
        lenses: [{
          id: "sync",
          title: "Recordings",
          hint: "what was recorded in Business Central",
          summary: "What was recorded in Business Central, the objects each recording runs through, and what is synced or waits for it.",
          kinds: ["channel", "recording", "object"],
          relations: ["syncs", "not synced", "runs through", "changes"],
          connected: true,
          group: "kind",
          color: "status",
          reads: "the recordings of the `sync` sources in .bca.json (fact snapshots of the BC Atlas Sync extension), its channels, and the sync state"
        }],
        findings,
        stories: [{
          id: "sync",
          kind: "process",
          title: "What runs in Business Central",
          summary: `${processes(recorded.size)}: the channels that sync them, their phases, and the objects they run through.`,
          steps
        }]
      };
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

export { runSync, summarize, syncState } from "./engine.js";
export { normalizeSyncConfig, syncOutputs, SOURCE_TYPES, TRIGGERS, CONDITIONS, FORMATS } from "./config.js";
export { analyzeArchitecture, architectureMarkdown } from "./formats/architecture.js";
export { loadFactSnapshots, documentType } from "./sources/fact-snapshots.js";
export { parseAtlasExport } from "./sources/atlas-model.js";
export { readZip, writeZip } from "./zip.js";
