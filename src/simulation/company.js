// The company that uses the app, as the `simulation` section of .bca.json
// describes it: task groups (what there is to do), roles (permission sets
// and task groups), agents (the people who hold roles), and requirements
// (what the company needs the app to do, for the fit-gap analysis).
//
//   "simulation": {
//     "company": "Contoso GmbH",
//     "taskGroups": [{ "name": "Approval", "tasks": ["purchase-request-approve"] }],
//     "roles": [{ "name": "Team lead", "permissionSets": ["PR - APPROVE"], "taskGroups": ["Approval"], "mustNot": ["purchase-request-order"] }],
//     "agents": [{ "name": "Ben", "roles": ["Team lead"] }],
//     "requirements": [{ "id": "REQ-2", "title": "Requests are approved", "tasks": ["purchase-request-approve"] }]
//   }
//
// Without roles, the process tests describe the company themselves: every
// combination of [PERMISSIONS] becomes a role that performs the tests naming
// it, every [FEATURE] a task group and a requirement.
import { normalizeIdentifier } from "../resolver.js";

const same = (a, b) => normalizeIdentifier(a) === normalizeIdentifier(b);

function strings(value, where) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`simulation: ${where} must be a list of names`);
  return value;
}

function entries(value, where) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`simulation: ${where} must be a list of objects`);
  }
  return value;
}

function named(list, where, key = "name") {
  const seen = new Set();
  for (const item of list) {
    if (typeof item[key] !== "string" || !item[key].trim()) throw new Error(`simulation: every entry of ${where} needs "${key}"`);
    const id = normalizeIdentifier(item[key]);
    if (seen.has(id)) throw new Error(`simulation: ${where} lists "${item[key]}" twice`);
    seen.add(id);
  }
  return list;
}

/**
 * @param settings the simulation section
 * @param catalog the documentation catalog of the process tests (buildCatalog)
 * @returns { name, derived, taskGroups, roles, agents, requirements, problems }
 */
