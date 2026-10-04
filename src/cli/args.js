import { parseArgs } from "node:util";
import { UsageError } from "./errors.js";

function positionalSpec(definition) {
  const token = definition.argv.at(-1);
  const match = /^([<[])([^>\]]+)[>\]]$/u.exec(token);
  if (!match) return undefined;
  return { name: match[2], required: match[1] === "<" };
}

function parseOptions(definition) {
  const options = { help: { type: "boolean", short: "h" } };
  for (const option of Object.values(definition.options)) {
    options[option.cli.slice(2)] = {
      type: option.type === "boolean" ? "boolean" : "string",
      ...(option.repeatable ? { multiple: true } : {}),
      ...(option.short ? { short: option.short.slice(1) } : {})
    };
  }
  return options;
}

function validateOption(name, option, value) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (option.enum && !option.enum.includes(item)) {
      throw new UsageError(`${option.cli} must be one of: ${option.enum.join(", ")} (received "${item}")`);
    }
    if (option.const !== undefined && item !== option.const) {
      throw new UsageError(`${option.cli} only accepts "${option.const}" for this command`);
    }
  }
  return value;
}

/**
 * Parses argv for one catalog command and returns camelCase option values
 * keyed exactly like the capability contract.
 */
export function parseCommandArgs(definition, args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: parseOptions(definition)
    });
  } catch (error) {
    throw new UsageError(error.message.replace(/\. To specify a positional.*$/su, ""));
  }

  const values = {};
  for (const [name, option] of Object.entries(definition.options)) {
    const value = parsed.values[option.cli.slice(2)];
    if (value !== undefined) values[name] = validateOption(name, option, value);
  }
  if (parsed.values.help) return { help: true, values, positionals: parsed.positionals };

  const spec = positionalSpec(definition);
  const positionals = parsed.positionals;
  if (!spec && positionals.length) {
    throw new UsageError(`${definition.argv.join(" ")} does not accept a path`);
  }
  if (spec && positionals.length > 1) {
    throw new UsageError(`expected one <${spec.name}>, received ${positionals.length}: ${positionals.join(" ")}`);
  }
  if (spec?.required && !positionals.length) throw new UsageError(`missing <${spec.name}>`);

  for (const [name, option] of Object.entries(definition.options)) {
    if (option.required && values[name] === undefined) {
      throw new UsageError(`${option.cli} is required`);
    }
  }
  return { help: false, values, input: positionals[0] ?? (spec ? "." : undefined) };
}
