// Source "atlas-model": the BC Atlas architecture model (objects with their component, and the
// components with their layer). Inside bca the host provides it from the analyzed AL source;
// standalone it is read from an export: the app HTML ("bca export --view app") or its model JSON.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

export function parseAtlasExport(text, name = "atlas export") {
  let model;
  if (text.trimStart().startsWith("<")) {
    const match = text.match(/BCA_SNAPSHOT_GZIP\s*=\s*"([^"]+)"/u);
    if (!match) throw new Error(`${name}: no embedded BC Atlas model (BCA_SNAPSHOT_GZIP)`);
    model = JSON.parse(zlib.gunzipSync(Buffer.from(match[1], "base64")).toString("utf8"));
  } else {
    model = JSON.parse(text);
  }
  return validateAtlasModel(model, name);
}

export function validateAtlasModel(model, name = "atlas model") {
  if (!Array.isArray(model?.objects) || !Array.isArray(model?.architecture?.components)) {
    throw new Error(`${name}: expected objects[] and architecture.components[]`);
  }
  return model;
}

export async function loadAtlasModel(root, source, host) {
  if (source.path) {
    const file = path.resolve(root, source.path);
    return parseAtlasExport(await fs.readFile(file, "utf8"), source.path);
  }
  if (typeof host?.atlasModel === "function") return validateAtlasModel(await host.atlasModel(), "bca");
  throw new Error(`atlas source "${source.id}" has no "path" and no BC Atlas host provides the model; run it with "bca sync" or set a path to an export`);
}

/** Lookup by "type::id", the key the AL side writes into the layered documentation. */
export function indexAtlas(model) {
  const byKey = new Map();
  for (const object of model.objects) {
    const key = `${String(object.type).toLowerCase()}::${object.objectId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(object);
  }
  return {
    byKey,
    components: new Map(model.architecture.components.map((component) => [component.name, component])),
    allowSameLayer: Boolean(model.architecture.settings?.allowSameLayer),
    title: model.overview?.title ?? "BC Atlas",
    objectCount: model.objects.length
  };
}
