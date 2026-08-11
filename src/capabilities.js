const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const flag = (description) => ({ type: "boolean", description });

const architectureOptions = {
  view: string("Architecture projection.", {
    enum: ["project", "module", "object", "data", "call", "boundary", "contracts", "events", "ui", "workflow"]
  }),
  output: string("Output file path.", { cli: "--output", short: "-o" }),
  format: string("Output format.", { enum: ["d2", "json", "svg", "png", "pdf"] }),
  object: string("Object name, ID, key, or typed selector such as codeunit:50100."),
  objectInboundDepth: string("Non-negative incoming depth for object focus."),
  objectOutboundDepth: string("Non-negative outgoing depth for object focus."),
  members: string("Comma-separated fields,actions,triggers,events,procedures."),
  scope: string("Boundary selector prefixed with namespace:, folder:, app:, or object:.", { repeatable: true }),
  focus: string("Name fragment for contracts, events, or UI views."),
  projectRoot: string("App or multi-app workspace root analyzed before focus filtering.", {
    cli: "--project-root"
  }),
  entry: string("Workflow procedure, trigger, action, or event selector.", { repeatable: true }),
  namespace: string("Namespace glob.", { repeatable: true }),
  type: string("Comma-separated AL object types.", { repeatable: true }),
  include: string("File or object glob.", { repeatable: true }),
  exclude: string("File or object glob.", { repeatable: true }),
  groupBy: string("Grouping mode.", {
    cli: "--group-by",
    enum: ["namespace", "folder", "type", "role"]
  }),
  moduleDepth: string("Positive integer or auto.", { cli: "--module-depth" }),
  folderDepth: string("Positive integer.", { cli: "--folder-depth" }),
  includeUnresolvedCalls: flag("Include unresolved and isolated calls."),
  rootProcedure: string("Call root procedure selector.", { repeatable: true }),
  callDepth: string("Non-negative call traversal depth."),
  callDirection: string("Call traversal direction.", {
    enum: ["incoming", "outgoing", "both"]
  }),
  expandProcedures: flag("Expand owning-object call aggregates into procedures."),
  expandFrameworkCalls: flag("Show individual framework and standard-library calls."),
  workflowDepth: string("Positive traversal depth.", { cli: "--workflow-depth" }),
  workflowMaxNodes: string("Positive workflow node cap.", { cli: "--workflow-max-nodes" }),
  workflowEdgeTypes: string("Comma-separated calls,events,writes,reads.", { cli: "--workflow-edge-types" }),
  maxEdges: string("Positive diagram edge cap.", { cli: "--max-edges" }),
  direction: string("Diagram direction.", { enum: ["right", "down", "left", "up"] }),
  title: string("Diagram title."),
  sourceUrl: string("Node-link template containing {file} and optionally {line}.", { cli: "--source-url" }),
  sourceRef: string("Commit or branch substituted for {ref} in source links."),
  sourcePathPrefix: string("Repository-relative prefix prepended to {file}."),
  noLegend: flag("Hide edge and confidence legends."),
  details: flag("Show member counts."),
  noExternal: flag("Hide unresolved and external dependencies."),
  config: string("Configuration file path."),
  strict: flag("Fail on warning or error diagnostics.")
};

const docsFormat = string("Output mode.", { enum: ["text", "json"], default: "text" });

const cliName = (name) => `--${name.replaceAll(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase()}`;

const command = (id, argv, purpose, options, output, rules = []) => ({
  id,
  argv,
  purpose,
  options: Object.fromEntries(Object.entries(options).map(([name, definition]) => [
    name,
    { cli: cliName(name), ...definition }
  ])),
  output,
  rules
});

