// Single source of truth for every BC Atlas command. The CLI parser, the
// built-in help, the generated documentation, and the machine-readable
// `bca help --format json` contract are all derived from this catalog.

export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FAIL_LEVELS = Object.freeze(["error", "warning", "info", "never"]);
// What the view shows (the lenses of src/app/atlas.js), its forms, and what `bca view` writes.
export const VIEW_LENSES = Object.freeze(["overview", "system", "apps", "modules", "data", "calls", "events", "contracts", "pages", "security", "visibility", "health"]);
export const VIEW_FORMS = Object.freeze(["2d", "diagram", "3d"]);
export const VIEW_FORMATS = Object.freeze(["text", "json", "md", "csv", "svg", "png", "link"]);

export const FEATURE_AREAS = Object.freeze([
  {
    id: "analyze",
    title: "Analyze",
    summary: "Gate CI on the health of the code: cycles, forbidden dependencies, hot spots, and diagnostics."
  },
  {
    id: "export",
    title: "Export",
    summary: "Write what the app shows as files, look at any part of it from the terminal, and write user guides from AL UI tests."
  },
  {
    id: "integrate",
    title: "Integrate",
    summary: "Connect BC Atlas to AI agents."
  }
]);

const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const flag = (description, extra = {}) => ({ type: "boolean", description, ...extra });

const OUTPUT = "Output";
const SELECTION = "View selection";
const FILTERS = "Filters";
const RENDERING = "Rendering";
const GENERAL = "General";

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

const pathsOption = string("Only analyze AL files in this folder or matching this glob, relative to the project root.", {
  group: FILTERS,
  repeatable: true,
  value: "path"
});

const exportOptions = {
  output: string("Output file (default: bc-atlas.html).", { group: OUTPUT, short: "o", value: "path" }),
  title: string("Title of the view.", { group: OUTPUT, value: "text" }),
  watch: flag("Write again whenever AL source, app.json, or .bca.json changes.", { group: OUTPUT }),
  debounce: string("Delay before writing again with --watch, in milliseconds.", { group: OUTPUT, value: "ms", default: "250" }),
  ...filterOptions,
  paths: pathsOption,
  ...projectOptions
};

