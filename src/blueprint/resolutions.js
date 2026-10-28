// How to resolve a dependency that the target architecture does not allow.
// Every suggestion names one strategy (stable ids for tools and agents), the
// concrete steps in AL terms, and a rough effort:
//   S  move code without changing behavior
//   M  move or split schema
//   L  introduce an abstraction (interface or event)

export const STRATEGIES = Object.freeze({
  "declare-dependency": "Declare the dependency; it points inward",
  "use-facade": "Go through a component you already depend on",
  "move-extension": "Move the extension to the component it extends",
  "move-subscriber": "Move the event subscriber to the publisher's component",
  "move-permissions": "Grant the permissions in the target component",
  "move-field-to-extension": "Move the related field into a table extension",
  "move-object-down": "Move the target object into a lower component",
  "move-object-up": "Move the source object into the target's component",
  "extract-interface": "Invert the dependency with an interface",
  "raise-event": "Replace the call with an integration event",
  "move-navigation": "Move the page navigation into a page extension",
  "move-interface-down": "Move the interface to the consuming component",
  "move-enum-value": "Move the enum value into an enum extension",
  "use-public-api": "Use a public object of the other component",
  "go-through-layer": "Go through the layer in between",
  "follow-rule": "Remove the dependency the rule forbids"
});

const EXTENSION_TYPES = new Set(["tableextension", "pageextension", "reportextension", "enumextension", "permissionsetextension", "pagecustomization"]);

function name(node) {
  // A work item can cover many targets of one source object.
  if (node.many > 1) return `the ${node.many} ${node.type === "table" ? "tables" : "objects"}`;
  return `${node.type} ${node.objectId ? `${node.objectId} ` : ""}"${node.label}"`;
}

function suggestion(strategy, effort, steps, alternatives = []) {
  return { strategy, title: STRATEGIES[strategy], effort, steps, alternatives };
}

/**
 * Picks the resolution for one forbidden object dependency.
 * `usage` maps an object id to the components that depend on it, which tells
 * whether a target object really belongs further down.
 */
