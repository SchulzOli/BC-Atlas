import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analyze } from "../analyzer.js";
import { analyzeProject, mergeArchitectureOptions, positiveInteger } from "../architecture.js";
import { loadConfig } from "../config.js";
import { resolveModel } from "../resolver.js";
import { loadProjectSymbols } from "../symbols.js";
import { objectFilter, pathMatcher } from "../views.js";
import { findLens } from "./lenses/index.js";
import { addMetrics } from "./metrics.js";
import { couplingWeights } from "./coupling.js";
import { replayHistory } from "./history.js";
import { createTemporalGraph, frameStatistics } from "./temporal.js";
import { annotateLevels } from "../blueprint/annotate.js";
import { proposeArchitecture } from "../blueprint/propose.js";
import { clusterByRelations } from "../blueprint/cluster.js";

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
 * Named clusters of the workspace objects from their typed, weighted relations
 * (the same clustering as the architecture proposal), one set per app or
 * module, so the explorer can color, group, and label what belongs together.
 */
function addClusters(levels, weights) {
  const owners = new Map([...(levels.app?.nodes ?? []), ...(levels.module?.nodes ?? [])].map((node) => [node.id, node.label]));
  const groups = new Map();
  for (const node of levels.object.nodes) {
    if (node.origin !== "workspace") continue;
    const owner = node.module ?? node.app;
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(node);
  }
  const clusters = new Map();
  for (const [owner, nodes] of groups) {
    const label = owners.get(owner) ?? "(no app)";
    if (nodes.length < 6) {
      for (const node of nodes) node.cluster = `${owner}|all`;
      clusters.set(`${owner}|all`, { label, alternatives: [], owner: label, size: nodes.length });
      continue;
    }
    for (const [id, cluster] of clusterByRelations(nodes, levels, weights, { prefix: `${owner}|` })) {
      const node = nodes.find((candidate) => candidate.id === id);
      node.cluster = cluster.key;
      const entry = clusters.get(cluster.key) ?? {
        label: cluster.label,
        alternatives: cluster.alternatives ?? [],
        owner: label,
        group: cluster.app?.key,
        size: 0,
        ...(cluster.shared ? { shared: true } : {})
      };
      entry.size++;
      clusters.set(cluster.key, entry);
    }
  }
  // Larger clusters keep the plain name; the others take a more precise one
  // ("Sales Post"), the name of their app or module, or a number.
  const used = new Map();
  for (const cluster of [...clusters.values()].sort((a, b) => b.size - a.size)) {
    const base = cluster.label;
    const elsewhere = used.has(base) && used.get(base) !== cluster.owner;
    const candidates = elsewhere ? [`${base} (${cluster.owner})`, ...cluster.alternatives] : [base, ...cluster.alternatives, `${base} (${cluster.owner})`];
    let name = candidates.find((candidate) => !used.has(candidate));
    for (let index = 2; !name; index++) if (!used.has(`${base} ${index}`)) name = `${base} ${index}`;
    used.set(name, cluster.owner);
    cluster.label = name;
  }
  return Object.fromEntries([...clusters].map(([key, { label, size, group, shared }]) => [key, { label, size, ...(group ? { group } : {}), ...(shared ? { shared } : {}) }]));
}

/**
 * Creates a temporal graph document for one lens: object and app levels with
 * metrics, plus one frame per sampled commit when `history` is set.
 */
export async function createGraphDocument(input, values = {}, { onFrame, parseCache: snapshotCache } = {}) {
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
  const symbols = await loadProjectSymbols(projectRoot);
  // A snapshot goes through the AL compiler when it is available. A timeline
  // stays source-level throughout so frames compare like with like.
  const compiled = !(options.history || options.historyBy);
  const graph = async (root) => lens.build(compiled && root === projectRoot
    ? await analyzeProject(projectRoot, options, { fileFilter, parseCache: snapshotCache })
    : resolveModel(await analyze(root, { parseCache, symbols, fileFilter })), { filter });

  // The target architecture: from .bca.json, or proposed from the current
  // source. Every frame is checked against the same one.
  let architecture = options.architecture?.components?.length && !values.propose ? options.architecture : undefined;
  let current;
  if (values.propose) {
    current = await graph(projectRoot);
    architecture = proposeArchitecture(current, { groupBy: values.groupBy, depth: values.depth, weights: couplingWeights(options.architecture?.couplingWeights) }).architecture;
  }
  let assessment;
  const build = async (root) => {
    const levels = root === projectRoot && current ? current : await graph(root);
    if (architecture) assessment = annotateLevels(levels, architecture);
    return levels;
  };

  // Frames keep their metadata; their graphs go straight into the merge.
  const frames = [];
  const temporal = createTemporalGraph();
  const addFrame = (frame) => {
    temporal.add(frame);
    frames.push({ ...frame, levels: undefined, ...(architecture ? { violations: assessment.summary.violations } : {}) });
  };
  let history;
  if (options.history || options.historyBy) {
    history = await replayHistory(projectRoot, {
      by: options.historyBy ?? "commits",
      maxCommits: positiveInteger(options.maxCommits, "max-commits", 60),
      last: options.last === undefined ? undefined : positiveInteger(options.last, "last"),
      since: options.since,
      fileFilter
    }, async (directory, frame, index, total) => {
      addFrame({ ...frame, levels: await build(directory) });
      onFrame?.(frame, index, total);
    });
  }
  if (!frames.length || history?.workingTreeChanges.length) {
    addFrame({
      id: "working-tree",
      kind: "working-tree",
      label: frames.length ? "Uncommitted changes" : "Current source",
      date: new Date().toISOString(),
      changedFiles: new Set(history?.workingTreeChanges ?? []),
      levels: await build(projectRoot)
    });
  }

  const levels = temporal.result();
  const weights = couplingWeights(options.architecture?.couplingWeights);
  const summary = Object.fromEntries(Object.entries(levels).map(([name, level]) => [name, addMetrics(level, { weights })]));
  const clusters = addClusters(levels, weights);
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
      ...(history ? { by: history.by, steps: history.steps } : {}),
      commits: history?.commits ?? 0,
      frames: frames.map(({ levels: _levels, changedFiles, ...frame }, index) => ({
        index,
        ...frame,
        changedFiles: changedFiles.size,
        stats: statistics[index]
      }))
    },
    summary,
    clusters,
    vocabulary: vocabulary(levels),
    ...(architecture ? {
      architecture: {
        mode: options.architecture?.components?.length && !values.propose ? "configured" : "proposal",
        components: architecture.components,
        summary: assessment.summary,
        // Structural work first; permission grants follow the components.
        workItems: [
          ...assessment.workItems.filter(({ strategy }) => strategy !== "move-permissions"),
          ...assessment.workItems.filter(({ strategy }) => strategy === "move-permissions")
        ].slice(0, 300).map(({ id, source, sourceComponent, targetComponent, strategy, title, effort, violations, steps, alternatives }) =>
          ({ id, source: source.id, sourceComponent, targetComponent, strategy, title, effort, violations, steps, alternatives }))
      }
    } : {}),
    levels
  };
}