const checkOptions = {
  failOn: string("Lowest severity that fails the check.", { group: GENERAL, enum: FAIL_LEVELS, default: "error" }),
  format: string("Report format; sarif for GitHub code scanning and Azure DevOps.", { group: OUTPUT, short: "f", enum: ["text", "json", "markdown", "sarif"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  maxFanIn: string("Warn when an object has more distinct dependents.", { group: GENERAL, value: "n", default: "25" }),
  maxFanOut: string("Warn when an object has more distinct dependencies.", { group: GENERAL, value: "n", default: "25" }),
  ...filterOptions,
  paths: pathsOption,
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

/**
 * @param version BC Atlas version
 */
export function createCapabilities(version) {
  return {
    schemaVersion: 2,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use check, view, layers, or docs with --format json, and help --format json for this contract. Parse stdout only after exit code 0."
    },
    exitCodes: { success: 0, operation: 1, usage: 2 },
    conventions: {
      optionSyntax: "Use each option as a separate argv token. Repeat repeatable options.",
      paths: "Pass paths as single argv values; do not build a shell command string. An omitted [app-root] means the current directory.",
      mutations: "Use --dry-run first and pass --expected-hash when writing AL metadata.",
      sourceOfTruth: "AL source is authoritative; generated JSON, Markdown, and SVG are outputs."
    },
    areas: FEATURE_AREAS,
    commands: [
      command({
        id: "check",
        area: "analyze",
        argv: ["bca", "check", "[app-root]"],
        purpose: "Assess the health of the code and fail CI on cycles, forbidden dependencies, or diagnostics.",
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
        id: "export",
        area: "export",
        argv: ["bca", "export", "[app-root]"],
        purpose: "Write the BC Atlas view as one offline HTML file to share: a toolbar and the graph, with every lens, finding, and story.",
        options: exportOptions,
        output: { type: "file", pathOption: "output", default: "bc-atlas.html" },
        rules: [
          "A picture or a list of one lens, story, or object is what bca view writes."
        ],
        examples: [
          "bca export ./app -o atlas.html",
          "bca export ./app -o atlas.html --watch"
        ]
      }),
      command({
        id: "view",
        area: "export",
        argv: ["bca", "view", "[app-root]"],
        purpose: "The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. What the toolbar of the app does, from the terminal.",
        options: {
          lens: string(`What the graph shows: a part of the one graph (${VIEW_LENSES.join(", ")}). overview is how it works, in columns from who uses it to the data. Without a lens (and without --story), the command lists the lenses and stories of the project.`, { group: SELECTION, value: "id", default: "overview" }),
          inside: string("Go into a node: an object opens to its procedures, triggers, and events and what each does with other objects; an app or a namespace to its objects. A name, an ID, or a selector such as codeunit:50100.", { group: SELECTION, value: "node" }),
          focus: string("Only this node and what is near it (see --depth). A name, an ID, or a selector such as table:Customer.", { group: SELECTION, value: "node" }),
          depth: string("How many steps from the --focus node.", { group: SELECTION, value: "n", default: "1" }),
          find: string("What Find does: in a picture, the nodes whose name, type, namespace, or ID match stand out; a list holds only them.", { group: SELECTION, value: "text" }),
          hide: string("Kinds of node to leave out, as the legend names them (codeunit, table, other apps, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          off: string("Kinds of relation to leave out (uses, reads, permits, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          check: flag("What Check does: a ring on every node with a finding in a picture; the findings with their fixes below each node in text.", { group: SELECTION }),
          story: string("A story instead of a lens: its steps with their texts. With --step, the nodes of that step in its lens.", { group: "Stories", value: "id" }),
          step: string("One step of the --story, from 1: what stands out in it.", { group: "Stories", value: "n" }),
          stories: flag("Every story of the system as one document (text, md, or json).", { group: "Stories" }),
          form: string("The form of a picture: a graph in a plane, boxes in layers in the direction of the relations, or a graph in space. Without it, the form the lens reads best in: a diagram for the overview and the apps, a plane for the rest.", { group: RENDERING, enum: VIEW_FORMS }),
          color: string("Color the nodes by this instead of what the lens does.", { group: RENDERING, enum: ["type", "namespace", "app", "level", "findings"] }),
          size: string("Size the nodes by this.", { group: RENDERING, enum: ["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"] }),
          group: string("Hold the nodes together by this instead of what the lens does.", { group: RENDERING, enum: ["namespace", "app", "kind", "none"] }),
          select: string("The selected node of a picture: it and its relations stand out.", { group: RENDERING, value: "node" }),
          theme: string("Colors of a picture.", { group: RENDERING, enum: ["light", "dark"], default: "light" }),
          width: string("Width of a picture in pixels.", { group: RENDERING, value: "px", default: "1440" }),
          height: string("Height of a picture in pixels.", { group: RENDERING, value: "px", default: "900" }),
          format: string("text (default), json, md, csv, svg, png, or link (the address of this view in the app). Inferred from the extension of --output.", { group: OUTPUT, short: "f", enum: VIEW_FORMATS }),
          rows: string("csv: one row per node or per relation.", { group: OUTPUT, enum: ["nodes", "relations"], default: "nodes" }),
          output: string("Write to this file instead of stdout (a PNG always needs it).", { group: OUTPUT, short: "o", value: "path" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.view" },
        rules: [
          "The same graph, lenses, stories, and exports as the app: one implementation draws the page and writes these files.",
          "--format json without a lens, story, or object prints the whole atlas: every node, relation, lens, finding, and story.",
          "A lens with nothing in it does not exist for a project: health needs a finding.",
          "The same options give the same picture every time; SVG and PNG are drawn by BC Atlas itself, without a browser."
        ],
        examples: [
          "bca view ./app",
          "bca view ./app --lens data",
          "bca view ./app --lens data --form diagram -o data.svg",
          "bca view ./app --lens apps --form diagram --check -o apps.png",
          "bca view ./app --inside codeunit:50100 --form diagram -o posting.svg",
          "bca view ./app --focus \"table:Sales Header\" --depth 2 --format json",
          "bca view ./app --lens health --check",
          "bca view ./app --story fix",
          "bca view ./app --stories --format md -o docs/system.md",
          "bca view ./app --lens system --format csv --rows relations -o relations.csv",
          "bca view ./app --format json > atlas.json"
        ]
      }),
      command({
        id: "layers",
        area: "export",
        argv: ["bca", "layers", "[app-root]"],
        purpose: "The layered documentation, in sync with the source: the system explained from the whole down to each procedure, one page per app, namespace, and object, each with a picture.",
        options: {
          output: string("The folder of the pages (default: layers.outputDir in .bca.json, else docs/layers).", { group: OUTPUT, short: "o", value: "path" }),
          check: flag("Write nothing; fail (exit code 1) when the pages are not in sync with the source.", { group: OUTPUT }),
          pictures: string("Pictures of single objects: auto (up to 400 objects), all, or none (no pictures at all). The system, apps, namespaces, and lenses always get one unless none.", { group: OUTPUT, enum: ["auto", "all", "none"], default: "auto" }),
          profile: string("A documentation profile of layers.profiles in .bca.json: which pages and sections are written, for which part of the system, in which language, under which file names, and from which templates. Without it, the settings of layers itself.", { group: SELECTION, value: "name" }),
          view: flag("Also write view.html: the BC Atlas view as one offline file, next to the pages.", { group: OUTPUT }),
          format: string("What the command reports: text (default) or json.", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.layers-sync" },
        rules: [
          "Layers: 0 the system, 1 apps, 2 namespaces, 3 objects, 4 the procedures, triggers, and events inside each object. Lenses, stories, and findings cut across them.",
          "The same source gives the same files, byte for byte: a run changes only what changed, and removes what it wrote before and no longer writes.",
          "A profile (layers in .bca.json: pages, scope, sections, titles, language, names, templates) says what is written and how; each profile writes to a folder of its own."
        ],
        examples: [
          "bca layers ./app",
          "bca layers ./app --profile management",
          "bca layers ./app -o docs/system",
          "bca layers ./app --check"
        ]
      }),
      command({
        id: "docs.list",
        area: "export",
        argv: ["bca", "docs", "list", "<test-root>"],
        purpose: "List documented UI-test scenarios.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs list ./test/UITest"]
      }),
      command({
        id: "docs.show",
        area: "export",
        argv: ["bca", "docs", "show", "<test-root>"],
        purpose: "Show one scenario, its prerequisites, and its diagnostics.",
        options: { id: { ...string("Stable document ID.", { value: "document-id" }), required: true }, format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs show ./test/UITest --id partner-create"]
      }),
      command({
        id: "docs.validate",
        area: "export",
        argv: ["bca", "docs", "validate", "<test-root>"],
        purpose: "Validate IDs, tags, links, and prerequisite cycles.",
        options: { strict: flag("Treat warnings as failures."), format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs validate ./test/UITest --strict"]
      }),
      command({
        id: "docs.generate",
        area: "export",
        argv: ["bca", "docs", "generate", "<test-root>"],
        purpose: "Generate user guides or test cases with flow diagrams as Markdown, HTML, DITA, Azure DevOps CSV, or BPMN.",
        options: {
          export: string("Comma-separated output formats: markdown, html, dita, ado-csv, bpmn.", {
            group: OUTPUT,
            value: "formats",
            default: "markdown"
          }),
          as: string("Document type: a user guide or a test case with an action/expected-result table.", {
            group: OUTPUT,
            enum: ["guide", "testcase"],
            default: "guide"
          }),
          outputDir: string("Output directory.", { group: OUTPUT, value: "path", default: "docs/generated" }),
          title: string("Title of the index, HTML page, and DITA map.", { group: OUTPUT, value: "text" }),
          app: string("AL app source used for real captions, tooltips, and page coverage.", { value: "app-root" }),
          language: string("Language for wording and captions, e.g. de-DE; captions come from the app's .xlf files.", {
            value: "tag",
            default: "en-US"
          }),
          id: string("Generate only this stable document ID (Markdown).", { value: "document-id" }),
          procedure: string("Test procedure; required when a file contains several tests (Markdown).", { value: "name" }),
          format: docsFormat
        },
        output: { type: "directory", pathOption: "outputDir", default: "docs/generated", entry: "index.md" },
        rules: [
          "markdown writes <id>.md per scenario, use-case-<feature>.md, journey-<name>.md, runbook.md, index.md, journey.svg, and diagrams/*.svg",
          "every scenario shows its clicks as a flow; every use case a process with a lane per permission set",
          "html writes one self-contained index.html; dita writes <id>.dita and documentation.ditamap",
          "ado-csv writes test-cases.csv for the Azure DevOps Test Plans grid import",
          "bpmn writes use-case-<feature>.bpmn: BPMN 2.0 with diagram layout; each scenario is a sub-process with its clicks"
        ],
        examples: [
          "bca docs generate ./test --app ./app --export markdown,html",
          "bca docs generate ./test --app ./app --export markdown,bpmn",
          "bca docs generate ./test --app ./app --as testcase --export ado-csv",
          "bca docs generate ./test --app ./app --language de-DE --export html",
          "bca docs generate ./test --export dita --output-dir docs/dita",
          "bca docs generate ./test/PartnerUITest.Codeunit.al --procedure NewPartner_PersistsFields"
        ]
      }),
      command({
        id: "docs.set",
        area: "export",
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
        area: "export",
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
        area: "export",
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
        area: "export",
        argv: ["bca", "docs", "glossary"],
        purpose: "List supported documentation tags and prerequisite types.",
        options: { format: docsFormat },
        output: { type: "json", when: "--format json" },
        examples: ["bca docs glossary"]
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
