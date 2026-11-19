// Single source of truth for every BC Atlas command. The CLI parser, the
// built-in help, the generated documentation, and the machine-readable
// `bca help --format json` contract are all derived from this catalog.

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
  ["workflow", "Calls, events, and data mutations traced from entry points"],
  ["visibility", "What is public, internal, or local: objects, procedures, events, and fields in three levels, and what each can be"]
]);

export const FORMATS = Object.freeze(["d2", "json", "svg", "png", "pdf"]);
// What `bca export` can write besides the diagram views.
export const EXPORTS = Object.freeze([
  ["app", "The BC Atlas view as one offline HTML file to share: a toolbar and the graph, with every lens, finding, and story"],
  ["report", "Markdown report (README.md) with health, diagrams, and an optional object catalog"],
  ["catalog", "One linked Markdown page per AL object"],
  ["knowledge-graph", "The analyzed project as RDF with the BC Atlas OWL ontology, for knowledge graphs and triple stores: Turtle, RDF/XML (.rdf, .owl), N-Triples, or JSON-LD"]
]);
// RDF syntaxes of the knowledge-graph export.
export const KNOWLEDGE_FORMATS = Object.freeze(["ttl", "rdf", "owl", "nt", "jsonld"]);
export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FAIL_LEVELS = Object.freeze(["error", "warning", "info", "never"]);
export const REPORT_VIEWS = Object.freeze(["project", "module", "data", "contracts", "events", "ui"]);
// What the view shows (the lenses of src/app/atlas.js), its forms, and what `bca view` writes.
export const VIEW_LENSES = Object.freeze(["overview", "system", "components", "apps", "modules", "data", "calls", "events", "contracts", "pages", "security", "visibility", "health"]);
export const VIEW_FORMS = Object.freeze(["2d", "diagram", "3d"]);
export const VIEW_FORMATS = Object.freeze(["text", "json", "md", "csv", "svg", "png", "link"]);

