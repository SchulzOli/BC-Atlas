// Single source of truth for every BC Atlas command. The CLI parser, the
// built-in help, the generated documentation, and the machine-readable
// `bca capabilities` contract are all derived from this catalog.

export const VIEWS = Object.freeze([
  ["project", "AL objects grouped into role lanes (Data, UI, Services, ...)"],
  ["module", "Aggregated namespace or folder dependencies"],
  ["object", "One object with incoming and outgoing neighbors"],
  ["data", "Tables with reads, writes, relations, and extensions"],
  ["call", "Procedure and trigger call graph"],
  ["boundary", "Dependencies crossing a namespace, folder, app, or object"],
  ["contracts", "Interfaces and their direct or enum implementations"],
  ["events", "Event publishers and subscribers"],
  ["ui", "Pages, source tables, parts, actions, and navigation"],
  ["workflow", "Calls, events, and data mutations traced from entry points"]
]);

export const FORMATS = Object.freeze(["d2", "json", "svg", "png", "pdf"]);
export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FAIL_LEVELS = Object.freeze(["error", "warning", "info", "never"]);
export const REPORT_VIEWS = Object.freeze(["project", "module", "data", "contracts", "events", "ui"]);

export const FEATURE_AREAS = Object.freeze([
  {
    id: "start",
    title: "Get started",
    summary: "Set up a project and produce a complete overview in one step."
  },
  {
    id: "visualize",
    title: "Visualize",
    summary: "Render focused architecture diagrams from AL source."
  },
  {
    id: "analyze",
    title: "Analyze",
    summary: "Measure architecture health and read the resolved model."
  },
  {
    id: "document",
    title: "Document",
    summary: "Generate Markdown object catalogs and user guides from AL UI tests."
  },
  {
    id: "integrate",
    title: "Integrate",
    summary: "Connect BC Atlas to scripts, CI pipelines, and AI agents."
  }
]);

const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const flag = (description, extra = {}) => ({ type: "boolean", description, ...extra });

const OUTPUT = "Output";
const SELECTION = "View selection";
const FILTERS = "Filters";
const CALLS = "Call view";
const WORKFLOW = "Workflow view";
const RENDERING = "Rendering";
const LINKS = "Source links";
const GENERAL = "General";

const sourceLinkOptions = {
  sourceUrl: string("Node-link template with {file}, {line}, and {ref} placeholders.", { group: LINKS, value: "template" }),
  sourceRef: string("Commit or branch substituted for {ref}.", { group: LINKS, value: "ref", default: "main" }),
  sourcePathPrefix: string("Repository-relative prefix prepended to {file}.", { group: LINKS, value: "path" })
};

const projectOptions = {
  projectRoot: string("Analyze this app or workspace root; the positional path becomes the focus.", {
    group: GENERAL,
    value: "path"
  }),
  config: string("Configuration file (default: <app-root>/.bca.json).", { group: GENERAL, value: "path" }),
  strict: flag("Fail when analysis produces warning or error diagnostics.", { group: GENERAL })
};

const filterOptions = {
  namespace: string("Namespace glob.", { group: FILTERS, repeatable: true, value: "glob" }),
  type: string("Comma-separated AL object types.", { group: FILTERS, repeatable: true, value: "types" }),
  include: string("File or object glob to include.", { group: FILTERS, repeatable: true, value: "glob" }),
  exclude: string("File or object glob to exclude.", { group: FILTERS, repeatable: true, value: "glob" })
};

