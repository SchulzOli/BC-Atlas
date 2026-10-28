// One analyzed AL project, shared by the BC Atlas app (live server) and its
// static export. Every page reads from here, so the app, `bca check`,
// `bca architecture`, and `bca export` always show the same numbers.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createArchitectureModel } from "../architecture.js";
import { assessArchitecture } from "../blueprint/index.js";
import { writeBaseline } from "../blueprint/baseline.js";
import { architectureJson } from "../blueprint/report.js";
import { VIEWS } from "../capabilities.js";
import { runHealthCheck } from "../commands/check.js";
import { writeArchitectureConfig } from "../commands/blueprint.js";
import { renderD2 } from "../d2.js";
import { findGitRoot } from "../automation/git.js";
import { findUiTests } from "../automation/setup.js";
import { documentationHtml } from "../docs/export.js";
import { loadCorpus } from "../docs/model.js";
import { createGraphDocument } from "../graph/document.js";
import { renderExplorerHtml } from "../graph/html.js";
import { MAX_DIAGRAM_NODES, renderSvg } from "../svg.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

// Options that select what is analyzed; every page shares them.
const SHARED = ["projectRoot", "config", "namespace", "type", "include", "exclude", "paths"];
const DIAGRAM_OPTIONS = ["view", "object", "scope", "focus", "entry", "namespace", "groupBy", "direction", "moduleDepth", "objectInboundDepth", "objectOutboundDepth", "callDepth", "callDirection", "details", "noExternal"];

const MAX_EVIDENCE = 3;

const pick = (values, names) => Object.fromEntries(names.filter((name) => values[name] !== undefined && values[name] !== "").map((name) => [name, values[name]]));

function sourceUrl(template, options, file, line) {
  if (!template || !file) return undefined;
  const prefixed = [options.sourcePathPrefix, file.replaceAll("\\", "/")].filter(Boolean).join("/").replaceAll(/\/+/gu, "/");
  return template
    .replaceAll("{file}", prefixed)
    .replaceAll("{line}", String(line ?? 1))
    .replaceAll("{ref}", options.sourceRef ?? "main");
}

const members = (items, read) => (items ?? []).map(read).filter(Boolean);

export class Workspace {
  /**
   * @param input app or workspace folder (the focus when projectRoot is set)
   * @param values the shared CLI options: projectRoot, config, filters, paths
   * @param live whether the files on disk can be opened and changed
   */
  constructor(input, values = {}, { live = true } = {}) {
    this.input = path.resolve(input);
    this.values = pick(values, SHARED);
    this.live = live;
    this.generation = 0;
    this.reset();
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
      return { ...await runHealthCheck(this.input, this.values, { cache }), cache };
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
  assessment({ propose = false, groupBy = "auto", depth, minObjects } = {}) {
    const settings = { propose: Boolean(propose), groupBy, depth: depth || undefined, minObjects: minObjects || undefined };
    return this.remember(`architecture:${JSON.stringify(settings)}`, async () => {
      // A path selection needs its own parse; otherwise reuse the shared one.
      const reuse = this.values.paths?.length ? undefined : structuredClone((await this.model()).model);
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
      unassigned: unassigned.slice(0, 200),
      workItems: json.workItems.map((item) => ({ ...item, evidence: item.evidence.slice(0, MAX_EVIDENCE) })),
      violationCount: violations.length
    };
  }

  /** Saves a proposal as the configured architecture (and optionally accepts today's violations). */
  async adoptArchitecture(settings = {}, { updateBaseline = true } = {}) {
    const assessment = await this.assessment({ ...settings, propose: true });
    const file = await writeArchitectureConfig(assessment);
    if (updateBaseline) await writeBaseline(assessment.context.baselineFile, assessment.result.violations);
    this.reset();
    return { file, accepted: updateBaseline ? assessment.result.violations.length : 0 };
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
      const byFile = new Map();
      for (const object of model.objects) {
        if (!object.file || !nodes.has(object.key)) continue;
        const list = byFile.get(object.file) ?? [];
        list.push(object);
        byFile.set(object.file, list);
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
          members: object ? {
            fields: members(object.fields, ({ name, number, type, kind }) => ({ name, number, type, kind })),
            keys: members(object.keys, (key) => ({ name: key.name, fields: key.fields })),
            procedures: members(object.procedures, ({ name, kind, visibility, signature, attributes, location }) => ({
              name, kind, visibility, signature, line: location?.line,
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
        const candidates = byFile.get(file);
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

  /** Renders one diagram view as SVG. */
  async diagram(request = {}) {
    const options = pick(request, DIAGRAM_OPTIONS);
    for (const name of ["namespace", "scope", "entry"]) {
      if (typeof options[name] === "string") options[name] = [options[name]];
    }
    const key = `diagram:${JSON.stringify(options)}`;
    return this.remember(key, async () => {
      const projection = await createArchitectureModel(this.input, { ...this.values, ...options }, { cache: this.cache });
      const nodes = projection.model.objects.length;
      if (!nodes) {
        return { view: projection.view, nodes: 0, edges: 0, empty: projection.model.emptyMessage ?? "No matching objects." };
      }
      if (nodes > MAX_DIAGRAM_NODES) {
        return {
          view: projection.view, nodes, edges: projection.model.edges.length,
          empty: `${nodes.toLocaleString("en-US")} nodes are too many to draw (at most ${MAX_DIAGRAM_NODES.toLocaleString("en-US")}). Filter by namespace, or choose a focused view such as module, object, boundary, or workflow.`
        };
      }
      const d2 = renderD2(projection.model, projection.renderOptions);
      return {
        view: projection.view,
        nodes: projection.model.objects.length,
        edges: projection.model.edges.length,
        d2,
        svg: await renderSvg(d2, projection.options)
      };
    });
  }

  views() {
    return VIEWS.map(([id, summary]) => ({ id, summary }));
  }

  /** The 3D dependency explorer for this project, as one HTML page. */
  explorer({ propose = false, history = false } = {}) {
    return this.remember(`explorer:${propose}:${history}`, async () => {
      const document = await createGraphDocument(this.input, { ...this.values, propose: propose || undefined, history: history || undefined });
      return renderExplorerHtml(document);
    });
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

  docsHtml() {
    return this.remember("docs-html", async () => {
      const docs = await this.docs();
      if (!docs) return undefined;
      const root = await this.projectRoot();
      return documentationHtml(docs.corpus, {
        mode: docs.settings.as,
        language: docs.settings.language,
        title: docs.settings.title,
        appRoot: path.resolve(root, docs.settings.app ?? ".")
      });
    });
  }
}
