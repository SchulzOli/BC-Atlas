import { dependencyLens } from "./dependency.js";

// One lens per relationship family. Each lens turns a resolved architecture
// model into an object level and an app level; history, metrics, and the
// viewer work the same for every lens.
export const LENSES = Object.freeze({
  dependency: {
    id: "dependency",
    title: "Dependencies",
    summary: "Which objects and apps depend on which, inside one app and across apps",
    build: dependencyLens
  }
});

export function findLens(id = "dependency") {
  const lens = LENSES[id];
  if (!lens) throw new Error(`unsupported lens: ${id} (use ${Object.keys(LENSES).join(", ")})`);
  return lens;
}