export const FEATURE_AREAS = Object.freeze([
  {
    id: "analyze",
    title: "Analyze",
    summary: "Gate CI on architecture health, and keep a target architecture in place."
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
  strict: flag("Fail when analysis produces warning or error diagnostics.", { group: GENERAL }),
  compiler: string("AL compiler for calls and diagnostics: auto (AL Language extension or AL Development Tools when installed), off, or a path to alc, al, or the extension folder.", {
    group: "AL tools",
    value: "mode"
  }),
  compilerLog: string("Import diagnostics from an AL compiler error log file or folder (alc /errorlog, al workspace compile, AL-Go).", {
    group: "AL tools",
    value: "path"
  })
};

const filterOptions = {
  namespace: string("Namespace glob.", { group: FILTERS, repeatable: true, value: "glob" }),
  type: string("Comma-separated AL object types.", { group: FILTERS, repeatable: true, value: "types" }),
  include: string("File or object glob to include.", { group: FILTERS, repeatable: true, value: "glob" }),
  exclude: string("File or object glob to exclude.", { group: FILTERS, repeatable: true, value: "glob" })
};

const diagramOptions = {
  object: string("Object name, ID, key, or typed selector such as codeunit:50100.", { group: SELECTION, value: "selector" }),
  objectInboundDepth: string("Incoming depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  objectOutboundDepth: string("Outgoing depth for the object view.", { group: SELECTION, value: "n", default: "1" }),
  members: string("Members to list: fields,actions,triggers,events,procedures.", { group: SELECTION, value: "list" }),
  scope: string("Boundary scope: namespace:, folder:, app:, or object: selector.", {
    group: SELECTION,
    repeatable: true,
    value: "selector"
  }),
  focus: string("Name fragment for the contracts, events, ui, or visibility view.", { group: SELECTION, value: "text" }),
  groupBy: string("Diagram views: role, namespace, folder, or type (default: role for project, else namespace). Proposed architecture: auto, coupling, namespace, folder, module, or app.", {
    group: SELECTION,
    enum: ["auto", "coupling", "namespace", "folder", "module", "app", "type", "role"]
  }),
  moduleDepth: string("Namespace segments in the module view, or auto.", { group: SELECTION, value: "n", default: "auto" }),
  folderDepth: string("Folder segments in a folder-grouped module view.", { group: SELECTION, value: "n", default: "1" }),
  ...filterOptions,
  includeUnresolvedCalls: flag("Include unresolved and isolated calls.", { group: CALLS }),
  rootProcedure: string("Call root procedure selector.", { group: CALLS, repeatable: true, value: "selector" }),
  callDepth: string("Call traversal depth from each root.", { group: CALLS, value: "n", default: "3" }),
  callDirection: string("Call traversal direction.", { group: CALLS, enum: ["incoming", "outgoing", "both"], default: "outgoing" }),
  expandProcedures: flag("Call view: show procedures instead of owning-object aggregates. Visibility view: show every procedure, event, and field inside its object.", { group: CALLS }),
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
  noLegend: flag("Hide edge and confidence legends.", { group: RENDERING }),
  details: flag("Show member counts in nodes.", { group: RENDERING }),
  noExternal: flag("Hide unresolved and external dependencies.", { group: RENDERING })
};

const pathsOption = string("Only analyze AL files in this folder or matching this glob, relative to the project root.", {
  group: FILTERS,
  repeatable: true,
  value: "path"
});

const exportOptions = {
  view: string("What to write: app, report, catalog, knowledge-graph, or a diagram view.", {
    group: OUTPUT,
    enum: [...EXPORTS.map(([id]) => id), ...VIEWS.map(([id]) => id)],
    default: "app"
  }),
  output: string("Output file or folder (default: bc-atlas.html, docs/atlas, docs/codegraph, bc-atlas.ttl, or bc-atlas-<view>.svg); - writes JSON to stdout.", {
    group: OUTPUT,
    short: "o",
    value: "path"
  }),
  format: string("app: html; report: svg or d2 diagrams; catalog: md; knowledge-graph: ttl, rdf, owl, nt, or jsonld; diagram views: svg, d2, json, png, or pdf. Inferred from the output extension when omitted.", {
    group: OUTPUT,
    short: "f",
    enum: ["html", "md", ...FORMATS, ...KNOWLEDGE_FORMATS]
  }),
  baseIri: string("Knowledge graph: base IRI of the exported resources (default urn:bc-atlas:).", { group: OUTPUT, value: "iri" }),
  noEvidence: flag("Knowledge graph: leave out the bca:Relation resources with each relation's file, line, and operations; the direct relation triples stay. About a third of the size.", { group: OUTPUT }),
  title: string("Title of the report or diagram.", { group: OUTPUT, value: "text" }),
  watch: flag("Write again whenever AL source, app.json, or .bca.json changes.", { group: OUTPUT }),
  debounce: string("Delay before writing again with --watch, in milliseconds.", { group: OUTPUT, value: "ms", default: "250" }),
  views: string("Report: comma-separated diagram views.", { group: "Report", value: "list", default: REPORT_VIEWS.join(",") }),
  codegraph: flag("Report: also write the object catalog.", { group: "Report" }),
  json: flag("Report: also write the resolved model as model.json.", { group: "Report" }),
  ...diagramOptions,
  paths: pathsOption,
  ...sourceLinkOptions,
  ...projectOptions
};

const checkOptions = {
  failOn: string("Lowest severity that fails the check.", { group: GENERAL, enum: FAIL_LEVELS, default: "error" }),
  format: string("Report format; sarif for GitHub code scanning and Azure DevOps.", { group: OUTPUT, short: "f", enum: ["text", "json", "markdown", "sarif"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  maxFanIn: string("Warn when an object has more distinct dependents.", { group: GENERAL, value: "n", default: "25" }),
  maxFanOut: string("Warn when an object has more distinct dependencies.", { group: GENERAL, value: "n", default: "25" }),
  analyzers: string("Code analyzers for the AL compile: CodeCop, UICop, AppSourceCop, PerTenantExtensionCop, or DLL paths (default: al.codeAnalyzers when al.enableCodeAnalysis is on).", {
    group: "AL tools",
    value: "list"
  }),
  ...filterOptions,
  ...projectOptions
};

const blueprintOptions = {
  format: string("Report format.", { group: OUTPUT, short: "f", enum: ["text", "markdown", "json"], default: "text" }),
  output: string("Write the report to a file instead of stdout.", { group: OUTPUT, short: "o", value: "path" }),
  propose: flag("Propose an architecture from today's dependencies, even when .bca.json defines one.", { group: "Proposal" }),
  groupBy: string("How the proposal groups objects into components; auto: the typed, weighted relations decide (coupling is the same); namespace or folder: the code structure decides, objects without it follow their relations; module or app: one component each.", {
    group: "Proposal",
    enum: ["auto", "coupling", "namespace", "folder", "module", "app"],
    default: "auto"
  }),
  depth: string("With --group-by namespace or folder: segments per component; default: split until no component is too large.", { group: "Proposal", value: "n" }),
  minObjects: string("Merge smaller groups into the component they depend on most.", { group: "Proposal", value: "n", default: "1" }),
  startFrom: string("Existing structures that compete with the relations as a starting point: namespace, folder, both (comma-separated), or none for relations only; architecture.proposal.startFrom in .bca.json.", { group: "Proposal", value: "list", default: "namespace,folder" }),
  ignore: string("Relation kinds that never shape a component (comma-separated, e.g. permits,includes,uses); architecture.proposal.ignore in .bca.json.", { group: "Proposal", value: "kinds", default: "permits,includes" }),
  granularity: string("How finely the relations split: above 1 gives more and smaller components, below 1 fewer and larger ones; architecture.proposal.granularity in .bca.json.", { group: "Proposal", value: "n", default: "1" }),
  sharedCore: string("Pull objects that many components use into a shared core component; architecture.proposal.sharedCore in .bca.json.", { group: "Proposal", enum: ["true", "false"], default: "true" }),
  template: string("The template that says what a good architecture is here: a preset (balanced, follow-structure, by-coupling, layered, modular-monolith, small-steps) or one of your own (architecture.templates in .bca.json); architecture.template in .bca.json. See bca architecture templates.", { group: "Goals", value: "name" }),
  weight: string("How much a goal weighs, as <goal>=<n>; 0 leaves it out. Goals: cohesion, modularity, layering, acyclic, ownership, extractable, stability, size, followNamespaces, followFolders, followApps, fewMoves. Repeatable, or comma-separated; architecture.goals.weights in .bca.json.", { group: "Goals", repeatable: true, value: "goal=n" }),
  size: string("The size a component should have, as <min>..<max> objects (default 3..200); architecture.goals.size in .bca.json.", { group: "Goals", value: "min..max" }),
  extract: string("Plan extracting this component as an app of its own: blockers, dependencies, app.json, table moves, and steps.", { group: "Extraction", value: "component" }),
  explain: string("Explain why an object is in its component (name, ID, or type:name): the step of the proposal that placed it, with its numbers, the selector that assigns it, and its coupling to each component. With the name of a component: why it exists, what it is named after, how its objects came to it, and the thresholds that applied.", { group: "Proposal", value: "object|component" }),
  write: flag("Save the architecture to .bca.json (architecture section).", { group: "Enforcement" }),
  updateBaseline: flag("Accept today's violations in the baseline file; only new ones fail afterwards.", { group: "Enforcement" }),
  updateSurface: flag("Record each component's public surface (what other components use) in .bca-surface.json; bca check then reports changes that break its users.", { group: "Enforcement" }),
  paths: pathsOption,
  ...filterOptions,
  projectRoot: projectOptions.projectRoot,
  config: projectOptions.config,
  compiler: projectOptions.compiler
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
    schemaVersion: 1,
    name: "bc-atlas",
    version,
    transport: {
      stdout: "json",
      encoding: "utf-8",
      rule: "For machine reads, use check, architecture, docs, or export (a diagram view, -o -) with --format json, and help --format json for this contract. Parse stdout only after exit code 0."
    },
    exitCodes: { success: 0, operation: 1, usage: 2 },
    conventions: {
      optionSyntax: "Use each option as a separate argv token. Repeat repeatable options.",
      paths: "Pass paths as single argv values; do not build a shell command string. An omitted [app-root] means the current directory.",
      mutations: "Use --dry-run first and pass --expected-hash when writing AL metadata.",
      sourceOfTruth: "AL source is authoritative; generated JSON, Markdown, D2, and SVG are outputs."
    },
    areas: FEATURE_AREAS,
    exports: EXPORTS.map(([id, summary]) => ({ id, summary })),
    views: VIEWS.map(([id, summary]) => ({ id, summary })),
    commands: [
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
        id: "architecture",
        area: "analyze",
        argv: ["bca", "architecture", "[app-root]"],
        purpose: "Find a target architecture (components, layers, allowed dependencies), list every dependency that points the wrong way with how to resolve it, and enforce it with a baseline.",
        options: blueprintOptions,
        output: { type: "json", when: "--format json", schema: "ArchitectureReport" },
        rules: [
          "Without an architecture section in .bca.json, the command proposes one from today's dependencies: components from the typed, weighted relations (with or without namespaces), a shared core, app candidates, and a namespace for each component.",
          "Exit code 1 when the configured architecture has violations that are not in the baseline.",
          "bca check enforces the same rules in CI; the baseline only shrinks."
        ],
        examples: [
          "bca architecture ./app",
          "bca architecture ./app --propose --format markdown -o architecture.md",
          "bca architecture ./app --propose --write --update-baseline",
          "bca architecture ./app --format json",
          "bca architecture ./app --extract Sales --format markdown -o extract-sales.md"
        ]
      }),
      command({
        id: "architecture.compare",
        area: "analyze",
        argv: ["bca", "architecture", "compare", "[app-root]"],
        purpose: "The architecture as it is and as it should be, side by side: both scored with the same weighted goals, how the components of one become those of the other, the objects that have to move, and the steps with their commands.",
        options: {
          from: string("The current state: structure (the namespaces, folders, and apps the source has today), configured (architecture.components in .bca.json), proposal, or best.", { group: SELECTION, enum: ["structure", "configured", "proposal", "best"], default: "structure" }),
          to: string("The target state: configured, proposal (under the template in use), best (several proposals scored with the goals; the best wins and all are listed), or structure. Default: configured when .bca.json has components, else best.", { group: SELECTION, enum: ["structure", "configured", "proposal", "best"] }),
          limit: string("Most objects to list as moves; 0 for all.", { group: OUTPUT, value: "n", default: "50" }),
          write: flag("Save the target as the architecture of the project (architecture section of .bca.json): what bca check enforces from then on.", { group: "Enforcement" }),
          saveTemplate: string("Save the settings of this call (the template in use, .bca.json, and the options together) as a template of this name; the same as bca architecture templates --save.", { group: "Goals", value: "name" }),
          format: blueprintOptions.format,
          output: blueprintOptions.output,
          template: blueprintOptions.template,
          weight: blueprintOptions.weight,
          size: blueprintOptions.size,
          groupBy: blueprintOptions.groupBy,
          depth: blueprintOptions.depth,
          minObjects: blueprintOptions.minObjects,
          startFrom: blueprintOptions.startFrom,
          ignore: blueprintOptions.ignore,
          granularity: blueprintOptions.granularity,
          sharedCore: blueprintOptions.sharedCore,
          paths: blueprintOptions.paths,
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.architecture-compare" },
        rules: [
          "Both states are scored with the same goals and weights, so the totals can be compared. Every goal says what it measured.",
          "A move is an object whose home today is not where the target has it; The steps are ordered: what removes cycles and wrong-way dependencies first, then by component, the largest gain first.",
          "With --to best, every candidate is listed with its settings and its score for each goal, so the choice can be checked.",
          "See docs/target-architecture.md."
        ],
        examples: [
          "bca architecture compare ./app",
          "bca architecture compare ./app --to best --template modular-monolith",
          "bca architecture compare ./app --weight fewMoves=5 --weight layering=4",
          "bca architecture compare ./app --from configured --to proposal --format markdown -o docs/target.md",
          "bca architecture compare ./app --template layered --granularity 0.8 --weight fewMoves=4 --save-template our-way",
          "bca architecture compare ./app --to best --write"
        ]
      }),
      command({
        id: "architecture.templates",
        area: "analyze",
        argv: ["bca", "architecture", "templates", "[app-root]"],
        purpose: "The templates that say what a good architecture is and how much each goal weighs: lists the presets and your own, takes one into use, saves the settings as they are as a new template, or removes one.",
        options: {
          use: string("Take this template into use (architecture.template in .bca.json); an empty value goes back to the defaults.", { group: SELECTION, value: "name" }),
          save: string("Save the settings as they are now (the template in use, .bca.json, and the options of this call) as a template of this name.", { group: SELECTION, value: "name" }),
          from: string("With --save: copy this template instead of the settings as they are.", { group: SELECTION, value: "name", default: "current" }),
          title: string("With --save: the title of the template.", { group: GENERAL, value: "text" }),
          summary: string("With --save: when to use it.", { group: GENERAL, value: "text" }),
          templateFile: string("With --save: write the template to this JSON file, so that several repositories can share it; .bca.json keeps the path.", { group: OUTPUT, value: "path" }),
          remove: string("Remove a template of your own.", { group: SELECTION, value: "name" }),
          show: string("Print one template with everything it inherits, as JSON.", { group: SELECTION, value: "name" }),
          dryRun: flag("Check the change and show the result; write nothing.", { group: OUTPUT }),
          format: string("text (default) or json: the templates, the goals with what each means, and the default weights.", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          template: blueprintOptions.template,
          weight: blueprintOptions.weight,
          size: blueprintOptions.size,
          groupBy: blueprintOptions.groupBy,
          depth: blueprintOptions.depth,
          minObjects: blueprintOptions.minObjects,
          startFrom: blueprintOptions.startFrom,
          ignore: blueprintOptions.ignore,
          granularity: blueprintOptions.granularity,
          sharedCore: blueprintOptions.sharedCore,
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.architecture-templates" },
        rules: [
          "A template holds the weights of the goals, the size a component should have, and the settings of the proposal. One of your own can extend a preset or another template and change parts of it.",
          "Precedence: an option of the call, then architecture.goals and architecture.proposal in .bca.json, then the template in use, then the defaults.",
          "A preset cannot be replaced or removed; save your version under another name."
        ],
        examples: [
          "bca architecture templates",
          "bca architecture templates --use layered",
          "bca architecture templates --save house --title \"Our house rules\" --weight layering=5 --weight fewMoves=3 --group-by namespace",
          "bca architecture templates --save house --from modular-monolith --template-file ../shared/architecture-house.json",
          "bca architecture templates --show house",
          "bca architecture templates --remove house"
        ]
      }),
      command({
        id: "export",
        area: "export",
        argv: ["bca", "export", "[app-root]"],
        purpose: "Write files: the BC Atlas view as one offline HTML file, the Markdown report, the object catalog, or one diagram view.",
        options: exportOptions,
        output: { type: "file", pathOption: "output", default: "bc-atlas.html" },
        rules: [
          "object view requires --object; boundary view requires at least one --scope; workflow view requires --entry",
          "A diagram view with --format json and no --output prints the resolved model to stdout",
          "SVG, PNG, and PDF are drawn by BC Atlas itself; every drawing writes its D2 source next to it"
        ],
        examples: [
          "bca export ./app -o atlas.html",
          "bca export ./app --view report",
          "bca export ./app --view report --codegraph -o docs/architecture",
          "bca export ./app --view module -o modules.svg",
          "bca export ./app --view object --object codeunit:50100 -o posting.svg",
          "bca export ./app --view workflow --entry ProcessDocument -o workflow.svg --watch",
          "bca export ./app --view project --format json > model.json",
          "bca export ./app --view catalog -o docs/codegraph"
        ]
      }),
      command({
        id: "view",
        area: "export",
        argv: ["bca", "view", "[app-root]"],
        purpose: "The BC Atlas view without a window: any lens, story, or object of the one graph as text, JSON, CSV, Markdown, SVG, or PNG. What the toolbar of the app does, from the terminal.",
        options: {
          lens: string(`What the graph shows: a part of the one graph (${VIEW_LENSES.join(", ")}). overview is how it works, in columns from who uses it to the data. Without a lens (and without --story), the command lists the lenses and stories of the project.`, { group: SELECTION, value: "id", default: "overview" }),
          inside: string("Go into a node: an object opens to its procedures, triggers, and events and what each does with other objects; an app, a component, or a namespace to its objects. A name, an ID, or a selector such as codeunit:50100 or component:Core.", { group: SELECTION, value: "node" }),
          focus: string("Only this node and what is near it (see --depth). A name, an ID, or a selector such as table:Customer.", { group: SELECTION, value: "node" }),
          depth: string("How many steps from the --focus node.", { group: SELECTION, value: "n", default: "1" }),
          find: string("What Find does: in a picture, the nodes whose name, type, component, namespace, or ID match stand out; a list holds only them.", { group: SELECTION, value: "text" }),
          hide: string("Kinds of node to leave out, as the legend names them (codeunit, table, other apps, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          off: string("Kinds of relation to leave out (uses, reads, permits, ...), comma-separated.", { group: SELECTION, repeatable: true, value: "kinds" }),
          check: flag("What Check does: a ring on every node with a finding in a picture; the findings with their fixes below each node in text.", { group: SELECTION }),
          story: string("A story instead of a lens: its steps with their texts. With --step, the nodes of that step in its lens.", { group: "Stories", value: "id" }),
          step: string("One step of the --story, from 1: what stands out in it.", { group: "Stories", value: "n" }),
          stories: flag("Every story of the system as one document (text, md, or json).", { group: "Stories" }),
          form: string("The form of a picture: a graph in a plane, boxes in layers in the direction of the relations, or a graph in space. Without it, the form the lens reads best in: a diagram for the overview and components, a plane for the rest.", { group: RENDERING, enum: VIEW_FORMS }),
          color: string("Color the nodes by this instead of what the lens does.", { group: RENDERING, enum: ["type", "component", "namespace", "app", "level", "findings"] }),
          size: string("Size the nodes by this.", { group: RENDERING, enum: ["relations", "usedBy", "uses", "lines", "complexity", "objects", "findings"] }),
          group: string("Hold the nodes together by this instead of what the lens does.", { group: RENDERING, enum: ["component", "namespace", "app", "kind", "none"] }),
          select: string("The selected node of a picture: it and its relations stand out.", { group: RENDERING, value: "node" }),
          theme: string("Colors of a picture.", { group: RENDERING, enum: ["light", "dark"], default: "light" }),
          width: string("Width of a picture in pixels.", { group: RENDERING, value: "px", default: "1440" }),
          height: string("Height of a picture in pixels.", { group: RENDERING, value: "px", default: "900" }),
          format: string("text (default), json, md, csv, svg, png, or link (the address of this view in the app). Inferred from the extension of --output.", { group: OUTPUT, short: "f", enum: VIEW_FORMATS }),
          rows: string("csv: one row per node or per relation.", { group: OUTPUT, enum: ["nodes", "relations"], default: "nodes" }),
          output: string("Write to this file instead of stdout (a PNG always needs it).", { group: OUTPUT, short: "o", value: "path" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog,
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
          "bca view ./app --lens components --form diagram --check -o components.png",
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
        purpose: "The layered documentation, in sync with the source: the system explained from the whole down to each procedure, one page per app, component, namespace, and object, each with a picture. For the source as it is now, and for any commit, tag, or release.",
        options: {
          output: string("The folder of the pages (default: layers.outputDir in .bca.json, else docs/layers). States of the past go below history/ in it.", { group: OUTPUT, short: "o", value: "path" }),
          at: string("Record the source as it was at a commit, a tag, or a release, below history/<name>. Repeatable, or comma-separated. Only these states are written, not the working tree.", { group: SELECTION, repeatable: true, value: "ref" }),
          releases: flag("Also record every release (Git tag) the current commit descends from that is not recorded yet.", { group: SELECTION }),
          last: string("With --releases: only the newest n releases.", { group: SELECTION, value: "n" }),
                  refresh: flag("Write a state that is already recorded again, for example after an update of BC Atlas.", { group: SELECTION }),
          check: flag("Write nothing; fail (exit code 1) when the pages are not in sync with the source, or an asked state is not recorded.", { group: OUTPUT }),
          pictures: string("Pictures of single objects: auto (up to 400 objects), all, or none (no pictures at all). The system, apps, components, namespaces, and lenses always get one unless none.", { group: OUTPUT, enum: ["auto", "all", "none"], default: "auto" }),
          profile: string("A documentation profile of layers.profiles in .bca.json: which pages and sections are written, for which part of the system, in which language, under which file names, and from which templates. Without it, the settings of layers itself.", { group: SELECTION, value: "name" }),
          view: flag("Also write view.html: the BC Atlas view of the working tree as one offline file, next to the pages. A state of the past always has it.", { group: OUTPUT }),
          format: string("What the command reports: text (default) or json.", { group: OUTPUT, short: "f", enum: ["text", "json"], default: "text" }),
          projectRoot: projectOptions.projectRoot,
          config: projectOptions.config,
          compiler: projectOptions.compiler,
          compilerLog: projectOptions.compilerLog,
          paths: string("Only analyze AL files below these project-relative folders or globs.", { group: FILTERS, repeatable: true, value: "glob" })
        },
        output: { type: "json", when: "--format json", schema: "bc-atlas.layers-sync" },
        rules: [
          "Layers: 0 the system, 1 apps, 2 components, 3 namespaces, 4 objects, 5 the procedures, triggers, and events inside each object. Lenses, stories, and findings cut across them.",
          "The same source gives the same files, byte for byte: a run changes only what changed, and removes what it wrote before and no longer writes.",
          "A recorded state never changes; its pages are written once. history/README.md lists every state and what changed from each to the next.",
          "A state of the past is read with the BC Atlas of today from a temporary checkout (git worktree); the working tree is not touched.",
          "A profile (layers in .bca.json: pages, scope, sections, titles, language, names, templates) says what is written and how; each profile writes to a folder of its own."
        ],
        examples: [
          "bca layers ./app",
          "bca layers ./app --profile management",
          "bca layers ./app -o docs/system",
          "bca layers ./app --check",
          "bca layers ./app --at v1.4.0",
          "bca layers ./app --at 3f2c1ab,v1.3.0",
          "bca layers ./app --releases --last 5"
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
          "markdown writes <id>.md per scenario, use-case-<feature>.md, index.md, journey.d2/.svg, and diagrams/*.svg",
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
