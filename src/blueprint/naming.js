// Names for components, app candidates, and the groups
// inside a component: one place that says what a group is called, where the
// name came from, and how two groups that would get the same name are told
// apart. Every name carries its `naming` record:
//
//   { by, from, share?, qualifiedBy?, was? }
//
//   by           namespace | folder | words | app | module | kept | fixed |
//                role | renamed
//   from         the namespace, folder, or word the name was taken from
//   share        the share of the group's objects that have it
//   qualifiedBy  parent | app | alternative | number, when another group
//                wanted the same name
//   was          the name before architecture.proposal.naming.rename
//
// Names are compared without case, as `component:` selectors and
// `dependsOn` look them up. A clash is resolved by meaning
// first: the parent namespace segment or folder ("Sales Setup" and
// "Purchase Setup"), then the app or module ("Setup (Contoso Sales)"), then
// other words the objects share, and a number only when nothing else is left.
import { normalizeIdentifier } from "../resolver.js";

/** How names are compared: without case and surrounding space. */
export const nameKey = (name) => normalizeIdentifier(name);

export const QUALIFIERS = Object.freeze(["parent", "app", "number"]);
export const AVOIDABLE = Object.freeze(["app", "module", "namespace"]);

// Folders that sort objects by type say nothing about what they do.
const TYPE_FOLDERS = new Set([
  "table", "tables", "tableextension", "tableextensions", "tableext", "tableexts",
  "page", "pages", "pageextension", "pageextensions", "pageext", "pageexts", "pagecustomization", "pagecustomizations",
  "report", "reports", "reportextension", "reportextensions", "reportext", "reportexts", "layout", "layouts", "reportlayouts",
  "codeunit", "codeunits", "query", "queries", "xmlport", "xmlports", "enum", "enums", "enumextension", "enumextensions", "enumext", "enumexts",
  "interface", "interfaces", "permissionset", "permissionsets", "permissionsetextension", "permissionsetextensions", "permissions",
  "controladdin", "controladdins", "profile", "profiles", "entitlement", "entitlements", "translations",
  "src", "source", "sources", "app", "al", "objects", "object", "base"
]);
export const typeFolder = (segment) => TYPE_FOLDERS.has(segment.toLowerCase().replace(/[^a-z]/gu, ""));

/** The folder of a file without the folders that only sort by type: src/Sales/Tables/X.al -> src/Sales. */
export function functionalFolder(file) {
  const segments = String(file ?? "").split("/").slice(0, -1);
  while (segments.length && typeFolder(segments.at(-1))) segments.pop();
  return segments.some((segment) => !typeFolder(segment)) ? segments.join("/") : undefined;
}

export const hasNamespace = (node) => Boolean(node.namespace) && node.namespace !== "(global)";

export const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values) if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
};

// Words that describe what an object is, not what it is about.
const GENERIC = new Set(["mgt", "management", "card", "list", "subform", "entry", "entries", "line", "lines", "header", "ext", "extension",
  "buffer", "handler", "helper", "impl", "codeunit", "table", "page", "report", "query", "the", "and", "of", "for", "to", "api", "factbox", "part",
  "type", "types", "code", "codes", "status", "no", "doc", "document", "documents", "mgmt", "setup", "test", "tests", "wizard", "archive", "statistics"]);

/** The affix shared by most object names (CON in "CON Sales Header"), so it does not name every cluster. */
export function commonAffix(nodes) {
  const first = nodes.map((node) => String(node.label ?? "").split(/[^A-Za-z0-9]+/u).filter(Boolean)[0]?.toLowerCase());
  const [affix, count] = mostCommon(first) ?? [];
  return affix && affix.length <= 6 && count >= nodes.length * 0.4 ? affix : undefined;
}

const title = (word) => word[0].toUpperCase() + word.slice(1);
const share = (count, total) => total ? Number((count / total).toFixed(2)) : 0;

