import { assessArchitecture } from "../blueprint/index.js";
import { applyRefactoring, planMove } from "../refactor/move.js";

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
