import test from "node:test";
import assert from "node:assert/strict";
import { createCallResolver } from "../src/call-analysis.js";
import { isCommitCall, operationKind } from "../src/operation-semantics.js";
import {
  classifyPermissionSet,
  includedPermissionSets,
  permissionGrant
} from "../src/permission-semantics.js";
import { aggregateRelations } from "../src/relation-aggregation.js";

test("central semantics modules preserve their domain invariants", () => {
  assert.equal(operationKind("FindFirst"), "reads");
  assert.equal(operationKind("ModifyAll"), "writes");
  assert.equal(operationKind("Message"), undefined);
  assert.equal(isCommitCall({ name: "Commit", arity: 0 }), true);

  const relations = aggregateRelations([
    { from: "a", to: "b", kind: "writes", operation: "Insert", sourceProcedure: "Run()" },
    { from: "a", to: "b", kind: "writes", operation: "Modify", sourceProcedure: "Run()", weight: 2 }
  ], { identity: ({ from, to, kind }) => `${from}|${to}|${kind}` });
  assert.equal(relations[0].weight, 3);
  assert.deepEqual(relations[0].operations, ["Insert", "Modify"]);
  assert.deepEqual(relations[0].sourceProcedures, ["Run()"]);

  assert.deepEqual(permissionGrant("tabledata", "RIMD").tableDataRights,
    ["read", "insert", "modify", "delete"]);
  assert.equal(permissionGrant("codeunit", "X").execute, true);
  assert.deepEqual(includedPermissionSets('#dependency#"Base"')[0], {
    target: "Base",
    targetType: "permissionset",
    targetAppId: "dependency",
    kind: "includes",
    permissionSetRelation: "included"
  });
  assert.deepEqual(
    classifyPermissionSet({ assignable: false }, ["parent"]).permissionSetRoles,
    ["internal", "included"]
  );

  const owner = {
    key: "owner", name: "Caller", namespace: "Demo", type: "codeunit",
    variables: [{ name: "Target", targetType: "codeunit", target: "Callee", scope: 1 }]
  };
  const callee = { key: "callee", name: "Callee", namespace: "Demo", type: "codeunit" };
  const procedure = { name: "Run", arity: 1, location: { line: 10 } };
  const node = { key: "callee::Run" };
  const resolver = createCallResolver(
    { objects: [owner, callee] },
    [{ owner: callee, procedure, node }]
  );
  assert.equal(resolver.resolveCall(owner, {
    receiver: "Target", name: "Run", arity: 1, scope: 1
  }).target, node);
});
