// The architecture for the view: why each component is what it is, how well the architecture
// meets the goals of the template in use, the templates there are, and the architecture as it
// is next to the one it should be. The view shows it in its Architecture menu and in the
// inspector of a component or an object; a snapshot carries it, VS Code asks for the rest.
import { compareLevels } from "../blueprint/compare.js";
import { explainComponent, explainPlacement, placementIndex } from "../blueprint/explain.js";
import { CRITERIA } from "../blueprint/goals.js";
import { PLACEMENT_STEPS, placementSentence, STEP_LABELS } from "../blueprint/placement.js";
import { listTemplates } from "../blueprint/templates.js";

// Above this many objects a snapshot names the step of each object, without its sentence.
const MOST_SENTENCES = 3000;

/** A comparison as the view shows it: without the evaluated sides, and with a limit on what is listed. */
export function compareForView(result) {
  const { sides: _sides, ...rest } = result;
  return { ...rest, moves: result.moves.slice(0, 50), steps: result.steps.slice(0, 12) };
}

/**
 * @param assessment from assessArchitecture
 * @param options { compare: also compare the structure of today with the target (a snapshot has no engine to ask) }
 * @returns { mode, template, score, components: { [name]: { why, naming, steps, agreement, coupling } }, steps, stepLabels,
 *   placements: { [object id]: [step, sentence?] }, templates, criteria, compare? }
 */
export function architectureForView(assessment, { compare = false } = {}) {
  const { context, levels, proposal, result, template, score } = assessment;
  const root = context.projectRoot;
  const architecture = context.options.architecture ?? {};
  const components = {};
  for (const { name } of result.components) {
    const explanation = explainComponent(assessment, name, { limit: 1 });
    if (!explanation) continue;
    const { members: _members, more: _more, thresholds: _thresholds, ...shown } = explanation;
    components[name] = shown;
  }
  // Why each object is where it is: the step, and what that step looked at.
  const placements = {};
  const many = (proposal?.placements?.size ?? 0) > MOST_SENTENCES;
  for (const [id, placement] of proposal?.placements ?? []) placements[id] = many ? [placement.step] : [placement.step, placementSentence(placement)];
  // A configured architecture declares it: the selector that assigns the object.
  if (!proposal && result.assignment.size <= MOST_SENTENCES) {
    const index = placementIndex(assessment);
    for (const id of result.assignment.keys()) {
      const { selector, why } = explainPlacement(assessment, id, index) ?? {};
      if (selector || why) placements[id] = ["declared", why ?? `Declared in .bca.json: the selector ${selector} assigns it.`];
    }
  }
  let compared;
  if (compare) {
    try {
      // The proposal under the template in use; the best of several takes too long for every export.
      compared = compareForView(compareLevels(levels, { root, architecture, values: { to: architecture.components?.length ? "configured" : "proposal" } }));
    } catch {
      // The architecture is shown although it cannot be compared.
    }
  }
  return {
    mode: proposal ? "proposal" : "configured",
    template: template.template,
    goals: { weights: template.goals.weights, size: template.goals.size },
    score: { total: score.total, criteria: score.criteria.map(({ id, title, score: value, weight, why }) => ({ id, title, score: value, weight, why })) },
    components,
    steps: PLACEMENT_STEPS,
    stepLabels: STEP_LABELS,
    placements,
    templates: listTemplates(root, architecture).map(({ name, title, summary, origin, active, error, goals }) => ({ name, title, summary, origin, active, ...(error ? { error } : {}), weights: goals?.weights ?? {} })),
    criteria: CRITERIA.map(({ id, title, meaning }) => ({ id, title, meaning })),
    ...(compared ? { compare: compared } : {})
  };
}
