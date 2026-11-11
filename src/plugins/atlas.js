// What plugins add to the atlas (src/app/atlas.js), the one graph the view and `bca view` show:
// nodes, relations, lenses, findings, and stories about what the AL source cannot show. A plugin
// declares `contributes.atlas` in plugin.json and implements atlas({ atlas, object }), which
// returns
//
//   {
//     nodes:     [{ id, kind, label, color?, ...facts }]
//     relations: [{ from, to, kind, weight? }]              by node id; also to nodes of BC Atlas
//     styles:    { "<kind of relation>": { color, dash? } }
//     lenses:    [{ id, title, summary, kinds, relations, connected?, group?, color?, reads }]
//     findings:  [{ severity, rule, message, fix?, nodes: [id] }]
//     stories:   [{ id, title, summary, kind?, steps: [{ title, text, lens, nodes: [id], status? }] }]
//   }
//
// A plugin that fails adds a finding and never stops the view.
import { loadConfig } from "../config.js";
import { loadPlugins } from "./registry.js";

/**
 * Asks every enabled plugin of the project for its part of the atlas.
 * @param input { root, configPath } the project
 * @param context what a plugin gets: { atlas: the atlas so far (nodes, relations, edges, lenses), object(type, idOrName) -> node id }
 * @returns [{ plugin, contribution } | { plugin, error }]
 */
export async function pluginAtlas({ root, configPath }, context) {
  let registry;
  try {
    registry = await loadPlugins(root, (await loadConfig(root, configPath)).values);
  } catch {
    // A project whose plugins cannot be loaded still has its own atlas; bca plugins doctor says why.
    return [];
  }
  const results = [];
  for (const plugin of registry.atlasContributors()) {
    try {
      const implementation = (await registry.activate(plugin.id)).atlas;
      if (typeof implementation !== "function") throw new Error("atlas is declared in plugin.json but not implemented");
      results.push({ plugin: plugin.id, contribution: (await implementation(context)) ?? {} });
    } catch (error) {
      results.push({ plugin: plugin.id, error: error.message });
    }
  }
  return results;
}
