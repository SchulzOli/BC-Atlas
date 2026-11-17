// Why an object is where it is: the step of the proposal that placed it, and
// the numbers that step looked at. The proposal records one placement
// `{ step, detail }` per object; this module is the vocabulary of the steps,
// the fixed thresholds that shape components, and the sentence that says a
// placement in plain words.

/** Every step that can place an object, with what it means. */
export const PLACEMENT_STEPS = Object.freeze({
  coupling: "It works most with the objects of this component: the relations between the objects of the app were grouped so that as much of their weight as possible stays inside a group.",
  "shared-core": "Several groups use it and none of them owns it, so it went to the shared core instead of gluing those groups together.",
  "small-group": "It formed a group that was too small to stand alone, and the group joined the component it works with most.",
  "namespace-neighbour": "Nothing relates it to the rest of the app, so it follows the objects of its namespace.",
  "folder-neighbour": "Nothing relates it to the rest of the app, so it follows the objects of its folder.",
  "id-neighbour": "Nothing relates it to the rest of the app, so it follows the object with the nearest object ID.",
  unconnected: "Nothing relates it to the rest of the app, and no namespace, folder, or object ID points to a component; place it by hand.",
  grants: "It only grants or includes permissions, so it moved to the component that holds most of what it grants.",
  excluded: "architecture.proposal.exclude kept it from shaping components; afterwards it joined the component it works with most.",
  "not-placed": "architecture.proposal.exclude kept it from shaping components, and nothing relates it to a component; place it by hand.",
  merged: "Its component had fewer objects than minObjects and joined the component it depends on most.",
  boundary: "Its app or module stays one component: it is too small to split, nothing inside relates to anything else, or the grouping asked for whole apps or modules.",
  structure: "The grouping asked for namespaces or folders, and it has one: the namespace or folder is the component.",
  kept: "A component you defined in architecture.proposal.keep takes it.",
  outside: "It lies outside the analyzed path; its app is kept as one fixed component for context.",
  declared: "A selector of the component in .bca.json assigns it."
});

/** A few words per step, for counts: "12 by coupling, 2 by namespace neighbour". */
export const STEP_LABELS = Object.freeze({
  coupling: "by coupling",
  "shared-core": "used by many components",
  "small-group": "from a small group that joined",
  "namespace-neighbour": "by namespace neighbour",
  "folder-neighbour": "by folder neighbour",
  "id-neighbour": "by nearest object ID",
  unconnected: "without relations",
  grants: "by what they grant",
  excluded: "excluded, then placed by coupling",
  "not-placed": "excluded and not placed",
  merged: "merged from a component below minObjects",
  boundary: "as the whole app or module",
  structure: "by namespace or folder",
  kept: "kept by you",
  outside: "outside the analyzed path",
  declared: "declared in .bca.json"
});

/**
 * The fixed numbers the proposal works with. Where a threshold depends on the
 * size of the app, the value that applied is in a component's rationale.
 */
export const THRESHOLDS = Object.freeze({
  // An app or module with fewer objects stays one component.
  minClusterObjects: 6,
  // A hub goes to the shared core: used from this many other groups, with
  // incoming coupling at this percentile of the app (at least hubMinIncoming),
  // and less than this share of it from its own group.
  hubCommunities: 3,
  hubPercentile: 0.9,
  hubMinIncoming: 4,
  hubOwnShare: 0.4,
  // A group smaller than max(objects, share of the app) joins another one.
  smallGroup: Object.freeze({ objects: 3, share: 0.01, most: 10 }),
  appCandidate: Object.freeze({ objects: 10, share: 0.05 }),
  // An object without relations follows an object whose ID is this close.
  idDistance: 50,
  // A namespace or folder becomes a selector when this share of its objects is in one component.
  selectorOwnership: 0.8,
  // With --group-by namespace or folder, a group larger than max(objects, share) splits one level deeper.
  split: Object.freeze({ objects: 40, share: 0.15 })
});

const percent = (value) => `${Math.round(value * 100)}%`;
const number = (value) => Number(Number(value).toFixed(1)).toLocaleString("en-US");
const START = { relations: "the relations alone", namespace: "today's namespaces", folder: "today's folders" };

