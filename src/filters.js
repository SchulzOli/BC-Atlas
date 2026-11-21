// Which objects and files of a project are looked at: the --type, --namespace,
// --include, --exclude, and --paths selections, and the focus path.
import { normalizeIdentifier } from "./resolver.js";

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "iu");
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

/**
 * Returns a predicate for workspace objects that honors --type, --namespace,
 * --include, --exclude, and the focus path.
 */
export function objectFilter(options = {}) {
  const types = new Set(
    (options.types ?? [])
      .flatMap((value) => value.split(","))
      .map((value) => value.toLowerCase())
      .filter(Boolean)
  );
  const namespaces = options.namespaces ?? [];
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  const focusPath = options.focusPath?.replaceAll("\\", "/").replace(/^\.\//u, "");

  return (object) => {
    if (object.externalSymbol) return false;
    const searchable = `${object.type}:${object.id ?? ""}:${object.name}`;
    if (types.size && !types.has(object.type)) return false;
    if (namespaces.length && !matchesAny(object.namespace, namespaces)) return false;
    const file = object.file.replaceAll("\\", "/");
    if (focusPath && file !== focusPath && !file.startsWith(`${focusPath.replace(/\/$/u, "")}/`)) {
      return false;
    }
    if (include.length && !matchesAny(file, include) && !matchesAny(searchable, include)) {
      return false;
    }
    return !matchesAny(file, exclude) && !matchesAny(searchable, exclude);
  };
}

/**
 * Matches project-relative file paths: a plain path selects that folder or
 * file, a glob (with * or ?) is matched against the whole path.
 */
export function pathMatcher(patterns = []) {
  const normalized = patterns.map((pattern) => String(pattern).replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, ""));
  return (file) => normalized.some((pattern) => /[*?]/u.test(pattern)
    ? globToRegExp(pattern).test(file)
    : file === pattern || file.startsWith(`${pattern}/`));
}

export function filterModel(model, options = {}) {
  const focusPath = options.focusPath?.replaceAll("\\", "/").replace(/^\.\//u, "");
  const objects = model.objects.filter(objectFilter(options));
  const keys = new Set(objects.map(({ key }) => key));
  const objectByKey = new Map(model.objects.map((object) => [object.key, object]));
  const boundaryObjects = new Map();

  function boundaryFor(adjacent, focus, edge) {
    let category = edge.targetOrigin;
    if (adjacent.externalSymbol && /microsoft/iu.test(adjacent.app?.publisher ?? "")) {
      category = "microsoft-base-app";
    } else if (adjacent.app?.id && focus.app?.dependencies?.some((dependency) =>
      [dependency.id, dependency.appId].includes(adjacent.app.id)
    )) {
      category = "declared-dependency";
    } else if (adjacent.app?.id && adjacent.app.id === focus.app?.id) {
      category = "same-app-outside-focus";
    } else if (!category || category === "same-app" || category === "workspace-app") {
      category = "unknown";
    }
    const appName = adjacent.app?.name ?? "Unknown app";
    const namespace = adjacent.namespace ?? "(global)";
    const key = `boundary::${category}::${normalizeIdentifier(appName)}::${normalizeIdentifier(namespace)}`;
    if (!boundaryObjects.has(key)) {
      boundaryObjects.set(key, {
        key,
        name: `${category.replaceAll("-", " ")}: ${appName} / ${namespace}`,
        type: "module",
        namespace: "(boundary)",
        file: "",
        relations: [],
        members: [],
        boundaryCategory: category,
        isBoundary: true,
        viewGroup: "Adjacent context"
      });
    }
    const boundary = boundaryObjects.get(key);
    if (!boundary.members.includes(adjacent.key)) boundary.members.push(adjacent.key);
    return boundary;
  }

  const edges = [];
  for (const edge of model.edges) {
    const fromInside = keys.has(edge.from);
    const toInside = edge.to ? keys.has(edge.to) : false;
    if (fromInside && (!edge.to || toInside)) {
      edges.push(edge);
      continue;
    }
    if (fromInside && edge.to) {
      const adjacent = objectByKey.get(edge.to);
      if (!adjacent) continue;
      const boundary = boundaryFor(adjacent, objectByKey.get(edge.from), edge);
      edges.push({ ...edge, to: boundary.key, targetOrigin: boundary.boundaryCategory });
      continue;
    }
    if (toInside) {
      const adjacent = objectByKey.get(edge.from);
      if (!adjacent) continue;
      const boundary = boundaryFor(adjacent, objectByKey.get(edge.to), edge);
      edges.push({ ...edge, from: boundary.key, targetOrigin: boundary.boundaryCategory });
    }
  }
  return {
    ...model,
    focusPath,
    objects: [...objects, ...boundaryObjects.values()],
    edges
  };
}
