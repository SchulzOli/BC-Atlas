// Maps catalog command ids to their handlers. Command modules load on demand:
// importing all of them (the analyzer, the renderers, the docs pipeline) took
// most of the start-up time, which `--version`, help, and usage errors do not
// need. Plugin commands (`bca <plugin> <command>`) share one handler.

const MODULES = {
  setup: ["../commands/setup.js", "setupCommand"],
  "setup.plan": ["../commands/setup.js", "setupPlanCommand"],
  "setup.apply": ["../commands/setup.js", "setupApplyCommand"],
  "setup.agent": ["../commands/setup.js", "setupAgentCommand"],
  check: ["../commands/check.js", "checkCommand"],
  simulate: ["../commands/simulate.js", "simulateCommand"],
  architecture: ["../commands/blueprint.js", "architectureCommand"],
  "refactor.move": ["../commands/refactor.js", "refactorMoveCommand"],
  "refactor.surface": ["../commands/refactor.js", "refactorSurfaceCommand"],
  export: ["../commands/export.js", "exportCommand"],
  view: ["../commands/view.js", "viewCommand"],
  layers: ["../commands/layers.js", "layersCommand"],
  "graph.query": ["../commands/graph.js", "graphQueryCommand"],
  "graph.render": ["../commands/graph.js", "graphRenderCommand"],
  run: ["../commands/run.js", "runCommand"],
  update: ["../commands/update.js", "updateCommand"],
  "plugins.list": ["../commands/plugins.js", "pluginsListCommand"],
  "plugins.show": ["../commands/plugins.js", "pluginsShowCommand"],
  "plugins.doctor": ["../commands/plugins.js", "pluginsDoctorCommand"],
  "plugins.new": ["../commands/plugins.js", "pluginsNewCommand"]
};

// Literal specifiers, so bundlers (the VS Code extension) see every module.
const IMPORTS = {
  "../commands/setup.js": () => import("../commands/setup.js"),
  "../commands/check.js": () => import("../commands/check.js"),
  "../commands/simulate.js": () => import("../commands/simulate.js"),
  "../commands/layers.js": () => import("../commands/layers.js"),
  "../commands/blueprint.js": () => import("../commands/blueprint.js"),
  "../commands/refactor.js": () => import("../commands/refactor.js"),
  "../commands/export.js": () => import("../commands/export.js"),
  "../commands/view.js": () => import("../commands/view.js"),
  "../commands/graph.js": () => import("../commands/graph.js"),
  "../commands/run.js": () => import("../commands/run.js"),
  "../commands/update.js": () => import("../commands/update.js"),
  "../commands/plugins.js": () => import("../commands/plugins.js")
};

/**
 * Resolves the handler `(input, values) => Promise` of a catalog command.
 * @param definition the catalog entry (or its id)
 */
export async function loadHandler(definition, version) {
  const id = typeof definition === "string" ? definition : definition.id;
  if (typeof definition === "object" && definition.plugin) {
    const { runPluginCommand } = await IMPORTS["../commands/plugins.js"]();
    return (input, values) => runPluginCommand(definition, input, values);
  }
  if (id === "mcp") {
    const { startMcpServer } = await import("../mcp.js");
    return () => startMcpServer(version);
  }
  if (id.startsWith("docs.")) {
    const { DOCS_COMMANDS } = await import("../docs/cli.js");
    if (DOCS_COMMANDS[id]) return DOCS_COMMANDS[id];
  } else if (MODULES[id]) {
    const [specifier, name] = MODULES[id];
    const handler = (await IMPORTS[specifier]())[name];
    if (typeof handler === "function") return handler;
  }
  throw new Error(`no handler for command "${id}"`);
}
