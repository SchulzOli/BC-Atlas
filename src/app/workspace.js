// One analyzed AL project, shared by the VS Code extension (worker.js) and its
// static export. The one view reads from here (atlas.js), so the app,
// `bca check`, `bca architecture`, and `bca export` always show the same.
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { assessArchitecture } from "../blueprint/index.js";
import { writeBaseline } from "../blueprint/baseline.js";
import { architectureJson } from "../blueprint/report.js";
import { dependencyMatrix } from "../blueprint/drilldown.js";
import { planExtraction } from "../blueprint/extract.js";
import { runHealthCheck } from "../commands/check.js";
import { writeArchitectureConfig } from "../commands/blueprint.js";
import { findGitRoot } from "../automation/git.js";
import { findUiTests } from "../automation/setup.js";
import { loadCorpus } from "../docs/model.js";
import { openParseCache } from "../parse-cache.js";
import { simulate } from "../simulation/index.js";
import { explainPlacement, placementIndex } from "../blueprint/explain.js";
import { proposalSettings } from "../blueprint/settings.js";
import { commonSources, createAtlas, createInside, sourceUrl } from "./atlas.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

// Options that select what is analyzed; every page shares them.
const SHARED = ["projectRoot", "config", "namespace", "type", "include", "exclude", "paths", "compiler", "compilerLog", "analyzers", "alSettings", "alEditorSettings", "alExtensionPath"];

const MAX_EVIDENCE = 3;

const pick = (values, names) => Object.fromEntries(names.filter((name) => values[name] !== undefined && values[name] !== "").map((name) => [name, values[name]]));

const members = (items, read) => (items ?? []).map(read).filter(Boolean);

export class Workspace {
  /**
   * @param input app or workspace folder (the focus when projectRoot is set)
   * @param values the shared CLI options: projectRoot, config, filters, paths
   * @param live whether the files on disk can be opened and changed
   * @param onAlUpdate called when the AL compiler finished in the background
   *   with new results (editors); without it, analysis waits for the compiler
   */
  constructor(input, values = {}, { live = true, onAlUpdate } = {}) {
    this.input = path.resolve(input);
    this.values = pick(values, SHARED);
    this.live = live;
    this.onAlUpdate = onAlUpdate;
    this.generation = 0;
    this.reset();
  }

  /**
   * Parse results by file content, kept across generations and on disk, so
   * a changed file or a new editor session parses only what changed.
   */
  parseCache() {
    return (this.parsing ??= openParseCache(this.input));
  }

  /** Forgets every result; the next request analyzes the source again. */
  reset() {
    this.cache = new Map();
    this.memo = new Map();
    this.generation++;
    this.updatedAt = new Date().toISOString();
  }

  remember(key, compute) {
    const memo = this.memo;
    if (!memo.has(key)) {
      const promise = compute();
      memo.set(key, promise);
      // A failed computation is retried by the next request of this generation.
      promise.catch(() => {
        if (memo.get(key) === promise) memo.delete(key);
      });
    }
    return memo.get(key);
  }

  health() {
    return this.remember("health", async () => {
      const cache = this.cache;
      const parseCache = await this.parseCache();
      const result = await runHealthCheck(this.input, this.values, { cache, parseCache, onAlUpdate: this.onAlUpdate });
      // Written in the background; a failed write only costs the next start a parse.
      this.saving = parseCache.save().catch(() => false);
      return { ...result, cache };
    });
  }

  /** The resolved model behind every page (one parse per generation). */
  async model() {
    const { architecture, cache } = await this.health();
    return { model: cache.get(architecture.options.projectRoot), options: architecture.options };
  }

  async projectRoot() {
    return (await this.model()).options.projectRoot;
  }

  /** The configured architecture, or a proposal when there is none or `propose` is set. */
  assessment({ propose = false, groupBy, depth, minObjects, startFrom, ignore, granularity, sharedCore } = {}) {
    // Unset values fall back to architecture.proposal in .bca.json, then the defaults.
    const settings = { propose: Boolean(propose), groupBy: groupBy || undefined, depth: depth || undefined, minObjects: minObjects || undefined, startFrom, ignore, granularity, sharedCore };
    return this.remember(`architecture:${JSON.stringify(settings)}`, async () => {
      // A path selection needs its own parse; otherwise reuse the shared one
      // as it is: the architecture pages only read it (a test freezes it).
      const reuse = this.values.paths?.length ? undefined : (await this.model()).model;
      return assessArchitecture(this.input, { ...this.values, ...settings }, { model: reuse });
    });
  }

