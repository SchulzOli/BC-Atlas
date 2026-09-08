import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createArchitectureModel } from "./architecture.js";

const OWNERSHIP_FILE = ".bc-atlas-codegraph.json";

const TYPE_LABELS = {
  codeunit: "Codeunit",
  controladdin: "Control Add-in",
  entitlement: "Entitlement",
  enum: "Enum",
  enumextension: "Enum Extension",
  interface: "Interface",
  page: "Page",
  pagecustomization: "Page Customization",
  pageextension: "Page Extension",
  permissionset: "Permission Set",
  permissionsetextension: "Permission Set Extension",
  profile: "Profile",
  profileextension: "Profile Extension",
  query: "Query",
  report: "Report",
  reportextension: "Report Extension",
  table: "Table",
  tableextension: "Table Extension",
  xmlport: "XMLport"
};

function slug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "object";
}

function cell(value) {
  if (value === undefined || value === null || value === "") return "";
  return String(value).replaceAll("|", "\\|").replace(/\r?\n/gu, "<br>");
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    ""
  ];
}

function propertyText(properties, excluded = []) {
  const ignored = new Set(excluded.map((name) => name.toLowerCase()));
  return (properties ?? [])
    .filter(({ name }) => !ignored.has(name?.toLowerCase()))
    .map(({ name, value }) => `\`${cell(name)} = ${cell(value)}\``)
    .join("<br>");
}

function encodedRelativeLink(fromFile, toFile) {
  return path.relative(path.dirname(fromFile), toFile)
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function allocatePaths(objects, sourceRoot) {
  const allocated = new Map();
  const used = new Set();
  for (const object of objects) {
    const sourceFile = path.resolve(object.projectRoot, object.file);
    const relativeSource = path.relative(sourceRoot, sourceFile);
    const sourceDirectory = path.dirname(relativeSource);
    const directory = sourceDirectory === "." ? object.type : sourceDirectory;
    const base = `${object.id ? `${object.id}-` : ""}${slug(object.name)}`;
    let filename = `${base}.md`;
    let relativeOutput = path.join(directory, filename);
    if (used.has(relativeOutput.toLowerCase())) {
      filename = `${object.id ? `${object.id}-` : ""}${slug(object.namespace)}-${slug(object.name)}.md`;
      relativeOutput = path.join(directory, filename);
    }
    let suffix = 2;
    while (used.has(relativeOutput.toLowerCase())) {
      relativeOutput = path.join(directory, filename.replace(/\.md$/u, `-${suffix++}.md`));
    }
    used.add(relativeOutput.toLowerCase());
    allocated.set(object.key, relativeOutput);
  }
  return allocated;
}

function objectLink(target, currentPath, paths) {
  if (typeof target === "string") return cell(target);
  const targetPath = target?.key ? paths.get(target.key) : undefined;
  if (!targetPath) return target?.name ?? "Unknown";
  const label = cell(target.name).replaceAll("[", "\\[").replaceAll("]", "\\]");
  return `[${label}](${encodedRelativeLink(currentPath, targetPath)})`;
}

function yamlScalar(value) {
  return value === undefined || value === null ? "null" : JSON.stringify(String(value));
}

function propertiesFrontMatter(object) {
  const app = object.app
    ? [object.app.name, object.app.version].filter(Boolean).join(" ")
    : undefined;
  const rows = [
    ["Type", TYPE_LABELS[object.type] ?? object.type],
    ["ID", object.id],
    ["Name", object.name],
    ["Namespace", object.namespace],
    ["App", app]
  ];
  for (const property of object.properties ?? []) rows.push([property.name, property.value]);
  return ["---", ...rows.map(([name, value]) => `${name}: ${yamlScalar(value)}`), "---", ""];
}

function fieldSection(object, currentPath, paths, objectByKey, outgoing) {
  if (!object.fields?.length) return [];
  const pageFields = object.fields.every(({ kind }) => kind === "page-field");
  const rows = object.fields.map((field) => {
    const relation = outgoing.find((edge) =>
      edge.kind === "relates" && edge.sourceField === field.name
    );
    const target = relation?.to ? objectByKey.get(relation.to) : undefined;
    const relationText = relation
      ? [
        objectLink(target ?? relation.unresolved, currentPath, paths),
        relation.relatedField ? `.${relation.relatedField}` : "",
        relation.condition ? ` if ${relation.condition}` : ""
      ].join("")
      : "";
    const type = field.type?.match(/^(.*?)\[([^\]]+)\]$/u);
    return pageFields
      ? [field.name, field.sourceExpression, field.container, propertyText(field.properties)]
      : [field.number, field.name, type?.[1] ?? field.type, type?.[2], propertyText(field.properties, ["TableRelation"]), relationText];
  });
  return pageFields
    ? ["## Fields", "", ...table(["Field", "Source expression", "Area/Container", "Properties"], rows)]
    : ["## Fields", "", ...table(["No.", "Field", "Type", "Length", "Properties", "Table relation"], rows)];
}