/**
 * The longest prefix (namespace segments, folders) that at least `share` of
 * `total` values start with, compared without case: Microsoft.Sales when most
 * values lie in Microsoft.Sales.Document or Microsoft.Sales.Customer.
 */
export function dominantPrefix(values, { separator = ".", share: needed = 0.5, total = values.length, minDepth = 1 } = {}) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    const parts = String(value).split(separator);
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join(separator);
      const entry = counts.get(prefix.toLowerCase()) ?? { prefix, depth, count: 0 };
      entry.count++;
      counts.set(prefix.toLowerCase(), entry);
    }
  }
  let best;
  for (const entry of counts.values()) {
    if (entry.depth < minDepth || entry.count < total * needed) continue;
    if (!best || entry.depth > best.depth || (entry.depth === best.depth && entry.count > best.count)) best = entry;
  }
  return best?.prefix;
}

const below = (value, prefix, separator) => {
  const text = String(value ?? "").toLowerCase();
  return text === prefix.toLowerCase() || text.startsWith(`${prefix.toLowerCase()}${separator}`);
};

/**
 * A name for a cluster: its namespace or functional folder when most members
 * share one, else the words their names share most. `alternatives` names it
 * more precisely when another cluster has the same name; `naming` says where
 * the name came from.
 */
export function clusterName(members, affix, { namespaceDepth = 2, folderDepth = 1 } = {}) {
  const words = [];
  for (const { label } of members) {
    words.push(...new Set(String(label ?? "").split(/[^A-Za-z]+/u).map((word) => word.toLowerCase())
      .filter((word) => word.length > 2 && word !== affix && !GENERIC.has(word))));
  }
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([word]) => title(word));
  const byWords = ranked.slice(1, 4).map((word) => `${ranked[0]} ${word}`);
  // The deepest namespace or folder most members share, below what all objects
  // of the app share (Microsoft, src/Layers/W1/BaseApp says nothing).
  // Most members, else the largest part of them.
  const namespaces = members.filter(hasNamespace).map(({ namespace }) => namespace);
  const namespace = dominantPrefix(namespaces, { total: members.length, minDepth: namespaceDepth }) ??
    dominantPrefix(namespaces, { total: members.length, minDepth: namespaceDepth, share: 0.3 });
  if (namespace) {
    const naming = { by: "namespace", from: namespace, share: share(namespaces.filter((value) => below(value, namespace, ".")).length, members.length) };
    return { label: namespace.split(".").at(-1), fullName: namespace, alternatives: byWords, basis: "namespace", naming };
  }
  const folders = members.map(({ file }) => functionalFolder(file));
  const folder = dominantPrefix(folders, { separator: "/", total: members.length, minDepth: folderDepth });
  if (folder && !typeFolder(folder.split("/").at(-1))) {
    const naming = { by: "folder", from: folder, share: share(folders.filter((value) => value && below(value, folder, "/")).length, members.length) };
    return { label: folder.split("/").at(-1), fullName: folder, alternatives: byWords, basis: "folder", naming };
  }
  if (ranked.length) {
    const naming = { by: "words", from: ranked[0], share: share(counts.get(ranked[0].toLowerCase()), members.length) };
    // No namespace or folder holds most of them: the one that holds the largest part still tells
    // two groups of the same word apart better than a number does ("Posting (Sales)").
    const largest = mostCommon(namespaces)?.[0]?.split(".").at(-1) ?? mostCommon(folders.filter(Boolean))?.[0]?.split("/").at(-1);
    const alternatives = largest && !typeFolder(largest) && largest.toLowerCase() !== ranked[0].toLowerCase() ? [...byWords, `${ranked[0]} (${largest})`] : byWords;
    return { label: ranked[0], fullName: ranked[0], alternatives, naming };
  }
  return { label: "Group", fullName: "Group", alternatives: [], naming: roleNaming("no shared namespace, folder, or word") };
}

/** The naming of a group that is named after what it is (Shared, Unconnected, Loose), not after its objects. */
export const roleNaming = (role) => ({ by: "role", from: role });

