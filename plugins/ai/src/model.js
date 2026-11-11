// The one place a model is called: an OpenAI-compatible chat completions
// endpoint. A gateway behind that endpoint (LiteLLM, OpenRouter, an Azure or
// a local server) routes to any model of any provider; this plugin knows none
// of them.
export const DEFAULTS = Object.freeze({ outputDir: "docs/narrative", language: "en", temperature: 0.2, timeout: 120 });

/**
 * What the plugin uses: the ai section of .bca.json, and BCA_AI_* over it.
 * The key comes from the environment only; a file that is committed must not hold it.
 * @returns { endpoint, model, apiKey, keyVariable, outputDir, language, temperature, timeout, problems }
 */
export function resolveSettings(settings = {}, env = process.env) {
  const problems = [];
  const keyVariable = settings.apiKeyEnv ?? "BCA_AI_API_KEY";
  if (settings.apiKey !== undefined) problems.push("ai.apiKey is not read: put the key into the environment variable BCA_AI_API_KEY (or the one ai.apiKeyEnv names), never into .bca.json");
  const endpoint = (env.BCA_AI_ENDPOINT || settings.endpoint || "").trim().replace(/\/+$/u, "").replace(/\/chat\/completions$/u, "");
  const model = (env.BCA_AI_MODEL || settings.model || "").trim();
  if (endpoint && !/^https?:\/\//iu.test(endpoint)) problems.push(`ai.endpoint must be an http(s) URL of an OpenAI-compatible API, such as https://gateway.example/v1; got "${endpoint}"`);
  const temperature = settings.temperature ?? DEFAULTS.temperature;
  if (typeof temperature !== "number" || temperature < 0 || temperature > 2) problems.push("ai.temperature must be a number from 0 to 2");
  const timeout = settings.timeout ?? DEFAULTS.timeout;
  if (typeof timeout !== "number" || timeout <= 0) problems.push("ai.timeout must be a number of seconds");
  for (const key of Object.keys(settings)) {
    if (!["endpoint", "model", "apiKeyEnv", "apiKey", "outputDir", "language", "temperature", "timeout"].includes(key)) problems.push(`ai.${key} is not a setting; the settings are endpoint, model, apiKeyEnv, outputDir, language, temperature, timeout`);
  }
  return { endpoint, model, apiKey: env[keyVariable] || undefined, keyVariable, outputDir: settings.outputDir ?? DEFAULTS.outputDir, language: settings.language ?? DEFAULTS.language, temperature, timeout, problems };
}

/** What is still missing before a model can be called. */
export function missingOf(settings) {
  return [
    ...(settings.endpoint ? [] : ["an endpoint: set ai.endpoint in .bca.json or BCA_AI_ENDPOINT to the base URL of an OpenAI-compatible API (https://.../v1)"]),
    ...(settings.model ? [] : ["a model: set ai.model in .bca.json or BCA_AI_MODEL to a model id your endpoint serves"])
  ];
}

export const SYSTEM_PROMPT = [
  "You write documentation for a Microsoft Dynamics 365 Business Central app, for the people who use it and the people who maintain it.",
  "You are given facts that a tool read from the source code. Write only from these facts.",
  "Do not invent objects, fields, permissions, steps, people, or numbers. If the facts do not say something, leave it out.",
  "Where the facts say that someone is blocked, that something is missing, or that a test and a recording differ, say so plainly and name the fix the facts give.",
  "Write Markdown. Start with one level-1 heading. Explain what happens and why in full sentences; use a list only for steps in order.",
  "Keep the names of objects, permission sets, and people exactly as given."
].join(" ");

/**
 * Asks the model for a page.
 * @param settings resolveSettings()
 * @param grounding the facts as Markdown
 * @param fetchImpl for tests
 * @returns { text, model, usage }
 */
export async function writeWithModel(settings, grounding, { fetchImpl = fetch } = {}) {
  const missing = missingOf(settings);
  if (missing.length) throw new Error(`the AI plugin needs ${missing.join("; and ")}`);
  let response;
  try {
    response = await fetchImpl(`${settings.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT} Write in the language with the tag "${settings.language}".` },
          { role: "user", content: grounding }
        ]
      }),
      signal: AbortSignal.timeout(settings.timeout * 1000)
    });
  } catch (error) {
    throw new Error(`the model endpoint ${settings.endpoint} could not be reached: ${error.name === "TimeoutError" ? `no answer within ${settings.timeout} seconds` : error.cause?.message ?? error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body).error?.message ?? detail;
    } catch { /* not JSON */ }
    throw new Error(`the model endpoint answered ${response.status}${response.status === 401 || response.status === 403 ? ` (is the key in ${settings.keyVariable} right?)` : ""}: ${detail}`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("the model endpoint did not answer with JSON; is ai.endpoint the base URL of an OpenAI-compatible API (https://.../v1)?");
  }
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("the model endpoint answered without text (choices[0].message.content)");
  return { text: text.trim(), model: data.model ?? settings.model, usage: data.usage };
}