  async overview() {
    const [{ report }, assessment, docs] = await Promise.all([this.health(), this.assessment(), this.docs()]);
    const { options } = await this.model();
    const { summary } = assessment.result;
    const layers = new Set(assessment.result.components.map(({ layer }) => layer).filter((layer) => layer !== undefined)).size;
    return {
      title: options.title?.replace(/ architecture$/u, "") ?? (report.summary.apps.length === 1 ? report.summary.apps[0].name : path.basename(this.input)),
      root: this.input,
      // File paths in findings and object pages are relative to this folder.
      projectRoot: options.projectRoot,
      version: pkg.version,
      live: this.live,
      updatedAt: this.updatedAt,
      summary: report.summary,
      health: { passed: report.passed, failOn: report.failOn, counts: report.counts, findings: report.findings.slice(0, 6), hubs: report.hubs },
      architecture: {
        mode: assessment.proposal ? "proposal" : "configured",
        components: summary.components,
        layers,
        violations: summary.violations,
        workItems: summary.workItems,
        extractable: summary.extractable,
        cycles: summary.cycles,
        baseline: { new: assessment.baseline.new.length, known: assessment.baseline.known.length, fixed: assessment.baseline.fixed.length }
      },
      docs: { scenarios: docs?.scenarios ?? 0, path: docs?.path },
      // What every page is read from.
      sources: commonSources({ model: (await this.model()).model, assessment }),
      config: assessment.context.config.path ? path.relative(this.input, assessment.context.config.path).replaceAll("\\", "/") || ".bca.json" : undefined
    };
  }

  async healthReport() {
    const [{ report }, index] = await Promise.all([this.health(), this.objectIndex()]);
    return {
      ...report,
      findings: report.findings.map((finding) => ({ ...finding, object: index.locate(finding.file, finding.line) }))
    };
  }

  /** The architecture page: the assessment without the per-dependency list. */
  async architecture(settings = {}) {
    const assessment = await this.assessment(settings);
    const { violations, unassigned, ...json } = architectureJson(assessment);
    return {
      ...json,
      configured: Boolean(assessment.context.options.architecture?.components?.length),
      // Where dependencies should be (the rules) and where they are (object links).
      matrix: dependencyMatrix(assessment),
      unassigned: unassigned.slice(0, 200),
      workItems: json.workItems.map((item) => ({ ...item, evidence: item.evidence.slice(0, MAX_EVIDENCE) })),
      violationCount: violations.length,
      // One extraction plan per component; components without objects of their own have none.
      extractions: Object.fromEntries(assessment.result.components.flatMap(({ name }) => {
        try {
          return [[name, planExtraction(assessment, name)]];
        } catch {
          return [];
        }
      }))
    };
  }

  /**
   * The battle test (src/simulation): agents with the company's roles perform
   * the process tests. Undefined without documented UI tests.
   */
  battleTest({ language } = {}) {
    return this.remember(`battle-test:${language ?? ""}`, async () => {
      const docs = await this.docs();
      if (!docs) return undefined;
      const { cache } = await this.health();
      const { options } = await this.model();
      return simulate(this.input, {
        ...this.values,
        tests: path.resolve(options.projectRoot, options.simulation?.tests ?? docs.path),
        language: language ?? options.simulation?.language
      }, { cache, parseCache: await this.parseCache() });
    });
  }

  /**
   * Changes the simulation (src/simulation/define.js) in .bca.json and runs it.
   * @param change { operations, init, dryRun }
   * @returns { file, written, derived, definition, line, passed }
   */
  async defineSimulation({ operations = [], init = false, dryRun = false } = {}) {
    const { options } = await this.model();
    const docs = await this.docs();
    const { defineSimulation } = await import("../simulation/define.js");
    const { simulationResultLine } = await import("../simulation/report.js");
    const result = await defineSimulation(this.input, {
      ...this.values,
      tests: path.resolve(options.projectRoot, options.simulation?.tests ?? docs?.path ?? "."),
      operations,
      init,
      dryRun
    }, { parseCache: await this.parseCache() });
    if (result.written) this.reset();
    return { file: result.file, written: result.written, derived: result.derived, definition: result.definition, line: simulationResultLine(result.report), passed: result.report.passed };
  }

