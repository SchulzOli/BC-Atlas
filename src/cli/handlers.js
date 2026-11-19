// Maps catalog command ids to their handlers. Command modules load on demand:
// importing all of them (the analyzer, the renderers, the docs pipeline) took
// most of the start-up time, which `--version`, help, and usage errors do not
// need.

const MODULES = {
  check: ["../commands/check.js", "checkCommand"],
  architecture: ["../commands/blueprint.js", "architectureCommand"],
  export: ["../commands/export.js", "exportCommand"],
  view: ["../commands/view.js", "viewCommand"],
  layers: ["../commands/layers.js", "layersCommand"],
  "architecture.compare": ["../commands/architecture-target.js", "compareCommand"],
  "architecture.templates": ["../commands/architecture-target.js", "templatesCommand"]
};

// Literal specifiers, so bundlers (the VS Code extension) see every module.
const IMPORTS = {
  "../commands/check.js": () => import("../commands/check.js"),
  "../commands/layers.js": () => import("../commands/layers.js"),
  "../commands/blueprint.js": () => import("../commands/blueprint.js"),
  "../commands/architecture-target.js": () => import("../commands/architecture-target.js"),
  "../commands/export.js": () => import("../commands/export.js"),
  "../commands/view.js": () => import("../commands/view.js")
};

/**
 * Resolves the handler `(input, values) => Promise` of a catalog command.
 * @param definition the catalog entry (or its id)
 */
export async function loadHandler(definition, version) {
  const id = typeof definition === "string" ? definition : definition.id;
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
