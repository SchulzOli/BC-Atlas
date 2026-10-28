import { assessArchitecture } from "../blueprint/index.js";
import { applyRefactoring, planMove } from "../refactor/move.js";
import { planSurface } from "../refactor/surface.js";

/** The analysis behind a refactoring needs the source only; the AL compiler stays off unless asked for. */
export async function planObjectMove(input, values = {}) {
  const assessment = await assessArchitecture(input, { ...values, compiler: values.compiler ?? "off" });
  return { assessment, plan: await planMove(assessment, values) };
}

function formatPlan(plan, applied) {
  const lines = [
    `Move ${plan.object.type} ${plan.object.id ? `${plan.object.id} ` : ""}${plan.object.name}`,
    `  from ${plan.from.component ?? "(no component)"}: ${plan.from.file}${plan.from.namespace ? ` (namespace ${plan.from.namespace})` : ""}`,
    `  to   ${plan.to.component ?? "(folder)"}: ${plan.to.file}${plan.to.namespace ? ` (namespace ${plan.to.namespace})` : ""}`,
    ""
  ];
  for (const warning of plan.warnings) lines.push(`  ! ${warning}`);
  if (plan.warnings.length) lines.push("");
  return `${lines.join("\n")}${applied ? "" : plan.diff}\n${applied
    ? `Changed ${applied.length} file(s). Compile, then run bca check.`
    : "Dry run: nothing was written. Add --apply to make these changes."}\n`;
}

export async function refactorMoveCommand(input, values) {
  const { assessment, plan } = await planObjectMove(input, values);
  const applied = values.apply ? await applyRefactoring(assessment.model.root, plan) : undefined;
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...plan, applied: Boolean(applied) }, null, 2)}\n`);
  } else {
    process.stdout.write(formatPlan(plan, applied));
  }
}

export async function refactorSurfaceCommand(input, values) {
  const assessment = await assessArchitecture(input, { ...values, compiler: values.compiler ?? "off" });
  const plan = await planSurface(assessment, {
    component: values.component,
    internal: values.internal !== "false",
    exposes: values.exposes !== "false"
  });
  const applied = values.apply ? await applyRefactoring(assessment.model.root, plan) : undefined;
  if (values.format === "json") {
    process.stdout.write(`${JSON.stringify({ ...plan, applied: Boolean(applied) }, null, 2)}\n`);
    return;
  }
  const lines = [`Lock the public surface of ${plan.components.join(", ")}`];
  if (plan.internalized.length) lines.push(`  Access = Internal: ${plan.internalized.join(", ")}`);
  for (const { component, exposes } of plan.exposed) lines.push(`  ${component} exposes ${exposes.length} object(s)`);
  if (!plan.operations.length) lines.push("  Nothing to change.");
  for (const warning of plan.warnings) lines.push(`  ! ${warning}`);
  process.stdout.write(`${lines.join("\n")}\n\n${applied ? "" : plan.diff}${applied
    ? `Changed ${applied.length} file(s). Compile, then run bca check.`
    : "Dry run: nothing was written. Add --apply to make these changes."}\n`);
}
