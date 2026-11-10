import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeZip } from "../src/zip.js";

export const REPO = path.resolve(import.meta.dirname, "..");
export const DEMO_FACTS = JSON.parse(await fs.readFile(path.join(REPO, "examples", "demo-facts.json"), "utf8"));
export const ATLAS_FIXTURE = path.join(REPO, "test", "fixtures", "atlas-model.json");

export async function tempProject(config) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-atlas-sync-test-"));
  await fs.mkdir(path.join(root, "bc-snapshots"), { recursive: true });
  await fs.copyFile(ATLAS_FIXTURE, path.join(root, "atlas-model.json"));
  if (config) await fs.writeFile(path.join(root, ".bca.json"), JSON.stringify(config, null, 2));
  return root;
}

/** Facts of the demo with another snapshot number and fingerprint. */
export function facts({ no = 1, fingerprint = "fp-1", process = "Demo: Post sales order", drift = false } = {}) {
  const copy = structuredClone(DEMO_FACTS);
  copy.snapshot = { ...copy.snapshot, no, fingerprint, processName: process };
  copy.drift = { previousSnapshotNo: no - 1, detected: drift, added: [], removed: [] };
  return copy;
}

/** A "Download All (ZIP)" archive exactly as the AL side names its entries. */
export async function writeSnapshotZip(root, factSheet, { layered = "# Layered\n", uiTest = "codeunit 50000 \"BAS UITest Demo\"\n{\n}\n" } = {}) {
  const prefix = `${factSheet.snapshot.processName.replace(/[^A-Za-z0-9_.-]/gu, "-").replace(/-+/gu, "-")}-S${factSheet.snapshot.no}`;
  const zip = writeZip([
    { name: `${prefix}-JSON-Fact-Sheet.json`, data: JSON.stringify(factSheet) },
    { name: `${prefix}-Layered-Documentation-use-case-to-clicks.md`, data: layered },
    { name: `${prefix}-User-Guide.md`, data: "# How to\n" },
    { name: `${prefix}-BC-Atlas-UI-Test-AL.al`, data: uiTest },
    { name: `raw/${prefix}-recording.yml`, data: "steps:\n" }
  ]);
  const file = path.join(root, "bc-snapshots", `${prefix}.zip`);
  await fs.writeFile(file, zip);
  return file;
}

export async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
