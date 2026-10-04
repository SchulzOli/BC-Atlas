// Azure DevOps Test Plans CSV. Import it in a test plan's grid view
// ("Import test cases"): one "Test Case" row per scenario followed by one row
// per step with "Step Action" and "Step Expected".
import { plain } from "./format.js";
import { testCaseRows } from "./markdown.js";

const COLUMNS = ["ID", "Work Item Type", "Title", "Test Step", "Step Action", "Step Expected", "Area Path", "Assigned To", "State", "Tags"];

function field(value) {
  const text = String(value ?? "").replace(/\r?\n/gu, " ");
  return /[",;\n]/u.test(text) || text !== text.trim() ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function renderAzureDevOpsCsv(catalog, { areaPath = "" } = {}) {
  const rows = [COLUMNS];
  for (const task of catalog.tasks) {
    rows.push(["", "Test Case", task.title, "", "", "", areaPath, "", "Design", task.features.join("; ")]);
    for (const [index, row] of testCaseRows(task).entries()) {
      rows.push(["", "", "", String(index + 1), plain(row.action), plain(row.expected), "", "", "", ""]);
    }
  }
  // UTF-8 BOM so Excel and Azure DevOps detect the encoding of umlauts and emoji.
  return `﻿${rows.map((row) => row.map(field).join(",")).join("\r\n")}\r\n`;
}