function actionSection(object, currentPath, paths, objectByKey, outgoing) {
  if (!object.actions?.length) return [];
  return ["## Actions", "", ...table(
    ["Action", "Area/Group", "Runs", "Properties"],
    object.actions.map((action) => {
      const edge = outgoing.find(({ kind, member }) => kind === "runs" && member === action.name);
      const target = edge?.to ? objectByKey.get(edge.to) : edge?.unresolved;
      return [
        action.name,
        action.container,
        target ? objectLink(target, currentPath, paths) : action.target,
        propertyText(action.properties, ["RunObject"])
      ];
    })
  )];
}

function keysSection(object) {
  if (!object.keys?.length) return [];
  return [
    "## Keys",
    "",
    ...table(["Key", "Fields", "Properties"], object.keys.map((key) => [
      key.name,
      key.fields.join(", "),
      propertyText(key.properties)
    ]))
  ];
}

function pageSections(object, currentPath, paths, objectByKey, outgoing) {
  const lines = fieldSection(object, currentPath, paths, objectByKey, outgoing);
  if (object.parts?.length) {
    lines.push("## Parts", "", ...table(
      ["Part", "Page", "Area/Container", "Properties"],
      object.parts.map((part) => {
        const edge = outgoing.find(({ kind, member }) => kind === "part" && member === part.name);
        return [
          part.name,
          objectLink(edge?.to ? objectByKey.get(edge.to) : { name: part.target }, currentPath, paths),
          part.container,
          propertyText(part.properties)
        ];
      })
    ));
  }
  lines.push(...actionSection(object, currentPath, paths, objectByKey, outgoing));
  return lines;
}

function elementSections(object) {
  const lines = [];
  const values = (object.elements ?? []).filter(({ kind }) => kind === "enum-value");
  if (values.length) {
    lines.push("## Values", "", ...table(
      ["Ordinal", "Value", "Properties"],
      values.map((value) => [value.ordinal, value.name, propertyText(value.properties)])
    ));
  }
  const dataitems = (object.elements ?? []).filter(({ kind }) => kind === "dataitem");
  if (dataitems.length) {
    lines.push("## Dataitems", "", ...table(
      ["Dataitem", "Source table", "Properties"],
      dataitems.map((item) => [item.name, item.source, propertyText(item.properties)])
    ));
  }
  for (const [kind, heading] of [["column", "Columns"], ["filter", "Filters"]]) {
    const items = (object.elements ?? []).filter((element) => element.kind === kind);
    if (items.length) {
      lines.push(`## ${heading}`, "", ...table(
        [heading.slice(0, -1), "Source", "Dataitem", "Properties"],
        items.map((item) => [item.name, item.source, item.parent, propertyText(item.properties)])
      ));
    }
  }
  const schema = (object.elements ?? []).filter(({ kind }) =>
    !["enum-value", "dataitem", "column", "filter"].includes(kind)
  );
  if (schema.length) {
    lines.push("## Schema", "", ...table(
      ["Kind", "Element", "Source", "Properties"],
      schema.map((item) => [item.kind, item.name, item.source, propertyText(item.properties)])
    ));
  }
  return lines;
}

function procedureSections(object) {
  const lines = [];
  const globals = (object.variables ?? []).filter(({ global, parameter }) => global && !parameter);
  if (globals.length) {
    lines.push("## Global variables", "", ...table(
      ["Variable", "Type", "Subtype", "Properties"],
      globals.map((variable) => [
        variable.name,
        variable.type,
        variable.target,
        propertyText(variable.properties)
      ])
    ));
  }
  const procedures = (object.procedures ?? []).filter(({ kind }) => kind === "procedure");
  if (procedures.length) {
    lines.push("## Procedures", "", ...table(
      ["Visibility", "Procedure header", "Attributes"],
      procedures.map((procedure) => [
        procedure.visibility,
        `\`${procedure.header}\``,
        procedure.attributes?.map((attribute) => `\`${attribute}\``).join("<br>")
      ])
    ));
  }
  const triggers = (object.procedures ?? []).filter(({ kind }) => kind === "trigger");
  if (triggers.length) {
    lines.push("## Triggers", "", ...table(
      ["Trigger", "Attributes"],
      triggers.map((trigger) => [trigger.header, trigger.attributes?.join("<br>")])
    ));
  }
  const events = (object.procedures ?? []).filter(({ kind }) => kind === "event");
  if (events.length) {
    lines.push("## Events", "", ...table(
      ["Visibility", "Event header", "Attributes"],
      events.map((event) => [event.visibility, `\`${event.header}\``, event.attributes?.join("<br>")])
    ));
  }
  return lines;
}

