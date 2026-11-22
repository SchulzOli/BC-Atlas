// One analyzed AL project, shared by the VS Code extension (worker.js) and its
// static export. The one view reads from here (atlas.js), so the app,
// `bca check`, `bca layers`, and `bca export` always show the same.
import { readFileSync } from "node:fs";
import path from "node:path";
import { runHealthCheck } from "../commands/check.js";
import { linkGuides, loadGuideCorpus } from "../guides.js";
import { openParseCache } from "../parse-cache.js";
import { commonSources, createAtlas, createInside, sourceUrl } from "./atlas.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

// Options that select what is analyzed; every page shares them.
const SHARED = ["projectRoot", "config", "namespace", "type", "include", "exclude", "paths", "alSettings", "alEditorSettings"];

const MAX_EVIDENCE = 3;
// In an editor the parse cache is written after this many milliseconds without a new analysis: writing it took
// as long as the analysis of a save, and a burst of saves needs it written once.
const SAVE_DELAY = 3000;

const pick = (values, names) => Object.fromEntries(names.filter((name) => values[name] !== undefined && values[name] !== "").map((name) => [name, values[name]]));

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

  /**
   * Parse results by file content, kept across generations and on disk, so
   * a changed file or a new editor session parses only what changed.
   */
  parseCache() {
    return (this.parsing ??= openParseCache(this.input));
  }

  /** Forgets every result; the next request analyzes the source again. */
  reset() {
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
      const parseCache = await this.parseCache();
      const result = await runHealthCheck(this.input, this.values, { parseCache, guideCorpus: (options) => this.guideCorpus(options) });
      this.scheduleSave(parseCache);
      return result;
    });
  }

  /**
   * Writes the parse cache: at once for a single run, and in an editor when the saves have settled.
   * A failed write only costs the next start a parse. `saving` is the promise of the last write.
   */
  scheduleSave(parseCache) {
    if (!this.live) {
      this.saving = parseCache.save().catch(() => false);
      return;
    }
    clearTimeout(this.saveTimer);
    this.pendingSave = () => {
      clearTimeout(this.saveTimer);
      this.pendingSave = undefined;
      return (this.saving = parseCache.save().catch(() => false));
    };
    this.saveTimer = setTimeout(() => this.pendingSave?.(), SAVE_DELAY);
    this.saveTimer.unref?.();
  }

  /** Writes what is not written yet; resolves with whether anything was written. */
  async flush() {
    return this.pendingSave ? this.pendingSave() : (this.saving ?? false);
  }

  /**
   * Everything that was read (one parse per generation): the model, the
   * merged options, and what is selected.
   */
  async model() {
    const { loaded } = await this.health();
    return { model: loaded.project, options: loaded.options, context: loaded.context };
  }

  /** What depends on what, at the level of objects, namespaces, and apps. */
  levels() {
    return this.remember("levels", async () => (await this.health()).levels);
  }

  async projectRoot() {
    return (await this.model()).options.projectRoot;
  }

  async overview() {
    const [{ report }, { model, options, context }] = await Promise.all([this.health(), this.model()]);
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
      // What every page is read from.
      sources: commonSources({ model, context }),
      config: context.config.path ? path.relative(this.input, context.config.path).replaceAll("\\", "/") || ".bca.json" : undefined
    };
  }

  async healthReport() {
    const [{ report }, index] = await Promise.all([this.health(), this.objectIndex()]);
    return {
      ...report,
      findings: report.findings.map((finding) => ({ ...finding, object: index.locate(finding.file, finding.line) }))
    };
  }

  /** Every object with its links, keyed by graph node ID. */
  objectIndex() {
    return this.remember("objects", async () => {
      const [{ model, options }, levels] = await Promise.all([this.model(), this.levels()]);
      const raw = new Map(model.objects.map((object) => [object.key, object]));
      const nodes = new Map(levels.object.nodes.map((node) => [node.id, node]));
      const links = new Map([...nodes.keys()].map((id) => [id, { uses: [], usedBy: [] }]));
      for (const edge of levels.object.edges) {
        const link = { kinds: edge.kinds, weight: edge.weight, dependency: edge.dependency, evidence: (edge.evidence ?? []).slice(0, MAX_EVIDENCE) };
        links.get(edge.source)?.uses.push({ ...link, id: edge.target });
        links.get(edge.target)?.usedBy.push({ ...link, id: edge.source });
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
        uses: links.get(node.id).uses.length,
        usedBy: links.get(node.id).usedBy.length
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
          properties: (object?.properties ?? []).map(({ name, value }) => ({ name, value })),
          metadata: object?.metadata,
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

  /**
   * The documented UI tests (src/guides.js), read once per generation. The
   * folder they are in is found once: looking for it parses every candidate.
   */
  guideCorpus(options) {
    return this.remember("guide-corpus", async () => {
      const found = await loadGuideCorpus(this.testsPath && !options.docs?.tests ? { ...options, docs: { ...options.docs, tests: this.testsPath } } : options);
      if (found) this.testsPath = found.path;
      return found;
    });
  }

  /** UI-test documentation: from .bca.json (docs.tests) or the folder with the most scenarios. */
  docs() {
    return this.remember("docs", async () => {
      const { options } = await this.model();
      const found = await this.guideCorpus(options);
      if (!found?.corpus.scenarios.length) return undefined;
      return { path: found.path, scenarios: found.corpus.scenarios.length, corpus: found.corpus, settings: { ...(options.docs ?? {}) } };
    });
  }

  /** The guides joined with the source: the pages each one uses, and what is not documented (src/guides.js). */
  guides() {
    return this.remember("guides", async () => {
      const { model, options } = await this.model();
      return linkGuides(model, await this.guideCorpus(options), options);
    });
  }
}