/** Where a group's label came from, when the caller did not say. */
function baseNaming(group) {
  if (group.naming) return group.naming;
  if (group.pinned) return { by: "kept", from: group.label };
  if (group.fixed) return { by: "fixed", from: group.label };
  if (group.basis) return { by: group.basis, from: group.fullName ?? group.label };
  return { by: "words", from: group.fullName ?? group.label };
}

/** "Sales Setup" for Contoso.Sales.Setup or src/Sales/Setup: the label with the segment above it. */
function parentQualified(group, base) {
  const { by, from } = baseNaming(group);
  if (by !== "namespace" && by !== "folder") return undefined;
  const segments = String(from ?? "").split(by === "namespace" ? "." : "/").filter(Boolean).slice(0, -1);
  while (segments.length && by === "folder" && typeFolder(segments.at(-1))) segments.pop();
  const parent = segments.at(-1);
  return parent && nameKey(parent) !== nameKey(base) ? `${parent} ${base}` : undefined;
}

const sameObjects = (a, b) => Boolean(a && b) && a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Gives every group a `name` that no other group has, compared without case,
 * and a `naming` that says where the name came from and how it was told apart.
 * Groups with `pinned` keep their label. Groups that want the same name are
 * all qualified the same way where that tells them apart; where it does not,
 * the largest keeps the plain name.
 * @param groups [{ label, key, fullName?, basis?, naming?, alternatives?, outer?: { key, label }, pinned?, fixed?, objects? | size? }]
 * @param options.qualify which qualification is tried first: parent | app | number
 * @param options.reserved [{ name, kind, members: Set }] names of apps, modules,
 *   or namespaces a group may only have when it holds exactly their objects
 * @param options.membersOf (group) => Set of object ids, for `reserved`
 */
export function uniqueNames(groups, { qualify = "parent", reserved = [], membersOf = () => undefined } = {}) {
  const taken = new Map();
  const named = new Set();
  const avoided = new Map();
  for (const entry of reserved) {
    const key = nameKey(entry.name);
    avoided.set(key, [...(avoided.get(key) ?? []), entry]);
  }
  // The other thing with this name, when it is not the same set of objects.
  const blocker = (name, group) => group.fixed ? undefined
    : (avoided.get(nameKey(name)) ?? []).find(({ members }) => !sameObjects(members, membersOf(group)));
  const free = (name, group) => !taken.has(nameKey(name)) && !blocker(name, group);
  const take = (group, name, qualifiedBy) => {
    const naming = { ...baseNaming(group) };
    if (qualifiedBy) naming.qualifiedBy = qualifiedBy;
    const avoids = qualifiedBy && blocker(group.label || group.key, group);
    if (avoids) naming.avoids = { kind: avoids.kind, name: avoids.name };
    group.name = name;
    group.naming = naming;
    taken.set(nameKey(name), group);
    named.add(group);
  };
  const size = (group) => group.objects ?? group.size ?? 0;
  const base = (group) => group.label || group.key;

  // Components you named yourself (architecture.proposal.keep) keep their names.
  for (const group of groups.filter(({ pinned }) => pinned)) take(group, group.label);
  const wanted = new Map();
  for (const group of groups.filter(({ pinned }) => !pinned).sort((a, b) => size(b) - size(a))) {
    const key = nameKey(base(group));
    wanted.set(key, [...(wanted.get(key) ?? []), group]);
  }
  // Names nobody else wants first, so a qualified name never takes one of them.
  const clashes = [];
  for (const list of wanted.values()) {
    if (list.length === 1 && free(base(list[0]), list[0])) take(list[0], base(list[0]));
    else clashes.push(list);
  }
  const qualified = {
    parent: (group) => parentQualified(group, base(group)),
    // The app or module tells groups apart only when the other one lies elsewhere.
    app: (group, list) => {
      const outer = group.outer;
      if (!outer?.label || nameKey(outer.label) === nameKey(base(group))) return undefined;
      const holder = taken.get(nameKey(base(group)));
      const elsewhere = list.some((other) => other !== group && other.outer?.key !== outer.key) ||
        Boolean(holder && holder.outer?.key !== outer.key) || Boolean(blocker(base(group), group));
      return elsewhere ? `${base(group)} (${outer.label})` : undefined;
    }
  };
  const order = { parent: ["parent", "app"], app: ["app", "parent"], number: [] }[qualify] ?? ["parent", "app"];
  for (const list of clashes) {
    let rest = list;
    for (const strategy of order) {
      if (rest.length === 1 && free(base(rest[0]), rest[0])) break;
      const proposals = rest.map((group) => [group, qualified[strategy](group, list)]);
      const count = new Map();
      for (const [, name] of proposals) if (name) count.set(nameKey(name), (count.get(nameKey(name)) ?? 0) + 1);
      for (const [group, name] of proposals) if (name && count.get(nameKey(name)) === 1 && free(name, group)) take(group, name, strategy);
      rest = rest.filter((group) => !named.has(group));
    }
    // What is left: the largest keeps the plain name, the others take other
    // words their objects share, or a number.
    for (const group of rest) {
      const plain = base(group);
      if (free(plain, group)) {
        take(group, plain);
        continue;
      }
      const alternative = qualify === "number" ? undefined : (group.alternatives ?? []).find((candidate) => free(candidate, group));
      if (alternative) {
        take(group, alternative, "alternative");
        continue;
      }
      let index = 2;
      while (!free(`${plain} ${index}`, group)) index++;
      take(group, `${plain} ${index}`, "number");
    }
  }
  return groups;
}

