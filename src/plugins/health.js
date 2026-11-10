// Health rules of plugins: findings that join the report of bca check (and the app's health page).
// Severity comes from the manifest and can be changed or switched off like the built-in rules
// with check.severities in .bca.json. A failing rule becomes a finding, never a crash of the check.
import { AsyncLocalStorage } from "node:async_hooks";
import { loadConfig } from "../config.js";
import { withFindings } from "../health.js";
import { loadPlugins } from "./registry.js";

const LEVELS = new Set(["error", "warning", "info", "off"]);

// A rule may ask BC Atlas for the architecture model, which runs a health check of its own;
// inside a rule, that nested check skips the plugin rules instead of calling them again.
const evaluating = new AsyncLocalStorage();

export async function pluginFindings(registry, { model, report }) {
  const severities = registry.session.config.check?.severities ?? {};
  const findings = [];
  await registry.emit("check:after", { report });
  for (const { plugin, rule } of registry.healthRules()) {
    const severity = severities[rule.id] ?? rule.severity;
    if (!LEVELS.has(severity)) throw new Error(`check.severities.${rule.id} must be one of: ${[...LEVELS].join(", ")}`);
    if (severity === "off") continue;
    try {
      const implementation = (await registry.activate(plugin.id)).healthRules?.[rule.id];
      if (typeof implementation !== "function") throw new Error("declared in plugin.json but not implemented");
      for (const item of await evaluating.run(true, () => implementation({ model, report })) ?? []) {
        findings.push({
          severity,
          rule: rule.id,
          message: item.message,
          plugin: plugin.id,
          ...(item.object ? { object: item.object } : {}),
          ...(item.file ? { file: item.file } : {}),
          ...(item.line ? { line: item.line } : {})
        });
      }
    } catch (error) {
      findings.push({ severity: "warning", rule: "plugin-rule-failed", plugin: plugin.id, message: `Plugin ${plugin.id}, rule ${rule.id}: ${error.message}` });
    }
  }
  return findings;
}

/** Adds the findings of the project's plugins to a health report. */
export async function withPluginFindings(report, { root, configPath, model }) {
  if (evaluating.getStore()) return report;
  const config = (await loadConfig(root, configPath)).values;
  const registry = await loadPlugins(root, config);
  if (!registry.healthRules().length && !registry.enabled().some(({ manifest }) => manifest.contributes.hooks.includes("check:after"))) return report;
  return withFindings(report, await pluginFindings(registry, { model, report }));
}