  /** Saves a proposal as the configured architecture (and optionally accepts today's violations). */
  async adoptArchitecture(settings = {}, { updateBaseline = true } = {}) {
    const assessment = await this.assessment({ ...settings, propose: true });
    const file = await writeArchitectureConfig(assessment);
    if (updateBaseline) await writeBaseline(assessment.context.baselineFile, assessment.result.violations);
    this.reset();
    return { file, accepted: updateBaseline ? assessment.result.violations.length : 0 };
  }

  /**
   * Changes what the proposal takes into account, in architecture.proposal of
   * .bca.json: keep a component as it is (or release it), exclude an object
   * from shaping components (or include it again).
   * @param change { keep: { name, match, description }, release: name, exclude: selector, include: selector }
   */
  async updateProposal(change = {}) {
    const assessment = await this.assessment();
    const file = assessment.context.config.path ?? path.join(assessment.context.projectRoot, ".bca.json");
    let config = {};
    try {
      config = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const proposal = { ...(config.architecture?.proposal ?? {}) };
    const keep = [...(proposal.keep ?? [])];
    const exclude = [proposal.exclude ?? []].flat();
    if (change.keep) {
      if (!change.keep.name || ![change.keep.match].flat().filter(Boolean).length) throw new Error("keep needs a name and match selectors");
      const index = keep.findIndex(({ name }) => name === change.keep.name);
      const entry = { name: change.keep.name, match: [change.keep.match].flat(), ...(change.keep.description ? { description: change.keep.description } : {}) };
      if (index >= 0) keep[index] = entry;
      else keep.push(entry);
    }
    if (change.release) keep.splice(0, keep.length, ...keep.filter(({ name }) => name !== change.release));
    if (change.exclude && !exclude.includes(change.exclude)) exclude.push(change.exclude);
    if (change.include) exclude.splice(0, exclude.length, ...exclude.filter((selector) => selector !== change.include));
    if (keep.length) proposal.keep = keep;
    else delete proposal.keep;
    if (exclude.length) proposal.exclude = exclude;
    else delete proposal.exclude;
    // Fails before anything is written when the result is not valid.
    proposalSettings({ ...(config.architecture ?? {}), proposal });
    config.architecture = { ...(config.architecture ?? {}), proposal };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    this.reset();
    return { file, keep: keep.map(({ name }) => name), exclude };
  }

  async updateBaseline() {
    const assessment = await this.assessment();
    if (assessment.proposal) throw new Error("no architecture is configured yet; adopt a proposal first");
    await writeBaseline(assessment.context.baselineFile, assessment.result.violations);
    this.reset();
    return { file: assessment.context.baselineFile, accepted: assessment.result.violations.length };
  }

  /** Every object with its links, component, and violations, keyed by graph node ID. */
  objectIndex() {
    return this.remember("objects", async () => {
      const [{ model, options }, assessment] = await Promise.all([this.model(), this.assessment()]);
      const { levels, result } = assessment;
      let placements;
      const raw = new Map(model.objects.map((object) => [object.key, object]));
      const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
      const links = new Map([...nodes.keys()].map((id) => [id, { uses: [], usedBy: [] }]));
      for (const edge of levels.object.edges) {
        const link = { kinds: edge.kinds, weight: edge.weight, dependency: edge.dependency, evidence: (edge.evidence ?? []).slice(0, MAX_EVIDENCE) };
        links.get(edge.source)?.uses.push({ ...link, id: edge.target });
        links.get(edge.target)?.usedBy.push({ ...link, id: edge.source });
      }
      const violations = new Map();
      for (const violation of result.violations) {
        const list = violations.get(violation.source.id) ?? [];
        list.push(violation);
        violations.set(violation.source.id, list);
      }
      // Findings and the model may differ in path separators on Windows.
      const posix = (file) => file?.replaceAll("\\", "/");
      const byFile = new Map();
      for (const object of model.objects) {
        if (!object.file || !nodes.has(object.key)) continue;
        const list = byFile.get(posix(object.file)) ?? [];
        list.push(object);
        byFile.set(posix(object.file), list);
      }
      const summary = (node) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        objectId: node.objectId,
        namespace: node.namespace,
        app: levels.app.nodes.find(({ id }) => id === node.app)?.label,
        file: node.file,
        line: node.line,
        origin: node.origin,
        component: result.assignment.get(node.id),
        uses: links.get(node.id).uses.length,
        usedBy: links.get(node.id).usedBy.length,
        violations: violations.get(node.id)?.length ?? 0
      });
      const list = [...nodes.values()].filter(({ origin }) => origin === "workspace").map(summary);
      const detail = (id) => {
        const node = nodes.get(id);
        if (!node) return undefined;
        const object = raw.get(id);
        const describe = (link) => ({ ...summary(nodes.get(link.id)), kinds: link.kinds, weight: link.weight, dependency: link.dependency, evidence: link.evidence });
        const location = object?.location?.line ?? node.line;
        const absolute = node.file ? path.join(options.projectRoot, node.file) : undefined;
        return {
          ...summary(node),
          uses: links.get(id).uses.map(describe).sort((a, b) => b.weight - a.weight),
          usedBy: links.get(id).usedBy.map(describe).sort((a, b) => b.weight - a.weight),
          violations: (violations.get(id) ?? []).map(({ rule, target, targetComponent, kinds, resolution, evidence }) => ({
            rule, target, targetComponent, kinds, evidence: evidence.slice(0, MAX_EVIDENCE),
            resolution: { strategy: resolution.strategy, title: resolution.title, effort: resolution.effort, steps: resolution.steps }
          })),
          properties: (object?.properties ?? []).map(({ name, value }) => ({ name, value })),
          metadata: object?.metadata,
          // Why it is in its component: the selector and its coupling to each component.
          placement: explainPlacement(assessment, id, (placements ??= placementIndex(assessment))),
          members: object ? {
            fields: members(object.fields, ({ name, number, type, kind }) => ({ name, number, type, kind })),
            keys: members(object.keys, (key) => ({ name: key.name, fields: key.fields })),
            procedures: members(object.procedures, ({ name, kind, visibility, signature, attributes, location, metadata }) => ({
              name, kind, visibility, signature, line: location?.line,
              lines: metadata?.lines, complexity: metadata?.complexity, documentation: metadata?.documentation,
              event: (attributes ?? []).some((attribute) => /EventSubscriber|IntegrationEvent|BusinessEvent|InternalEvent/iu.test(attribute))
            })),
            actions: members(object.actions, ({ name, container }) => ({ name, container })),
            parts: members(object.parts, ({ name, target }) => ({ name, target }))
          } : undefined,
          source: {
            file: node.file,
            line: location,
            editor: this.live && absolute ? `vscode://file/${absolute.replaceAll("\\", "/")}:${location ?? 1}` : undefined,
            url: sourceUrl(options.sourceUrl, options, node.file, location)
          }
        };
      };
      // Maps a file and line (as findings report them) to the object there.
      const locate = (file, line) => {
        const candidates = byFile.get(posix(file));
        if (!candidates?.length) return undefined;
        const inside = candidates.find(({ location }) => location && line >= location.line && line <= (location.endLine ?? location.line));
        return (inside ?? (candidates.length === 1 ? candidates[0] : undefined))?.key;
      };
      return { list, detail, locate };
    });
  }

  async objects() {
    return (await this.objectIndex()).list;
  }

  async object(id) {
    return (await this.objectIndex()).detail(id);
  }

  /** Everything read from the source as one graph, with its lenses, findings, and stories (atlas.js). */
  atlas() {
    return this.remember("atlas", () => createAtlas(this));
  }

  /** One object from the inside: its members and what each does with other objects. */
  inside(id) {
    return this.remember(`inside:${id}`, () => createInside(this, id));
  }

  /** UI-test documentation: from .bca.json (docs.tests) or the folder with the most scenarios. */
  docs() {
    return this.remember("docs", async () => {
      const { options } = await this.model();
      const root = options.projectRoot;
      let relative = options.docs?.tests;
      if (!relative) {
        const found = await findUiTests(root, await findGitRoot(root)).catch(() => undefined);
        if (!found?.scenarios) return undefined;
        relative = found.path;
      }
      const corpus = await loadCorpus(path.resolve(root, relative)).catch(() => undefined);
      if (!corpus?.scenarios.length) return undefined;
      return { path: relative, scenarios: corpus.scenarios.length, corpus, settings: { ...(options.docs ?? {}) } };
    });
  }
}
