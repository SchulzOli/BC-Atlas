const TABLEDATA_RIGHTS = {
  R: "read",
  I: "insert",
  M: "modify",
  D: "delete"
};

export function permissionGrant(type, permission) {
  const access = String(permission).toUpperCase();
  const tabledata = String(type).toLowerCase() === "tabledata";
  return {
    targetType: tabledata ? "table" : String(type).toLowerCase(),
    access,
    permissionKind: tabledata ? "tabledata" : "execute",
    tableDataRights: tabledata
      ? [...access].map((right) => TABLEDATA_RIGHTS[right]).filter(Boolean)
      : undefined,
    execute: tabledata ? false : access.includes("X")
  };
}

function includedEntry(entry) {
  if (entry && typeof entry === "object") {
    const values = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key.toLowerCase(), value])
    );
    return {
      target: values.name ?? values.permissionset ?? values.id,
      targetAppId: values.appid ?? values.applicationid
    };
  }
  const match = String(entry).trim().match(/^(?:#([^#]+)#\s*)?"?([^"\r\n]+?)"?$/u);
  return { target: match?.[2], targetAppId: match?.[1] };
}

export function includedPermissionSets(value) {
  let entries;
  if (Array.isArray(value)) entries = value.map(includedEntry);
  else {
    entries = [...String(value ?? "").matchAll(
      /(?:#([^#]+)#\s*)?(?:"((?:""|[^"])*)"|([A-Za-z_][\w.]*))/gu
    )].map((match) => ({
      target: (match[2] ?? match[3]).replaceAll('""', '"'),
      targetAppId: match[1]
    }));
  }
  return entries.filter(({ target }) => target).map(({ target, targetAppId }) => ({
    target,
    targetType: "permissionset",
    targetAppId,
    kind: "includes",
    permissionSetRelation: "included"
  }));
}

export function classifyPermissionSet(object, includedBy = []) {
  const permissionSetRoles = [object.assignable ? "assignable" : "internal"];
  if (includedBy.length) permissionSetRoles.push("included");
  return {
    ...object,
    included: includedBy.length > 0,
    includedBy,
    permissionSetRoles
  };
}

export function permissionRelationLabel(permissionKind) {
  if (permissionKind === "execute") return "executes";
  if (permissionKind === "tabledata") return "tabledata";
  return undefined;
}