export function suggestResolution({ source, target, kinds, sourceComponent, targetComponent, rule, inward, via, policy, between }, { usage } = {}) {
  const has = (kind) => (kinds?.[kind] ?? 0) > 0;
  const from = `component ${sourceComponent}`;
  const to = `component ${targetComponent}`;

  // A rule of .bca.json forbids the dependency; it says what to do instead.
  if (rule === "dependency-rule") {
    return suggestion("follow-rule", "M", [
      policy.resolution ?? policy.message ?? `Remove the dependency of ${name(source)} on ${name(target)}: rule "${policy.name}" forbids it.`,
      ...(policy.resolution && policy.message ? [] : [`Rule "${policy.name}": ${policy.from} must not depend on ${policy.to}${policy.kinds ? ` (${policy.kinds.join(", ")})` : ""}.`])
    ]);
  }

  // The direction is right, but the target is not part of the other
  // component's public surface (Access = Internal, or not in its exposes).
  if (rule === "internal-access") {
    const exposed = target.access !== "internal";
    return suggestion("use-public-api", "S", [
      `Use a public codeunit, interface, or event of ${to} instead of ${name(target)}.`,
      exposed
        ? `If ${name(target)} is meant to be used from other components, add it to exposes of ${targetComponent} in .bca.json.`
        : `If ${name(target)} is meant to be used from other components, set Access = Public on it; an internal object is not visible to other apps.`
    ], [suggestion("move-object-up", "M", [`Move ${name(source)} into ${to} if it belongs to that component's internals.`])]);
  }

  // Strict layers: only the layer directly below may be used.
  if (rule === "layer-skip-dependency") {
    return suggestion("go-through-layer", "M", [
      `Reach ${name(target)} through ${between?.length ? between.join(" or ") : "a component in the layer directly below"} instead of using ${to} directly.`,
      `Or list ${targetComponent} in dependsOn of ${sourceComponent}: a declared dependency may skip layers.`
    ]);
  }

  // The target lies further in: the direction is right, only the declaration
  // is missing (or the dependency should go through an existing one).
  if (rule === "undeclared-component-dependency" && inward) {
    return suggestion("declare-dependency", "S", [
      `Add ${targetComponent} to dependsOn of ${sourceComponent} in .bca.json (and to app.json when they are separate apps).`
    ], via ? [suggestion("use-facade", "M", [`Reach ${name(target)} through ${via}, which ${sourceComponent} already depends on.`])] : []);
  }

  if (has("extends") && EXTENSION_TYPES.has(source.type)) {
    return suggestion("move-extension", "S", [
      `Move ${name(source)} into ${to}, next to ${name(target)}.`,
      `Code in ${from} that needs the extended fields or actions moves with it, or reaches them through ${to}'s public procedures.`
    ]);
  }
  if (has("subscribes") && Object.keys(kinds).every((kind) => ["subscribes", "uses", "calls"].includes(kind))) {
    return suggestion("move-subscriber", "S", [
      `Move the subscriber procedures in ${name(source)} that react to ${name(target)} into a codeunit in ${to}.`,
      `If ${from} must react, let ${to} call it through an interface or an event that ${from} publishes.`
    ]);
  }
  if ((has("permits") || has("includes")) && Object.keys(kinds).every((kind) => ["permits", "includes"].includes(kind))) {
    return suggestion("move-permissions", "S", [
      `Remove the permissions for ${name(target)} from ${name(source)}.`,
      `Grant them in a permission set or permission set extension in ${to}.`
    ]);
  }
  if (has("relates") && source.type === "table" && ["table", "tableextension"].includes(target.type)) {
    return suggestion("move-field-to-extension", "M", [
      `Move the fields of ${name(source)} whose TableRelation points to ${name(target)} into a tableextension of ${name(source)} in ${to}.`,
      "Keep the field IDs (or migrate data with an upgrade codeunit) so existing data survives."
    ], [suggestion("move-object-down", "M", [`Move ${name(target)} into ${from} or a component below it.`])]);
  }
  if (has("implements") && target.type === "interface") {
    return suggestion("move-interface-down", "S", [
      `Move interface ${name(target)} into ${from}: an interface belongs to the component that uses it, the implementation to the one that provides it.`
    ]);
  }
  if (has("selects")) {
    return suggestion("move-enum-value", "S", [
      `Move the enum value that selects ${name(target)} into an enumextension in ${to}.`
    ]);
  }
  if ((has("runs") || has("part")) && source.type?.startsWith("page")) {
    return suggestion("move-navigation", "S", [
      `Move the actions or parts of ${name(source)} that open ${name(target)} into a pageextension in ${to}.`
    ]);
  }
  if (["table", "tableextension", "query"].includes(target.type)) {
    // A table that only lower components use belongs down there.
    const users = usage?.get(target.id) ?? new Set();
    const ownUse = users.has(targetComponent);
    const move = suggestion("move-object-down", "M", [
      `Move ${name(target)} (and the logic that owns its data) into ${from} or a component both can depend on.`,
      "Keep the table ID so data stays in place; update the namespace."
    ]);
    const facade = suggestion("extract-interface", "L", [
      `Define an interface in ${from} for what ${name(source)} needs from ${name(target)}.`,
      `Implement it in a codeunit in ${to} and register it with an enum value, so ${from} never references ${name(target)} directly.`
    ]);
    return ownUse ? { ...facade, alternatives: [move] } : { ...move, alternatives: [facade] };
  }
  if (target.type === "codeunit" || has("calls")) {
    const event = suggestion("raise-event", "L", [
      `If ${name(source)} only notifies ${to}: publish an IntegrationEvent in ${from} and subscribe to it in ${to}.`
    ]);
    return suggestion("extract-interface", "L", [
      `Define an interface in ${from} with the procedures ${name(source)} calls on ${name(target)}.`,
      `Implement the interface in ${to} (an enum value with Implementation = ..., or a setup field that selects it).`,
      `Call the interface from ${name(source)} instead of ${name(target)} (dependency inversion).`
    ], [event]);
  }
  return suggestion("move-object-up", "M", [
    `Move ${name(source)} into ${to}, or move ${name(target)} into ${from}, whichever owns the behavior.`
  ]);
}