/**
 * Applies architecture.proposal.naming.rename: a map from the name the
 * proposal gives to the name you want. Names stay unique; a rename that would
 * give two components one name fails and names both.
 * @returns the keys of `rename` that no component has
 */
export function applyRenames(groups, rename = {}) {
  const wanted = new Map(Object.entries(rename).map(([from, to]) => [nameKey(from), { from, to }]));
  if (!wanted.size) return [];
  const used = new Set();
  const renamed = new Map();
  for (const group of groups) {
    const entry = wanted.get(nameKey(group.name));
    if (!entry) continue;
    used.add(nameKey(entry.from));
    if (entry.to !== group.name) renamed.set(group, entry.to);
  }
  const holders = new Map();
  for (const group of groups) {
    const name = renamed.get(group) ?? group.name;
    const other = holders.get(nameKey(name));
    if (other) {
      const describe = (item) => renamed.has(item) ? `"${item.name}" (renamed to "${renamed.get(item)}")` : `"${item.name}"`;
      throw new Error(`architecture.proposal.naming.rename would give two components the same name: ${describe(other)} and ${describe(group)}; names are compared without case`);
    }
    holders.set(nameKey(name), group);
  }
  for (const [group, name] of renamed) {
    const before = group.naming;
    group.naming = { by: "renamed", from: before?.from, was: group.name, before };
    group.name = name;
  }
  return [...wanted.values()].filter(({ from }) => !used.has(nameKey(from))).map(({ from }) => from);
}

/**
 * What most of a group's objects agree on: their namespace, their functional
 * folder, and the first word of their names (a prefix such as CON).
 * @returns { namespace?: { value, share }, folder?: { value, share }, prefix?: { value, share } }
 */
export function memberAgreement(members) {
  const top = (values) => {
    const [value, count] = mostCommon(values) ?? [];
    return value === undefined ? undefined : { value, share: share(count, members.length) };
  };
  const prefix = top(members.map(({ label }) => String(label ?? "").split(/[^A-Za-z0-9]+/u).filter(Boolean)[0]));
  const namespace = top(members.map((node) => hasNamespace(node) ? node.namespace : undefined));
  const folder = top(members.map(({ file }) => functionalFolder(file)));
  return {
    ...(namespace ? { namespace } : {}),
    ...(folder ? { folder } : {}),
    ...(prefix && prefix.share >= 0.5 && members.length > 1 ? { prefix } : {})
  };
}
