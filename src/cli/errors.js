export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

export class CheckFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckFailedError";
    this.exitCode = 1;
    this.quiet = true;
  }
}

// Turns low-level Node.js errors into messages that name the offending path.
export function describeError(error) {
  if (error?.code === "ENOENT" && error.path) return `path not found: ${error.path}`;
  if (error?.code === "EACCES" && error.path) return `permission denied: ${error.path}`;
  if (error?.code === "ENOTDIR" && error.path) return `not a directory: ${error.path}`;
  return error?.message ?? String(error);
}
