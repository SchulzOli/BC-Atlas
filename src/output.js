import path from "node:path";

/** Shows a path relative to the working directory when it is inside it. */
export function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (!relative) return ".";
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative.replaceAll("\\", "/");
}
