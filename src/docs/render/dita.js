// OASIS DITA 1.3 task topics and a map. The output validates against the
// standard task and map DTDs and can be published with the DITA Open Toolkit
// or imported into any DITA-aware content management system.
import { label, plainText } from "../phrases.js";
import { dita, escapeXml } from "./format.js";

const XML_DECLARATION = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
const TASK_DOCTYPE = "<!DOCTYPE task PUBLIC \"-//OASIS//DTD DITA Task//EN\" \"task.dtd\">";
const MAP_DOCTYPE = "<!DOCTYPE map PUBLIC \"-//OASIS//DTD DITA Map//EN\" \"map.dtd\">";

function prereqItem(item) {
  if (item.kind === "requires") {
    return item.link.exists
      ? `<xref href="${escapeXml(item.link.id)}.dita" type="task">${escapeXml(item.link.title)}</xref>`
      : escapeXml(item.link.id);
  }
  return dita(item.tokens);
}

function info(step) {
  return step.info ? `<info><p>${escapeXml(step.info)}</p></info>` : "";
}

function nestedList(items) {
  return `<info><ol>${items.map((item) => `<li>${dita(item.cmd)}</li>`).join("")}</ol></info>`;
}

function substep(item) {
  const nested = item.items?.length ? nestedList(item.items) : "";
  return `<substep><cmd>${dita(item.cmd)}</cmd>${info(item)}${nested}</substep>`;
}

function step(item, language) {
  const substeps = item.items?.length ? `\n        <substeps>${item.items.map(substep).join("")}</substeps>` : "";
  const result = item.result?.length
    ? `\n        <stepresult><p>${escapeXml(item.result.join(" "))}</p></stepresult>`
    : "";
  return `      <step>
        <cmd>${dita(item.cmd)}</cmd>${info(item)}${substeps}${result}
      </step>`;
}

export function renderDitaTask(task) {
  const { language } = task;
  const prereqs = task.prereqs.map((item) => `<li>${prereqItem(item)}</li>`).join("");
  const keywords = task.features.map((feature) => `<keyword>${escapeXml(feature)}</keyword>`).join("");
  const related = ["next", "related", "alternative"].flatMap((kind) => task.links[kind]
    .filter(({ exists }) => exists)
    .map((target) => `    <link href="${escapeXml(target.id)}.dita" type="task" role="${kind === "next" ? "next" : kind === "alternative" ? "other" : "friend"}"><linktext>${escapeXml(target.title)}</linktext></link>`));
  return `${XML_DECLARATION}
${TASK_DOCTYPE}
<task id="${escapeXml(task.id)}" xml:lang="${escapeXml(language)}">
  <title>${escapeXml(task.title)}</title>
  <shortdesc>${dita(task.shortdesc)}</shortdesc>
  <prolog>
    <metadata>
${keywords ? `      <keywords>${keywords}</keywords>\n` : ""}      <othermeta name="bc-atlas-source" content="${escapeXml(`${task.source.file}#${task.source.procedure}`)}"/>
      <othermeta name="bc-atlas-source-sha256" content="${escapeXml(task.source.hash)}"/>
    </metadata>
  </prolog>
  <taskbody>
${prereqs ? `    <prereq><ul>${prereqs}</ul></prereq>\n` : ""}${task.examples ? `    <context><p>${escapeXml(label(language, "label.examples"))}</p></context>\n` : ""}${task.steps.length ? `    <steps>
${task.steps.map((item) => step(item, language)).join("\n")}
    </steps>
` : ""}    <result><ul>${task.result.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul></result>
  </taskbody>
${related.length ? `  <related-links>\n${related.join("\n")}\n  </related-links>\n` : ""}</task>
`;
}

export function renderDitaMap(catalog) {
  const { language } = catalog;
  const title = catalog.title ?? label(language, "heading.documentation");
  const lines = [XML_DECLARATION, MAP_DOCTYPE, `<map xml:lang="${escapeXml(language)}">`, `  <title>${escapeXml(title)}</title>`];
  for (const useCase of catalog.useCases) {
    lines.push(`  <topichead navtitle="${escapeXml(useCase.title)}">`);
    for (const task of [...useCase.main, ...useCase.alternatives]) {
      lines.push(`    <topicref href="${escapeXml(task.id)}.dita" type="task" navtitle="${escapeXml(plainText([task.title]))}"/>`);
    }
    lines.push("  </topichead>");
  }
  lines.push("</map>", "");
  return lines.join("\n");
}
