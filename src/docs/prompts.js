import path from "node:path";

function contractBlock(scenario) {
  return JSON.stringify({
    id: scenario.value.id,
    title: scenario.value.title,
    goal: scenario.value.goal,
    start: scenario.value.start,
    prerequisites: scenario.value.prerequisites,
    expected: scenario.value.expected,
    constraints: scenario.value.constraints
  }, null, 2);
}

function commonRules(scenario, testPath, bcUrl) {
  return `Scenario contract: ${scenario.relativePath}
Test file: ${path.relative(process.cwd(), testPath).replaceAll("\\", "/")}
Business Central URL: ${bcUrl}

Immutable contract:
\`\`\`json
${contractBlock(scenario)}
\`\`\`

Rules:
- Work only in the requested test file. Do not edit the scenario contract.
- Use @playwright/test and JavaScript.
- Read the URL from process.env.BC_URL, falling back to the URL above.
- Use user-facing role, label, and text locators. Do not persist snapshot refs such as e123.
- Business Central content may be inside an iframe; locate it without relying on a generated title.
- Express each customer-visible action with test.step("...", ...).
- For every expected outcome, add a test.step("Verify: <exact expected text>", ...) containing
  the assertion that proves it. Keep the expected text exactly as written in the contract.
- Add a Playwright test annotation with type "scenario" and description "${scenario.relativePath}".
- Prove every expected outcome with an assertion. Never weaken or remove an expected outcome.
- Obey every constraint. Do not touch unrelated Business Central data or setup.
- Use unique test data where the scenario creates records.
- Attach a final screenshot as "result" using testInfo.attach with image/png.
- Run the test against the supplied URL and leave it passing.
- If authentication, permissions, environment state, or a semantic product change blocks the task, stop and report the blocker instead of bypassing validation.`;
}

export function generationPrompt({ scenario, testPath, bcUrl }) {
  return `You are the Playwright test generator for ald2tree's executable documentation.

Explore the live Business Central application, implement the scenario, execute it, and stabilize it.
The finished test is both an acceptance test and the source for customer-facing Markdown.

${commonRules(scenario, testPath, bcUrl)}

Create the requested test now.`;
}

export function healingPrompt({ scenario, testPath, bcUrl }) {
  return `You are the Playwright test healer for ald2tree's executable documentation.

Run the existing test first and inspect its Playwright trace, screenshot, current Business Central UI,
and relevant repository source. Repair technical drift only: navigation, resilient locators, timing,
or equivalent UI interaction changes.

${commonRules(scenario, testPath, bcUrl)}

Additional healing rules:
- Preserve the scenario's business meaning and all existing customer-visible test.step descriptions.
- Do not delete assertions, skip the test, broaden selectors until they match arbitrary controls, or
  catch and ignore failures.
- If the application behavior has changed semantically, do not make the test green. Report the
  difference so a human can decide whether to update the scenario.

Heal and rerun the test now.`;
}
