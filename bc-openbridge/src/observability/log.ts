/**
 * Structured JSON logging to stdout (12-factor). Sensitive keys are redacted
 * recursively so that tokens, secrets and API keys never reach log sinks.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE = /authorization|secret|password|passwd|token|api[-_]?key|cookie|client[-_]?state|signature/i;

let minLevel: LogLevel = parseLevel(process.env.LOG_LEVEL);

function parseLevel(v: string | undefined): LogLevel {
  return v && v in ORDER ? (v as LogLevel) : 'info';
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level: Exclude<LogLevel, 'silent'>, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
