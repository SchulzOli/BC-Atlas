// The sync engine: for each channel decide WHEN it runs (trigger + condition), load WHAT it syncs
// (source data), render HOW (formats) and write the files. Only changed files are touched, files of
// processes that disappeared are removed, and a state file remembers what was synced. The state is
// deterministic (no timestamps) so that BC Atlas "verify" sees a difference only when data changed.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSyncConfig, syncOutputs } from "./config.js";
import { FORMAT_IMPLEMENTATIONS } from "./formats/index.js";
import { loadAtlasModel } from "./sources/atlas-model.js";
import { loadFactSnapshots, selectVersions } from "./sources/fact-snapshots.js";
import { matchesAny, removeFile, sha256, stableStringify, toPosix, writeIfChanged } from "./util.js";

export const STATE_SCHEMA = "bc-atlas-sync.state/1";

async function readState(file) {
  try {
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    if (state.schema !== STATE_SCHEMA) throw new Error(`unknown state schema ${state.schema}`);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { schema: STATE_SCHEMA, channels: {} };
    throw new Error(`${file}: ${error.message}`);
  }
}

/** Why a process is (re)written, or undefined when the condition says it is up to date. */
function reasonFor(item, previous, condition, configChanged, force) {
  if (force) return "forced";
  if (!previous) return "new";
  if (configChanged) return "channel configuration changed";
  if (condition === "always") return "always";
  if (condition === "changed" && previous.content !== item.contentHash) return "snapshot changed";
  if (condition === "drift" && previous.fingerprint !== item.fingerprint) return "fingerprint changed (drift)";
  return undefined;
}

