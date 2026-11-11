// What a plugin receives in activate(context): the project, its own config section, a log, the
// services of BC Atlas, and the extension points of other plugins. Plugins never import BC Atlas
// internals; everything they may use is here and versioned with the plugin API.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN_API_VERSION } from "./manifest.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

/** Services a plugin may call; each loads the heavy BC Atlas parts only when used. */
export function createServices({ root, config = {}, values = {} }) {
  return {
    /** The architecture model: objects with their component, components with their layer. */
    async atlasModel() {
      const { Workspace } = await import("../app/workspace.js");
      const workspace = new Workspace(root, values, { live: false });
      const [overview, architecture, index] = await Promise.all([workspace.overview(), workspace.architecture(), workspace.objectIndex()]);
      return { overview: { title: overview.title }, architecture, objects: index.list };
    },
    /**
     * The atlas: everything BC Atlas reads from the source as one graph (src/app/atlas.js):
     * nodes, relations, edges, lenses, findings, stories, and the simulation as it is defined.
     * @param project another project than the one of the session (an MCP tool is given its path)
     */
    async atlas(project = root) {
      const { Workspace } = await import("../app/workspace.js");
      return new Workspace(project, values, { live: false }).atlas();
    },
    /** Renders AL UI tests with the BC Atlas docs pipeline (guides, test cases, DITA, BPMN, ...). */
    async renderDocs({ testsDir, outputDir, formats = ["markdown"], mode = "guide", language, title }) {
      const [{ loadCorpus }, { exportDocumentation }] = await Promise.all([import("../docs/model.js"), import("../docs/export.js")]);
      const corpus = await loadCorpus(testsDir);
      const result = await exportDocumentation(corpus, {
        formats,
        mode,
        language,
        title,
        appRoot: path.resolve(root, config.docs?.app ?? "."),
        outputDirectory: outputDir
      });
      return { warnings: result.warnings ?? [], scenarios: result.catalog?.tasks?.length ?? 0 };
    }
  };
}

/**
 * @param plugin   registry entry ({ id, manifest, dir, source })
 * @param registry the PluginRegistry (session: root, config, trigger, log, values)
 */
export function createPluginContext(plugin, registry) {
  const session = registry.session;
  const services = createServices(session);
  return {
    apiVersion: PLUGIN_API_VERSION,
    plugin: { id: plugin.id, version: plugin.manifest.version, dir: plugin.dir, source: plugin.source },
    bcAtlas: { name: pkg.name, version: pkg.version },
    root: session.root,
    config: session.config,
    /** The plugin's own section of .bca.json (manifest configKey). */
    settings: session.config[plugin.manifest.configKey],
    get trigger() {
      return registry.session.trigger;
    },
    log: (line) => registry.session.log(line),
    services: {
      ...services,
      /** Per-plugin cache folder (not committed): <project>/.bca/cache/<plugin>. */
      cacheDir: path.join(session.root, ".bca", "cache", plugin.id)
    },
    extensions: {
      /** Contributions of all enabled plugins to an extension point, e.g. "sync.sources". */
      get: (pointId) => registry.extensions(pointId)
    },
    plugins: {
      list: () => registry.list().map(({ id, manifest, enabled, source }) => ({ id, version: manifest.version, enabled, source }))
    }
  };
}
