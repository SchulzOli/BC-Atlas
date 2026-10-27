import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analyze } from "../analyzer.js";
import { mergeArchitectureOptions, positiveInteger } from "../architecture.js";
import { loadConfig } from "../config.js";
import { resolveModel } from "../resolver.js";
import { loadSymbolPackages } from "../symbols.js";
import { objectFilter, pathMatcher } from "../views.js";
import { findLens } from "./lenses/index.js";
import { addMetrics } from "./metrics.js";
import { replayHistory } from "./history.js";
import { frameStatistics, mergeFrames } from "./temporal.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export const GRAPH_SCHEMA = "bc-atlas.graph";
export const GRAPH_SCHEMA_VERSION = 1;

function vocabulary(levels) {
  const collect = (items, read) => [...new Set(items.flatMap(read))].filter(Boolean).sort();
  const nodes = Object.values(levels).flatMap((level) => level.nodes);
  const edges = Object.values(levels).flatMap((level) => level.edges);
  return {
    types: collect(levels.object.nodes, ({ type }) => [type]),
    kinds: collect(edges, ({ kinds }) => Object.keys(kinds ?? {})),
    dependencies: collect(edges, ({ dependency }) => [dependency]),
    origins: collect(nodes, ({ origin }) => [origin])
  };
}

/**
 * Creates a temporal graph document for one lens: object and app levels with
 * metrics, plus one frame per sampled commit when `history` is set.
 */
export async function createGraphDocument(input, values = {}) {
  const config = await loadConfig(values.projectRoot ?? input, values.config);
  const options = mergeArchitectureOptions(config.values, values);
  // A single AL file is analyzed as the focus of its folder.
  const requestedRoot = path.resolve(options.projectRoot ?? input);
  const projectRoot = statSync(requestedRoot).isFile() ? path.dirname(requestedRoot) : requestedRoot;
  const focus = path.relative(projectRoot, path.resolve(input));
  if (focus.startsWith("..") || path.isAbsolute(focus)) {
    throw new Error(`selected focus path must be inside project root: ${projectRoot}`);
  }
  const lens = findLens(options.lens);
  const filter = objectFilter({ ...options, focusPath: focus ? focus.replaceAll("\\", "/") : undefined });
  const paths = [options.paths ?? []].flat().filter(Boolean);
  const fileFilter = paths.length ? pathMatcher(paths) : undefined;
  const parseCache = new Map();
  const symbols = await loadSymbolPackages(projectRoot);
  const build = async (root) => lens.build(resolveModel(await analyze(root, { parseCache, symbols, fileFilter })), { filter });

  const frames = [];
  let history;
  if (options.history) {
    history = await replayHistory(projectRoot, {
      maxCommits: positiveInteger(options.maxCommits, "max-commits", 60),
      since: options.since,
      fileFilter
    }, async (directory, frame) => {
      frames.push({ ...frame, levels: await build(directory) });
    });
  }
  if (!frames.length || history?.workingTreeChanges.length) {
    frames.push({
      id: "working-tree",
      kind: "working-tree",
      label: frames.length ? "Uncommitted changes" : "Current source",
      date: new Date().toISOString(),
      changedFiles: new Set(history?.workingTreeChanges ?? []),
      levels: await build(projectRoot)
    });
  }

  const levels = mergeFrames(frames);
  const summary = Object.fromEntries(Object.entries(levels).map(([name, level]) => [name, addMetrics(level)]));
  if (!levels.object.nodes.length) {
    throw new Error(`no AL objects found in ${path.resolve(input)}; check the path and the --include, --exclude, --namespace, and --type filters`);
  }
  const statistics = frameStatistics(levels, frames.length);
  return {
    schema: GRAPH_SCHEMA,
    schemaVersion: GRAPH_SCHEMA_VERSION,
    generator: `bc-atlas ${pkg.version}`,
    title: options.title ?? `${lens.title}: ${path.basename(projectRoot)}`,
    lens: { id: lens.id, title: lens.title, summary: lens.summary },
    project: { name: path.basename(projectRoot) },
    timeline: {
      source: history ? "git" : "snapshot",
      commits: history?.commits ?? 0,
      frames: frames.map(({ levels: _levels, changedFiles, ...frame }, index) => ({
        index,
        ...frame,
        changedFiles: changedFiles.size,
        stats: statistics[index]
      }))
    },
    summary,
    vocabulary: vocabulary(levels),
    levels
  };
}