export function createCompany(settings = {}, catalog) {
  const problems = [];
  const taskIds = new Map(catalog.tasks.map((task) => [normalizeIdentifier(task.id), task.id]));
  const byFeature = new Map();
  for (const useCase of catalog.useCases.filter(({ feature }) => feature)) {
    byFeature.set(normalizeIdentifier(useCase.feature), [...useCase.main, ...useCase.alternatives].map(({ id }) => id));
  }
  const unique = (list) => [...new Set(list)];

  // Task IDs behind explicit tasks and features; unknown names become problems.
  const resolve = (item, owner) => {
    const tasks = [];
    for (const id of strings(item.tasks, `${owner}.tasks`)) {
      if (taskIds.has(normalizeIdentifier(id))) tasks.push(taskIds.get(normalizeIdentifier(id)));
      else problems.push({ code: "unknown-task", name: id, owner });
    }
    for (const feature of strings(item.features, `${owner}.features`)) {
      if (byFeature.has(normalizeIdentifier(feature))) tasks.push(...byFeature.get(normalizeIdentifier(feature)));
      else problems.push({ code: "unknown-feature", name: feature, owner });
    }
    return unique(tasks);
  };

  const configuredGroups = named(entries(settings.taskGroups, "taskGroups"), "taskGroups");
  const taskGroups = configuredGroups.length
    ? configuredGroups.map((group) => ({ name: group.name, description: group.description, tasks: resolve(group, `task group "${group.name}"`) }))
    : catalog.useCases.filter(({ feature }) => feature).map((useCase) => ({
      name: useCase.title,
      feature: useCase.feature,
      derived: true,
      tasks: byFeature.get(normalizeIdentifier(useCase.feature))
    }));
  const groupNamed = (name) => taskGroups.find((group) => same(group.name, name) || (group.feature && same(group.feature, name)));

  // What someone does: task groups, plus single tasks and features.
  const assignment = (item, owner) => {
    const groups = [];
    const tasks = resolve(item, owner);
    for (const name of strings(item.taskGroups, `${owner}.taskGroups`)) {
      const group = groupNamed(name);
      if (!group) problems.push({ code: "unknown-task-group", name, owner });
      else {
        groups.push(group.name);
        tasks.push(...group.tasks);
      }
    }
    // What they must not be able to do: tasks, features, or task groups.
    const mustNot = [];
    for (const name of strings(item.mustNot, `${owner}.mustNot`)) {
      const group = groupNamed(name);
      if (taskIds.has(normalizeIdentifier(name))) mustNot.push(taskIds.get(normalizeIdentifier(name)));
      else if (byFeature.has(normalizeIdentifier(name))) mustNot.push(...byFeature.get(normalizeIdentifier(name)));
      else if (group) mustNot.push(...group.tasks);
      else problems.push({ code: "unknown-task", name, owner });
    }
    return { taskGroups: unique(groups), tasks: unique(tasks), mustNot: unique(mustNot) };
  };

  let roles = named(entries(settings.roles, "roles"), "roles").map((role) => ({
    name: role.name,
    description: role.description,
    permissionSets: strings(role.permissionSets, `role "${role.name}".permissionSets`),
    ...assignment(role, `role "${role.name}"`)
  }));
  let agents = named(entries(settings.agents, "agents"), "agents");
  const derived = !roles.length && !agents.length;
  if (derived) {
    // The tests name who performs them: one role per combination of [PERMISSIONS].
    const combinations = new Map();
    for (const task of catalog.tasks.filter(({ permissions }) => permissions.length)) {
      const sets = [...task.permissions].sort((a, b) => a.localeCompare(b));
      const key = sets.map(normalizeIdentifier).join("\u0000");
      if (!combinations.has(key)) combinations.set(key, { name: sets.join(" + "), permissionSets: sets, taskGroups: [], tasks: [], mustNot: [], derived: true });
      combinations.get(key).tasks.push(task.id);
    }
    roles = [...combinations.values()];
  }
  const roleNamed = (name) => roles.find((role) => same(role.name, name));

  agents = (agents.length ? agents : roles.map(({ name }) => ({ name, roles: [name], derived: true }))).map((agent) => {
    const owner = `agent "${agent.name}"`;
    const held = [];
    for (const name of strings(agent.roles, `${owner}.roles`)) {
      const role = roleNamed(name);
      if (role) held.push(role);
      else problems.push({ code: "unknown-role", name, owner });
    }
    const own = assignment(agent, owner);
    const mustNot = unique([...held.flatMap((role) => role.mustNot), ...own.mustNot]);
    const tasks = unique([...held.flatMap((role) => role.tasks), ...own.tasks]);
    for (const id of tasks.filter((task) => mustNot.includes(task))) problems.push({ code: "assigned-and-forbidden", name: id, owner });
    return {
      name: agent.name,
      description: agent.description,
      ...(agent.derived ? { derived: true } : {}),
      roles: held.map(({ name }) => name),
      permissionSets: unique([...held.flatMap((role) => role.permissionSets), ...strings(agent.permissionSets, `${owner}.permissionSets`)]),
      taskGroups: unique([...held.flatMap((role) => role.taskGroups), ...own.taskGroups]),
      tasks,
      mustNot: mustNot.filter((task) => !tasks.includes(task))
    };
  });

  const configuredRequirements = named(entries(settings.requirements, "requirements"), "requirements", "id");
  const requirements = configuredRequirements.length
    ? configuredRequirements.map((requirement) => {
      const before = problems.length;
      const tasks = resolve(requirement, `requirement "${requirement.id}"`);
      // A task the requirement names but no process test has is a gap, not a mistake.
      const missing = problems.splice(before).map(({ name }) => name);
      return {
        id: requirement.id,
        title: requirement.title ?? requirement.id,
        description: requirement.description,
        tasks,
        missingTasks: missing,
        objects: strings(requirement.objects, `requirement "${requirement.id}".objects`)
      };
    })
    : catalog.useCases.filter(({ feature }) => feature).map((useCase) => ({
      id: useCase.id,
      title: useCase.title,
      derived: true,
      tasks: byFeature.get(normalizeIdentifier(useCase.feature)),
      missingTasks: [],
      objects: []
    }));

  return {
    name: typeof settings.company === "string" && settings.company.trim() ? settings.company.trim() : undefined,
    derived,
    taskGroups,
    roles,
    agents,
    requirements,
    requirementsDerived: !configuredRequirements.length,
    problems
  };
}
