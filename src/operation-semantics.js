const OPERATIONS = new Map([
  ...["get", "find", "findfirst", "findlast", "findset", "isempty", "count", "calcfields", "calcsums", "next"]
    .map((name) => [name, "reads"]),
  ...["insert", "modify", "modifyall", "delete", "deleteall", "rename"]
    .map((name) => [name, "writes"])
]);

export function operationKind(name) {
  return OPERATIONS.get(String(name ?? "").toLowerCase());
}

export function isCommitCall({ name, receiver, arity } = {}) {
  return String(name ?? "").toLowerCase() === "commit" &&
    (!receiver || String(receiver).toLowerCase() === "database") && arity === 0;
}