export function createCapabilities(version) {
  return {
    schemaVersion: 1,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use inspect or docs commands with --format json. Parse stdout only after exit code 0."
    },
    exitCodes: { success: 0, operation: 1, usage: 2 },
    conventions: {
      optionSyntax: "Use each option as a separate argv token. Repeat repeatable options.",
      paths: "Pass paths as single argv values; do not build a shell command string.",
      mutations: "Use --dry-run first and pass --expected-hash when writing AL metadata.",
      sourceOfTruth: "AL source is authoritative; generated JSON, Markdown, D2, and SVG are outputs."
    },
    commands: [
      command(
        "capabilities",
        ["bca", "capabilities"],
        "Discover this machine contract.",
        {},
        { type: "json", schema: "CapabilityManifest" }
      ),
      command(
        "graph",
        ["bca", "graph", "<app-root>"],
        "Write an architecture diagram or model file.",
        architectureOptions,
        { type: "file", pathOption: "output", default: "bc-atlas.d2" },
        ["object view requires --object", "boundary view requires at least one --scope"]
      ),
      command(
        "graph.workflow",
        ["bca", "graph", "<app-root>"],
        "Write a bounded workflow diagram.",
        {
          ...architectureOptions,
          view: { type: "string", const: "workflow", required: true },
          entry: { ...architectureOptions.entry, required: true }
        },
        { type: "file", pathOption: "output", default: "bc-atlas.d2" }
      ),
      command(
        "inspect",
        ["bca", "inspect", "<app-root>"],
        "Read the resolved architecture model.",
        { ...architectureOptions, format: { type: "string", const: "json" } },
        { type: "json", schema: "ArchitectureModel", schemaVersion: 1 },
        ["Omit --output to receive JSON on stdout."]
      ),
      command(
        "watch",
        ["bca", "watch", "<app-root>"],
        "Rebuild a diagram when AL source changes.",
        { ...architectureOptions, debounce: string("Positive debounce milliseconds.") },
        { type: "process", termination: "SIGINT" }
      ),
      command(
        "serve",
        ["bca", "serve", "<app-root>"],
        "Start the combined local Control Center.",
        {
          tests: { ...string("AL UI-test root."), required: true },
          port: string("Integer from 0 to 65535.", { default: "0" })
        },
        { type: "process", readiness: "stdout URL", termination: "SIGINT" }
      ),
      command(
        "mcp",
        ["bca-mcp"],
        "Expose BC Atlas tools through an MCP stdio server.",
        {},
        { type: "process", transport: "stdio", termination: "SIGINT" }
      ),
      command("docs.list", ["bca", "docs", "list", "<test-root>"], "List scenarios.",
        { format: docsFormat }, { type: "json", when: "--format json" }),
      command("docs.show", ["bca", "docs", "show", "<test-root>"], "Read one scenario.",
        { id: { ...string("Stable document ID."), required: true }, format: docsFormat },
        { type: "json", when: "--format json" }),
      command("docs.validate", ["bca", "docs", "validate", "<test-root>"], "Validate the documentation corpus.",
        { strict: flag("Include warnings as failures."), format: docsFormat },
        { type: "json", when: "--format json" }),
      command("docs.generate", ["bca", "docs", "generate", "<test-root>"], "Generate Markdown.",
        {
          id: string("Optional stable document ID."),
          procedure: string("Required when a file contains multiple tests."),
          outputDir: string("Markdown directory.", { cli: "--output-dir", default: "docs/generated" }),
          format: docsFormat
        }, { type: "json", when: "--format json" }),
      command("docs.set", ["bca", "docs", "set", "<test-root>"], "Set AL documentation metadata.",
        {
          id: { ...string("Stable document ID."), required: true },
          tag: { ...string("Metadata tag."), required: true },
          value: { ...string("Metadata value."), required: true },
          qualifier: string("GIVEN prerequisite type."),
          expectedHash: string("Expected SHA-256 file hash.", { cli: "--expected-hash" }),
          dryRun: flag("Preview without writing.", { cli: "--dry-run" }),
          format: docsFormat
        }, { type: "json", when: "--format json" }, ["Use --dry-run before a write."]),
      command("docs.unset", ["bca", "docs", "unset", "<test-root>"], "Remove AL documentation metadata.",
        {
          id: { ...string("Stable document ID."), required: true },
          tag: { ...string("Metadata tag."), required: true },
          value: string("Optional matching value."),
          qualifier: string("Optional matching qualifier."),
          expectedHash: string("Expected SHA-256 file hash.", { cli: "--expected-hash" }),
          dryRun: flag("Preview without writing.", { cli: "--dry-run" }),
          format: docsFormat
        }, { type: "json", when: "--format json" }, ["Use --dry-run before a write."]),
      command("docs.automation", ["bca", "docs", "automation", "<test-root>"], "Build a CI automation plan.",
        {
          provider: string("Pipeline provider.", { enum: ["github", "azure-devops"], default: "github" }),
          outputDir: string("Markdown directory.", { cli: "--output-dir", default: "docs/generated" }),
          format: docsFormat
        }, { type: "json", when: "--format json" }),
      command("docs.glossary", ["bca", "docs", "glossary"], "Read documentation tag definitions.",
        { format: docsFormat }, { type: "json", when: "--format json" }),
      command("docs.serve", ["bca", "docs", "serve", "<test-root>"], "Start the docs-only Control Center.",
        { port: string("Integer from 0 to 65535.", { default: "0" }) },
        { type: "process", readiness: "stdout URL", termination: "SIGINT" })
    ]
  };
}