function relationshipName(edge) {
  if (edge.property === "tablerelation") return "TableRelation";
  return ({
    part: "Part",
    reads: "Reads",
    writes: "Writes",
    calls: "Calls",
    extends: "Extends",
    implements: "Implements",
    includes: "Includes",
    permits: "Permits",
    runs: "Runs",
    selects: "Selects implementation",
    uses: "Uses"
  })[edge.kind] ?? edge.kind;
}

function relationshipEvidence(edge) {
  return [
    edge.operation,
    edge.access,
    edge.relatedField ? `target field ${edge.relatedField}` : undefined,
    edge.condition ? `condition ${edge.condition}` : undefined
  ].filter(Boolean).join("; ");
}

function relationshipRows(edges, currentPath, paths, objectByKey, inverse = false) {
  const rows = [];
  const seen = new Set();
  for (const edge of edges) {
    const target = inverse
      ? objectByKey.get(edge.from)
      : edge.to ? objectByKey.get(edge.to) : edge.unresolved;
    const row = [
      relationshipName(edge),
      objectLink(target, currentPath, paths),
      edge.sourceField ?? edge.sourceProcedure ?? edge.member ?? "Object",
      relationshipEvidence(edge)
    ];
    const key = row.join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(row);
    }
  }
  return rows.sort((left, right) => left.join(" ").localeCompare(right.join(" ")));
}

function relationshipsSection(title, edges, currentPath, paths, objectByKey, inverse = false) {
  const rows = relationshipRows(edges, currentPath, paths, objectByKey, inverse);
  return rows.length
    ? [title, "", ...table(["Relationship", inverse ? "Source" : "Target", "From", "Evidence"], rows)]
    : [title, "", "None.", ""];
}

function sourceSection(object, options) {
  const source = object.file.replaceAll("\\", "/");
  const template = options["source-url"] ?? options.sourceUrl;
  if (!template) return ["## Source", "", `${source}:${object.location.line}`, ""];
  const prefixed = [options["source-path-prefix"] ?? options.sourcePathPrefix, source]
    .filter(Boolean).join("/").replaceAll("\\", "/");
  const url = template
    .replaceAll("{file}", prefixed)
    .replaceAll("{line}", String(object.location.line))
    .replaceAll("{ref}", options["source-ref"] ?? options.sourceRef ?? "main");
  return ["## Source", "", `[${source}:${object.location.line}](${url})`, ""];
}