const SENTENCES = {
  coupling: ({ inside, total, share, start, modularity }) =>
    `It works most with the objects of this component: ${number(inside)} of its ${number(total)} weighted links go there (${percent(share)}).` +
    (start ? ` The grouping started from ${START[start] ?? start} because that kept most coupling inside groups (modularity ${Number(modularity).toFixed(2)}).` : ""),
  "shared-core": ({ communities, incoming, ownShare, needs }) =>
    `It is used from ${communities} other groups with ${number(incoming)} weighted links, and only ${percent(ownShare)} of them come from its own group, so it went to the shared core ` +
    `(at least ${needs.communities} other groups, ${number(needs.incoming)} links, less than ${percent(needs.ownShare)} from its own).`,
  "small-group": ({ size, minimum, weight }) =>
    `It formed a group of ${size} object(s), fewer than the ${minimum} a component needs here, and the group joined the component it works with most (${number(weight)} weighted links).`,
  "namespace-neighbour": ({ namespace, objects, of }) =>
    `Nothing relates it to the rest of the app, so it follows its namespace ${namespace}: ${objects} of the ${of} other object(s) of that namespace are in this component.`,
  "folder-neighbour": ({ folder, objects, of }) =>
    `Nothing relates it to the rest of the app, so it follows its folder ${folder}: ${objects} of the ${of} other object(s) of that folder are in this component.`,
  "id-neighbour": ({ neighbour, distance, limit }) =>
    `Nothing relates it to the rest of the app, so it follows the object with the nearest ID: ${neighbour.label} (${neighbour.objectId}), ${distance} away (at most ${limit}).`,
  grants: ({ grants, of }) =>
    `It only grants or includes permissions; ${grants} of its ${of} grant(s) to a component go to this one, so it moved here.`,
  excluded: ({ weight, total, selector }) =>
    `${selector ? `${selector} in architecture.proposal.exclude` : "architecture.proposal.exclude"} kept it from shaping components; ${number(weight)} of its ${number(total)} weighted links go to this component, more than to any other.`,
  "not-placed": ({ selector }) =>
    `${selector ? `${selector} in architecture.proposal.exclude` : "architecture.proposal.exclude"} kept it from shaping components, and nothing relates it to a component; place it by hand.`,
  merged: ({ size, minObjects, from }) =>
    `Its component${from ? ` ${from}` : ""} had ${size} object(s), fewer than minObjects ${minObjects}, and joined the component it depends on most.`,
  boundary: ({ kind, name, reason, objects, minimum }) => ({
    small: `Its ${kind} ${name} has ${objects} object(s); a ${kind} with fewer than ${minimum} stays one component.`,
    "no-relations": `Nothing inside its ${kind} ${name} relates to anything else, so the ${kind} stays one component.`,
    "group-by": `The grouping asked for whole ${kind}s: its ${kind} ${name} is the component.`
  })[reason] ?? PLACEMENT_STEPS.boundary,
  structure: ({ by, value, depth, split, limit }) => value
    ? `The grouping asked for ${by}s: it lies in ${by} ${value} (${depth} segment(s) deep${split ? `; groups above ${limit} objects split one level deeper` : ""}).`
    : `The grouping asked for ${by}s, and it has none: objects without one share a component.`,
  kept: ({ selector }) => `A component you defined in architecture.proposal.keep takes it${selector ? ` with ${selector}` : ""}.`,
  outside: ({ app }) => `It lies outside the analyzed path; its app${app ? ` ${app}` : ""} is kept as one fixed component for context.`,
  declared: ({ selector }) => selector ? `Declared in .bca.json: ${selector} assigns it.` : PLACEMENT_STEPS.declared
};

/** A placement in one or two sentences, with its numbers. */
export function placementSentence(placement) {
  if (!placement?.step) return undefined;
  let text;
  try {
    text = SENTENCES[placement.step]?.(placement.detail ?? {});
  } catch {
    // A placement without the numbers of its step still gets the general sentence.
  }
  text ??= PLACEMENT_STEPS[placement.step];
  const was = placement.detail?.was;
  // A later step moved the object; say where it came from.
  return was && PLACEMENT_STEPS[was.step] ? `${text} Before that: ${placementSentence(was)}` : text;
}

const SOURCE = { namespace: "namespace", folder: "folder", words: "the word", app: "the app", module: "the module", kept: "your component", fixed: "the app", role: "its role" };

/** "named after namespace Contoso.Sales (9 of 10 objects), told apart by its parent" */
export function namingSentence(naming, { objects } = {}) {
  if (!naming) return undefined;
  if (naming.by === "renamed") return `renamed from "${naming.was}" in architecture.proposal.naming.rename`;
  if (naming.by === "declared") return "named in .bca.json";
  if (naming.by === "kept") return "named by you in architecture.proposal.keep";
  const share = naming.share === undefined ? ""
    : objects ? ` (${Math.round(naming.share * objects)} of ${objects} objects)` : ` (${percent(naming.share)} of its objects)`;
  const qualified = {
    parent: "; the level above tells it from a component of the same name",
    app: "; its app or module tells it from a component of the same name",
    alternative: "; other words its objects share, because the first name was taken",
    number: "; numbered, because nothing else tells it from a component of the same name"
  }[naming.qualifiedBy] ?? "";
  const avoids = naming.avoids ? ` (avoids the ${naming.avoids.kind} ${naming.avoids.name}, which holds other objects)` : "";
  return `named after ${SOURCE[naming.by] ?? naming.by} ${naming.from ?? ""}`.trimEnd() + share + qualified + avoids;
}

/** "12 by coupling, 2 by namespace neighbour" */
export function stepCounts(steps = {}) {
  return Object.entries(steps).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([step, count]) => `${count} ${STEP_LABELS[step] ?? step}`).join(", ");
}
