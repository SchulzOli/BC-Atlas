// Plugins that ship with BC Atlas (plugins/<id>). Literal imports, so the VS Code extension bundle
// contains them; the manifests are JSON so tools can read them without running code.
import { fileURLToPath } from "node:url";
import aiManifest from "../../plugins/ai/plugin.json" with { type: "json" };
import syncManifest from "../../plugins/sync/plugin.json" with { type: "json" };

export const BUILTIN_PLUGINS = Object.freeze([
  {
    manifest: syncManifest,
    dir: fileURLToPath(new URL("../../plugins/sync/", import.meta.url)),
    load: () => import("../../plugins/sync/src/index.js")
  },
  {
    manifest: aiManifest,
    dir: fileURLToPath(new URL("../../plugins/ai/", import.meta.url)),
    load: () => import("../../plugins/ai/src/index.js")
  }
]);