function renderObject(object, currentPath, paths, model, options) {
  const objectByKey = new Map(model.objects.map((item) => [item.key, item]));
  const outgoing = model.edges.filter(({ from }) => from === object.key);
  const incoming = model.edges.filter(({ to }) => to === object.key);
  const lines = [
    ...propertiesFrontMatter(object),
    `# ${TYPE_LABELS[object.type] ?? object.type} ${object.id ? `${object.id} ` : ""}${object.name}`,
    ""
  ];
  if (["table", "tableextension"].includes(object.type)) {
    lines.push(...fieldSection(object, currentPath, paths, objectByKey, outgoing));
    lines.push(...keysSection(object));
  } else if (["page", "pageextension", "pagecustomization"].includes(object.type)) {
    lines.push(...pageSections(object, currentPath, paths, objectByKey, outgoing));
  } else if (["codeunit", "interface"].includes(object.type)) {
    lines.push(...procedureSections(object));
  } else {
    lines.push(...fieldSection(object, currentPath, paths, objectByKey, outgoing));
    lines.push(...actionSection(object, currentPath, paths, objectByKey, outgoing));
    lines.push(...elementSections(object));
    lines.push(...procedureSections(object));
  }
  lines.push(...relationshipsSection("## Dependencies", outgoing, currentPath, paths, objectByKey));
  lines.push(...relationshipsSection("## Used by", incoming, currentPath, paths, objectByKey, true));
  lines.push(...sourceSection(object, options));
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim()}\n`;
}

function renderIndex(objects, paths, model) {
  const groups = new Map();
  for (const object of objects) {
    const output = paths.get(object.key).replaceAll("\\", "/");
    const directory = path.posix.dirname(output);
    const key = `${directory}\0${object.type}`;
    const items = groups.get(key) ?? [];
    items.push({ object, output });
    groups.set(key, items);
  }
  const unresolved = model.edges.filter(({ unresolved }) => unresolved).length;
  const lines = [
    "# Code Graph",
    "",
    `Objects: ${objects.length}  `,
    `Unresolved references: ${unresolved}  `,
    `Diagnostics: ${model.diagnostics.length}`,
    ""
  ];
  let previousDirectory;
  for (const [key, items] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [directory, type] = key.split("\0");
    if (directory !== previousDirectory) {
      lines.push(`## ${directory}`, "");
      previousDirectory = directory;
    }
    lines.push(`### ${TYPE_LABELS[type] ?? type}`, "");
    for (const { object, output } of items.sort((left, right) =>
      (Number(left.object.id) || Number.MAX_SAFE_INTEGER) - (Number(right.object.id) || Number.MAX_SAFE_INTEGER) ||
      left.object.name.localeCompare(right.object.name)
    )) lines.push(`- [${object.id ? `${object.id} ` : ""}${object.name}](${output.split("/").map(encodeURIComponent).join("/")})`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function canonicalPath(filename) {
  let current = path.resolve(filename);
  const missing = [];
  while (true) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(filename);
    missing.push(path.basename(current));
    current = parent;
  }
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertSafeOutput(output, sourceRoot, projectRoot) {
  const canonicalOutput = await canonicalPath(output);
  for (const unsafe of [sourceRoot, projectRoot]) {
    const canonicalUnsafe = await canonicalPath(unsafe);
    if (containsPath(canonicalOutput, canonicalUnsafe)) {
      throw new Error(`Code Graph output must not be the source, project root, or one of their ancestors: ${output}`);
    }
  }
}

async function ownedFiles(directory) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, OWNERSHIP_FILE), "utf8"));
    return Array.isArray(manifest.files) ? manifest.files : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeCodeGraphAtomically(output, files) {
  const parent = path.dirname(output);
  const nonce = `${process.pid}-${randomUUID()}`;
  const temporary = path.join(parent, `.${path.basename(output)}.tmp-${nonce}`);
  const backup = path.join(parent, `.${path.basename(output)}.bak-${nonce}`);
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.cp(output, temporary, { recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") await fs.mkdir(temporary, { recursive: true });
    else throw error;
  }
  try {
    for (const relative of await ownedFiles(temporary)) {
      const owned = path.resolve(temporary, relative);
      if (containsPath(temporary, owned)) await fs.rm(owned, { force: true });
    }
    for (const [relative, content] of files) {
      const target = path.join(temporary, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
    await fs.writeFile(path.join(temporary, OWNERSHIP_FILE), `${JSON.stringify({
      schemaVersion: 1,
      files: [...files.keys()].sort()
    }, null, 2)}\n`, "utf8");
    let hadOutput = false;
    try {
      await fs.rename(output, backup);
      hadOutput = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await fs.rename(temporary, output);
    } catch (error) {
      if (hadOutput) await fs.rename(backup, output);
      throw error;
    }
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function generateCodeGraph(input, values = {}) {
  const architecture = await createArchitectureModel(input, { ...values, view: "project" });
  const { model, options } = architecture;
  const selectedStat = await fs.stat(model.selectedPath);
  const sourceRoot = selectedStat.isDirectory() ? model.selectedPath : path.dirname(model.selectedPath);
  const objects = model.objects
    .filter(({ externalSymbol }) => !externalSymbol)
    .map((object) => ({ ...object, projectRoot: model.projectRoot }))
    .sort((left, right) =>
      left.file.localeCompare(right.file) ||
      left.type.localeCompare(right.type) ||
      (Number(left.id) || Number.MAX_SAFE_INTEGER) - (Number(right.id) || Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name)
    );
  const paths = allocatePaths(objects, sourceRoot);
  const outputDirectory = path.resolve(values["output-dir"] ?? values.outputDir ?? "docs/codegraph");
    await assertSafeOutput(outputDirectory, sourceRoot, model.projectRoot);
    const files = new Map(objects.map((object) => {
      const relativeOutput = paths.get(object.key);
      return [relativeOutput, renderObject(object, relativeOutput, paths, model, options)];
    }));
    files.set("index.md", renderIndex(objects, paths, model));
    await writeCodeGraphAtomically(outputDirectory, files);
  return { outputDirectory, objects: objects.length, unresolved: model.edges.filter(({ unresolved }) => unresolved).length };
}

export const testing = { allocatePaths, renderObject, renderIndex, slug };