const architectureOptions = {
  output: string("Output file path.", { group: OUTPUT, short: "o", value: "path", default: "bc-atlas.d2" }),
  format: string("Output format; inferred from the output extension when omitted.", {
    group: OUTPUT,
    short: "f",
    enum: FORMATS
  }),
  view: string("Architecture projection.", { group: SELECTION, enum: VIEWS.map(([id]) => id), default: "project" }),
  object: string("Object name, ID, key, or typed selector such as codeunit:50100.", { group: SELECTION, value: "selector" }),
  objectInboundDepth: string("Incoming depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  objectOutboundDepth: string("Outgoing depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  members: string("Members to list: fields,actions,triggers,events,procedures.", { group: SELECTION, value: "list" }),
  scope: string("Boundary scope: namespace:, folder:, app:, or object: selector.", {
    group: SELECTION,
    repeatable: true,
    value: "selector"
  }),
  focus: string("Name fragment for the contracts, events, or ui view.", { group: SELECTION, value: "text" }),
  groupBy: string("Grouping mode (project: role, others: namespace).", {
    group: SELECTION,
    enum: ["namespace", "folder", "type", "role"]
  }),
  moduleDepth: string("Namespace segments in the module view, or auto.", { group: SELECTION, value: "n", default: "auto" }),
  folderDepth: string("Folder segments in a folder-grouped module view.", { group: SELECTION, value: "n", default: "1" }),
  ...filterOptions,
  includeUnresolvedCalls: flag("Include unresolved and isolated calls.", { group: CALLS }),
  rootProcedure: string("Call root procedure selector.", { group: CALLS, repeatable: true, value: "selector" }),
  callDepth: string("Call traversal depth from each root.", { group: CALLS, value: "n", default: "3" }),
  callDirection: string("Call traversal direction.", { group: CALLS, enum: ["incoming", "outgoing", "both"], default: "outgoing" }),
  expandProcedures: flag("Show procedures instead of owning-object aggregates.", { group: CALLS }),
  expandFrameworkCalls: flag("Show individual framework and standard-library calls.", { group: CALLS }),
  entry: string("Workflow entry procedure, trigger, action, or event.", { group: WORKFLOW, repeatable: true, value: "selector" }),
  workflowDepth: string("Workflow traversal depth.", { group: WORKFLOW, value: "n", default: "8" }),
  workflowMaxNodes: string("Workflow node cap.", { group: WORKFLOW, value: "n", default: "100" }),
  workflowEdgeTypes: string("Comma-separated calls,events,writes,reads.", {
    group: WORKFLOW,
    value: "list",
    default: "calls,events,writes"
  }),
  maxEdges: string("Diagram edge cap.", { group: RENDERING, value: "n", default: "500" }),
  direction: string("Diagram direction.", { group: RENDERING, enum: ["right", "down", "left", "up"], default: "right" }),
  title: string("Diagram title.", { group: RENDERING, value: "text" }),
  noLegend: flag("Hide edge and confidence legends.", { group: RENDERING }),
  details: flag("Show member counts in nodes.", { group: RENDERING }),
  noExternal: flag("Hide unresolved and external dependencies.", { group: RENDERING }),
  ...sourceLinkOptions,
  ...projectOptions
};

const checkOptions = {
  failOn: string("Lowest severity that fails the check.", { group: GENERAL, enum: FAIL_LEVELS, default: "error" }),
  format: string("Report format.", { group: OUTPUT, short: "f", enum: ["text", "json", "markdown"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  maxFanIn: string("Warn when an object has more distinct dependents.", { group: GENERAL, value: "n", default: "25" }),
  maxFanOut: string("Warn when an object has more distinct dependencies.", { group: GENERAL, value: "n", default: "25" }),
  ...filterOptions,
  ...projectOptions
};

const docsFormat = string("Output mode.", { group: OUTPUT, enum: ["text", "json"], default: "text" });

const cliName = (name) => `--${name.replaceAll(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase()}`;

function command(definition) {
  const { options = {}, rules = [], examples = [], ...rest } = definition;
  return {
    ...rest,
    options: Object.fromEntries(Object.entries(options).map(([name, option]) => {
      const { short, ...value } = option;
      return [name, {
        cli: cliName(name),
        ...(short ? { short: `-${short}` } : {}),
        ...value
      }];
    })),
    rules,
    examples
  };
}

export function createCapabilities(version) {
  return {
    schemaVersion: 1,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use inspect, check, or docs commands with --format json. Parse stdout only after exit code 0."
    },
    exitCodes: { success: 0, operation: 1, usage: 2 },
    conventions: {
      optionSyntax: "Use each option as a separate argv token. Repeat repeatable options.",
      paths: "Pass paths as single argv values; do not build a shell command string. An omitted [app-root] means the current directory.",
      mutations: "Use --dry-run first and pass --expected-hash when writing AL metadata.",
      sourceOfTruth: "AL source is authoritative; generated JSON, Markdown, D2, and SVG are outputs."
    },
    areas: FEATURE_AREAS,
    views: VIEWS.map(([id, summary]) => ({ id, summary })),
    commands: [
      command({
        id: "init",
        area: "start",
        argv: ["bca", "init", "[app-root]"],
        purpose: "Create a .bca.json configuration tailored to an AL project.",
        options: {
          force: flag("Overwrite an existing configuration file."),
          print: flag("Print the configuration instead of writing it.")
        },
        output: { type: "file", path: "<app-root>/.bca.json" },
        examples: ["bca init ./app", "bca init ./app --print"]
      }),
      command({
        id: "report",
        area: "start",
        argv: ["bca", "report", "[app-root]"],
        purpose: "Write a complete architecture report: overview, health, and diagrams for every view.",
        options: {
          outputDir: string("Report directory.", { group: OUTPUT, value: "path", default: "docs/atlas" }),
          views: string("Comma-separated views to render.", { group: OUTPUT, value: "list", default: REPORT_VIEWS.join(",") }),
          format: string("Diagram format.", { group: OUTPUT, enum: ["svg", "d2"], default: "svg" }),
          codegraph: flag("Also generate the linked Markdown object catalog.", { group: OUTPUT }),
          json: flag("Also write the resolved project model as model.json.", { group: OUTPUT }),
          title: string("Report title.", { group: OUTPUT, value: "text" }),
          ...filterOptions,
          ...sourceLinkOptions,
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config
        },
        output: { type: "directory", pathOption: "outputDir", default: "docs/atlas", entry: "README.md" },
        examples: ["bca report ./app", "bca report ./app --codegraph --output-dir docs/architecture"]
      }),
      command({
        id: "graph",
        area: "visualize",
        argv: ["bca", "graph", "[app-root]"],
        purpose: "Write an architecture diagram (D2, SVG, PNG, PDF) or model file (JSON).",
        aliases: ["bca <app-root>"],
        options: architectureOptions,
        output: { type: "file", pathOption: "output", default: "bc-atlas.d2" },
        rules: ["object view requires --object", "boundary view requires at least one --scope"],
        examples: [
          "bca graph ./app -o architecture.svg",
          "bca graph ./app --view object --object codeunit:50100 -o posting.svg",
          "bca graph ./app --view workflow --entry ProcessDocument -o workflow.svg",
          "bca graph ./app --view boundary --scope namespace:Contoso.Sales -o boundary.svg"
        ]
      }),
      command({
        id: "graph.workflow",
        area: "visualize",
        variantOf: "graph",
        argv: ["bca", "graph", "[app-root]"],
        purpose: "Write a bounded workflow diagram.",
        options: {
          ...architectureOptions,
          view: { type: "string", const: "workflow", required: true, description: "Workflow projection." },
          entry: { ...architectureOptions.entry, required: true }
        },
        output: { type: "file", pathOption: "output", default: "bc-atlas.d2" }
      }),
      command({
        id: "watch",
        area: "visualize",
        argv: ["bca", "watch", "[app-root]"],
        purpose: "Rebuild a diagram whenever AL source, app.json, or .bca.json changes.",
        options: {
          ...architectureOptions,
          debounce: string("Rebuild debounce in milliseconds.", { group: GENERAL, value: "ms", default: "250" })
        },
        output: { type: "process", termination: "SIGINT" },
        examples: ["bca watch ./app --view module -o modules.svg"]
      }),
      command({
        id: "check",
        area: "analyze",
        argv: ["bca", "check", "[app-root]"],
        purpose: "Score architecture health and fail CI on cycles, policy violations, or diagnostics.",
        options: checkOptions,
        output: { type: "json", when: "--format json", schema: "HealthReport" },
        rules: ["Exit code 1 means at least one finding reached --fail-on."],
        examples: [
          "bca check ./app",
          "bca check ./app --fail-on warning",
          "bca check ./app --format markdown -o health.md"
        ]
      }),
      command({
        id: "inspect",
        area: "analyze",
        argv: ["bca", "inspect", "[app-root]"],
        purpose: "Print the resolved architecture model as JSON.",
        options: {
          ...architectureOptions,
          output: string("Write JSON to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
          format: { type: "string", const: "json", group: OUTPUT, short: "f", description: "Always json." }
        },
        output: { type: "json", schema: "ArchitectureModel", schemaVersion: 1 },
        rules: ["Omit --output to receive JSON on stdout."],
        examples: ["bca inspect ./app > model.json", "bca inspect ./app --view workflow --entry ProcessDocument"]
      }),
      command({
        id: "codegraph",
        area: "document",
        argv: ["bca", "codegraph", "[app-root]"],
        purpose: "Generate one linked Markdown page per AL object.",
        options: {
          outputDir: string("Markdown output directory.", { group: OUTPUT, value: "path", default: "docs/codegraph" }),
          include: filterOptions.include,
          exclude: filterOptions.exclude,
          ...sourceLinkOptions,
          ...projectOptions
        },
        output: { type: "directory", pathOption: "outputDir", default: "docs/codegraph" },
        examples: ["bca codegraph ./app --output-dir docs/codegraph"]
      }),
      command({
        id: "docs.list",
        area: "document",
        argv: ["bca", "docs", "list", "<test-root>"],
        purpose: "List documented UI-test scenarios.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs list ./test/UITest"]
      }),
      command({
        id: "docs.show",
        area: "document",
        argv: ["bca", "docs", "show", "<test-root>"],
        purpose: "Show one scenario, its prerequisites, and its diagnostics.",
        options: { id: { ...string("Stable document ID.", { value: "document-id" }), required: true }, format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs show ./test/UITest --id partner-create"]
      }),
      command({
        id: "docs.validate",
        area: "document",
        argv: ["bca", "docs", "validate", "<test-root>"],
        purpose: "Validate IDs, tags, links, and prerequisite cycles.",
        options: { strict: flag("Treat warnings as failures."), format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs validate ./test/UITest --strict"]
      }),
      command({
        id: "docs.generate",
        area: "document",
        argv: ["bca", "docs", "generate", "<test-root>"],
        purpose: "Generate Markdown user guides and an index.",
        options: {
          id: string("Generate only this stable document ID.", { value: "document-id" }),
          procedure: string("Test procedure; required when a file contains several tests.", { value: "name" }),
          outputDir: string("Markdown directory.", { value: "path", default: "docs/generated" }),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        examples: [
          "bca docs generate ./test/UITest --output-dir docs/guides",
          "bca docs generate ./test/PartnerUITest.Codeunit.al --procedure NewPartner_PersistsFields"
        ]
      }),
      command({
        id: "docs.set",
        area: "document",
        argv: ["bca", "docs", "set", "<test-root>"],
        purpose: "Add or replace documentation metadata in AL source.",
        options: {
          id: { ...string("Stable document ID.", { value: "document-id" }), required: true },
          tag: { ...string("Metadata tag.", { value: "tag" }), required: true },
          value: { ...string("Metadata value.", { value: "text" }), required: true },
          qualifier: string("GIVEN prerequisite type.", { value: "type" }),
          expectedHash: string("Reject the write if the AL file changed (SHA-256).", { value: "hash" }),
          dryRun: flag("Preview without writing."),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        rules: ["Use --dry-run before a write."],
        examples: ["bca docs set ./test/UITest --id partner-create --tag OWNER --value \"Integration Ops\" --dry-run"]
      }),
      command({
        id: "docs.unset",
        area: "document",
        argv: ["bca", "docs", "unset", "<test-root>"],
        purpose: "Remove documentation metadata from AL source.",
        options: {
          id: { ...string("Stable document ID.", { value: "document-id" }), required: true },
          tag: { ...string("Metadata tag.", { value: "tag" }), required: true },
          value: string("Only remove entries with this value.", { value: "text" }),
          qualifier: string("Only remove entries with this qualifier.", { value: "type" }),
          expectedHash: string("Reject the write if the AL file changed (SHA-256).", { value: "hash" }),
          dryRun: flag("Preview without writing."),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        rules: ["Use --dry-run before a write."],
        examples: ["bca docs unset ./test/UITest --id partner-create --tag RELATED --value partner-edit"]
      }),
      command({
        id: "docs.automation",
        area: "document",
        argv: ["bca", "docs", "automation", "<test-root>"],
        purpose: "Print a CI pipeline that keeps generated guides in sync.",
        options: {
          provider: string("Pipeline provider.", { enum: ["github", "azure-devops"], default: "github" }),
          outputDir: string("Markdown directory.", { value: "path", default: "docs/generated" }),
          format: docsFormat
        },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs automation ./test/UITest --provider azure-devops"]
      }),
      command({
        id: "docs.glossary",
        area: "document",
        argv: ["bca", "docs", "glossary"],
        purpose: "List supported documentation tags and prerequisite types.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs glossary"]
      }),
      command({
        id: "capabilities",
        area: "integrate",
        argv: ["bca", "capabilities"],
        purpose: "Print this machine-readable command contract as JSON.",
        output: { type: "json", schema: "CapabilityManifest" },
        examples: ["bca capabilities"]
      }),
      command({
        id: "mcp",
        area: "integrate",
        argv: ["bca", "mcp"],
        aliases: ["bca-mcp"],
        purpose: "Start the Model Context Protocol server on stdio for AI agents.",
        output: { type: "process", transport: "stdio", termination: "SIGINT" },
        examples: ["bca mcp"]
      })
    ]
  };
}

export function findCommand(capabilities, id) {
  return capabilities.commands.find((item) => item.id === id);
}