async function differs(file, content) {
  try {
    const current = await fs.readFile(file);
    return !current.equals(Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

/**
 * Runs (or with dryRun: plans) the sync.
 * @param {object} options
 * @param {string} options.root project root (where .bca.json lives)
 * @param {object} options.projectConfig the parsed .bca.json
 * @param {string} [options.trigger] BC Atlas trigger: pre-commit, pre-push, ci, schedule, manual
 * @param {string[]} [options.channels] run only these channels (ignores the trigger filter)
 * @param {boolean} [options.dryRun] decide and render, but write nothing
 * @param {boolean} [options.force] rewrite every process regardless of the condition
 * @param {object} [options.host] what BC Atlas provides: atlasModel(), renderDocs(), log()
 */
export async function runSync({ root, projectConfig = {}, trigger = "manual", channels: only, dryRun = false, force = false, host, log = () => {} }) {
  root = path.resolve(root);
  const config = normalizeSyncConfig(projectConfig);
  const unknown = (only ?? []).filter((id) => !config.channels.some((channel) => channel.id === id));
  if (unknown.length) throw new Error(`unknown sync channel(s): ${unknown.join(", ")}; defined: ${config.channels.map(({ id }) => id).join(", ") || "none"}`);

  const statePath = path.resolve(root, config.state);
  const state = await readState(statePath);
  const nextState = { schema: STATE_SCHEMA, channels: { ...state.channels } };
  const sources = new Map();
  const atlasModels = new Map();
  const results = [];
  let wroteAnything = false;

  const sourceItems = async (id) => {
    if (!sources.has(id)) sources.set(id, await loadFactSnapshots(root, config.sources[id]));
    return sources.get(id);
  };
  const atlasModel = async (id, warnings) => {
    if (!atlasModels.has(id)) {
      try {
        atlasModels.set(id, await loadAtlasModel(root, config.sources[id], host));
      } catch (error) {
        atlasModels.set(id, undefined);
        warnings.push(error.message);
      }
    }
    return atlasModels.get(id);
  };

  for (const channel of config.channels) {
    if (only?.length && !only.includes(channel.id)) continue;
    const result = { id: channel.id, status: "skipped", reason: "", processes: [], written: [], removed: [], unchanged: 0, warnings: [] };
    results.push(result);
    if (!only?.length && !channel.when.triggers.includes(trigger)) {
      result.reason = `runs on ${channel.when.triggers.join(", ")}, not on ${trigger}`;
      continue;
    }

    const loaded = await sourceItems(channel.what.from);
    result.warnings.push(...loaded.warnings);
    const items = selectVersions(
      loaded.items.filter((item) => matchesAny(channel.what.processes, [item.process, item.feature, item.key])),
      channel.what.versions
    );
    const previous = state.channels[channel.id] ?? { config: undefined, processes: {}, files: [] };
    const configHash = sha256(stableStringify(channel));
    const configChanged = previous.config !== undefined && previous.config !== configHash;

    const selected = [];
    for (const item of items) {
      const reason = reasonFor(item, previous.processes[item.key], channel.when.condition, configChanged, force);
      if (reason) selected.push({ item, reason });
    }
    const current = new Set(items.map(({ key }) => key));
    const removedKeys = Object.keys(previous.processes).filter((key) => !current.has(key));
    if (!selected.length && !removedKeys.length && previous.config !== undefined) {
      result.reason = channel.when.condition === "drift" ? "no process drifted" : channel.when.condition === "changed" ? "no snapshot changed" : "nothing to sync";
      result.unchanged = items.length;
      continue;
    }

    result.status = dryRun ? "planned" : "synced";
    const outDir = path.resolve(root, channel.how.outputDir);
    const rel = (file) => toPosix(path.relative(root, path.join(outDir, file)));
    const channelState = { config: configHash, processes: { ...previous.processes }, files: [] };
    const needsAtlas = channel.how.formats.some(({ format }) => format === "architecture");
    const model = needsAtlas ? await atlasModel(channel.how.atlas, result.warnings) : undefined;

    const write = async (file, content) => {
      const target = path.join(outDir, file);
      const changed = dryRun ? await differs(target, content) : await writeIfChanged(target, content);
      if (changed) {
        result.written.push(rel(file));
        if (!dryRun) wroteAnything = true;
      } else {
        result.unchanged += 1;
      }
      return rel(file);
    };
    const remove = async (relative) => {
      const target = path.resolve(root, relative);
      if (dryRun) {
        result.removed.push(relative);
        return;
      }
      if (await removeFile(target)) {
        result.removed.push(relative);
        wroteAnything = true;
      }
    };

    for (const { item, reason } of selected) {
      const produced = [];
      for (const entry of channel.how.formats) {
        const format = FORMAT_IMPLEMENTATIONS.get(entry.format);
        if (format.scope !== "process") continue;
        const { files, warnings } = await format.render({ item, channel, atlasModel: model, host, options: entry });
        result.warnings.push(...warnings);
        for (const file of files) produced.push(await write(file.path, file.content));
      }
      for (const old of previous.processes[item.key]?.files ?? []) {
        if (!produced.includes(old)) await remove(old);
      }
      channelState.processes[item.key] = { snapshot: item.snapshotNo, fingerprint: item.fingerprint, content: item.contentHash, files: produced.sort() };
      result.processes.push({ key: item.key, process: item.process, snapshot: item.snapshotNo, reason, drift: item.driftDetected });
    }
    for (const key of removedKeys) {
      for (const old of previous.processes[key].files ?? []) await remove(old);
      delete channelState.processes[key];
      result.processes.push({ key, process: key, reason: "no longer in the source", removed: true });
    }

    const channelFiles = [];
    for (const entry of channel.how.formats) {
      const format = FORMAT_IMPLEMENTATIONS.get(entry.format);
      if (format.scope !== "channel") continue;
      const { files, warnings } = await format.render({ items, channel, state: channelState, host, options: entry });
      result.warnings.push(...warnings);
      for (const file of files) channelFiles.push(await write(file.path, file.content));
    }
    for (const old of previous.files ?? []) {
      if (!channelFiles.includes(old)) await remove(old);
    }
    channelState.files = channelFiles.sort();
    nextState.channels[channel.id] = channelState;
    result.reason = `${selected.length} process(es) to write, ${removedKeys.length} removed`;
    log(`sync ${channel.id}: ${dryRun ? "would write" : "wrote"} ${result.written.length} file(s), removed ${result.removed.length}; ${result.reason}`);
  }

  // Channels that no longer exist are forgotten (their files stay; remove the folder by hand).
  for (const id of Object.keys(nextState.channels)) {
    if (!config.channels.some((channel) => channel.id === id)) delete nextState.channels[id];
  }
  const stateText = `${stableStringify(nextState, 2)}\n`;
  if (!dryRun && results.some(({ status }) => status === "synced")) {
    if (await writeIfChanged(statePath, stateText)) wroteAnything = true;
  }

  return {
    schema: "bc-atlas-sync.result/1",
    trigger,
    dryRun,
    state: toPosix(path.relative(root, statePath)),
    channels: results,
    outputs: syncOutputs(projectConfig),
    changed: wroteAnything,
    passed: true
  };
}

/** One line per channel, for logs. */
export function summarize(result) {
  return result.channels.map((channel) => {
    const what = channel.status === "skipped"
      ? `skipped (${channel.reason})`
      : `${channel.status}: ${channel.processes.length} process(es), ${channel.written.length} file(s) ${result.dryRun ? "to write" : "written"}, ${channel.removed.length} removed`;
    return `${channel.id}: ${what}${channel.warnings.length ? `, ${channel.warnings.length} warning(s)` : ""}`;
  });
}
