import test from "node:test";
import assert from "node:assert/strict";
import { testing } from "../src/analyzer.js";
import { alText, documentationComment } from "../src/metadata.js";

const SOURCE = `namespace Contoso.Sales;

/// <summary>Posts sales orders and creates the ledger entries.</summary>
codeunit 50100 "Sales Post"
{
    Access = Internal;
    TableNo = "Sales Header";
    Permissions = tabledata "Sales Header" = RM;

    /// <summary>Posts one order. See <see cref="Check"/>.</summary>
    [Obsolete('Use PostDocument', '24.0')]
    procedure Post(A: Integer): Boolean
    begin
        if (A > 1) and (A < 5) then exit(true) else if A = 0 then exit(false);
        case A of 1: exit(true); 2, 3: exit(false); else exit(true); end;
        while A > 0 do A -= 1;
    end;

    local procedure Check()
    begin
    end;

    [IntegrationEvent(false, false)]
    procedure OnAfterPost()
    begin
    end;
}

table 50101 "Sales Header"
{
    Caption = 'Sales Order', Comment = 'Header of an order', MaxLength = 30;
    DataClassification = CustomerContent;
    ObsoleteState = Pending;
    ObsoleteReason = 'Replaced by Sales Document';
    ObsoleteTag = '25.0';
    fields
    {
        field(1; "No."; Code[20]) { Caption = 'No.'; DataClassification = SystemMetadata; }
        field(2; Amount; Decimal) { FieldClass = FlowField; CalcFormula = sum("Sales Line".Amount); }
    }
    keys { key(PK; "No.") { Clustered = true; } }
}

page 50102 "Sales Orders"
{
    PageType = List;
    SourceTable = "Sales Header";
    UsageCategory = Lists;
    ApplicationArea = Basic, Suite;
    layout { area(Content) { repeater(R) { field("No."; Rec."No.") { ToolTip = 'Specifies the number.'; } } } }
}`;

async function objects() {
  const result = await testing.objectsFromSource(SOURCE, "src/Sales.al");
  return new Map((result.objects ?? result).map((object) => [object.name, object]));
}

test("objects carry what characterizes them: purpose, access, kind, size, and complexity", async () => {
  const byName = await objects();
  const codeunit = byName.get("Sales Post").metadata;
  assert.equal(codeunit.documentation, "Posts sales orders and creates the ledger entries.");
  assert.equal(codeunit.access, "internal");
  assert.equal(codeunit.tableNo, "Sales Header");
  assert.deepEqual(codeunit.size, { lines: 24, procedures: 2, publicProcedures: 1, events: 1 });
  assert.deepEqual(codeunit.complexity, { total: 9, max: 7, average: 3, mostComplex: "Post" });

  const table = byName.get("Sales Header").metadata;
  assert.equal(table.caption, "Sales Order");
  assert.equal(table.captionComment, "Header of an order");
  assert.equal(table.access, "public", "public is the AL default");
  assert.deepEqual(table.obsolete, { state: "pending", reason: "Replaced by Sales Document", tag: "25.0" });
  assert.equal(table.dataClassification, "CustomerContent");
  assert.deepEqual(table.size, { lines: 14, fields: 2, keys: 1 });

  const page = byName.get("Sales Orders").metadata;
  assert.equal(page.pageType, "List");
  assert.equal(page.sourceTable, "Sales Header");
  assert.deepEqual(page.applicationArea, ["Basic", "Suite"]);
  assert.equal(page.size.pageFields, 1);
});

test("procedures and fields carry their documentation, obsolete state, and complexity", async () => {
  const byName = await objects();
  const [post, check] = byName.get("Sales Post").procedures;
  // 1 + if, else if, and, two case branches, while
  assert.deepEqual(post.metadata, {
    documentation: "Posts one order. See Check.",
    lines: 6,
    complexity: 7,
    obsolete: { state: "pending", reason: "Use PostDocument", tag: "24.0" }
  });
  assert.deepEqual(check.metadata, { lines: 3, complexity: 1 });
  const [number, amount] = byName.get("Sales Header").fields;
  assert.deepEqual(number.metadata, { caption: "No.", dataClassification: "SystemMetadata" });
  assert.equal(amount.metadata.fieldClass, "FlowField");
  assert.match(amount.metadata.calcFormula, /^sum\("Sales Line"\.Amount\)$/u);
  assert.equal(byName.get("Sales Orders").fields[0].metadata.toolTip, "Specifies the number.");
  // The raw properties stay as they were.
  assert.equal(byName.get("Sales Header").properties.find(({ name }) => name === "Caption").value, "'Sales Order', Comment = 'Header of an order', MaxLength = 30");
});

test("AL text properties and documentation comments are read like the AL compiler reads them", () => {
  assert.deepEqual(alText("'It''s', Comment = 'c, d', Locked = true, MaxLength = 30"), { text: "It's", comment: "c, d", locked: true, maxLength: 30 });
  assert.deepEqual(alText("'Plain'"), { text: "Plain" });
  const source = "/// <summary>\n/// Line one\n/// and <paramref name=\"A\"/>.\n/// </summary>\n/// <param name=\"A\">x</param>\n[Scope('OnPrem')]\nprocedure X()";
  assert.equal(documentationComment(source, source.indexOf("[Scope")), "Line one and A.");
  const pragma = "/// <summary>Requests feedback.</summary>\n#pragma warning disable AS0022\n[Scope('OnPrem')]\nprocedure X()";
  assert.equal(documentationComment(pragma, pragma.indexOf("[Scope")), "Requests feedback.", "pragmas between the comment and the declaration");
  assert.equal(documentationComment("// plain comment\nprocedure X()", "// plain comment\n".length), undefined, "only /// comments document");
  const further = "/// <summary>Old</summary>\nvar x;\nprocedure X()";
  assert.equal(documentationComment(further, further.indexOf("procedure")), undefined, "a comment further up belongs to something else");
});

test("objects from symbol packages carry metadata too, also in nested namespaces", async () => {
  const { testing: symbols } = await import("../src/symbols.js");
  const objects = symbols.objectsFor({
    Tables: [{
      Id: 18, Name: "Customer",
      Properties: [{ Name: "Caption", Value: "Customer" }, { Name: "DataClassification", Value: "CustomerContent" }],
      Fields: [{ Id: 1, Name: "No." }, { Id: 2, Name: "Name" }],
      Keys: [{ Name: "PK" }],
      Methods: [{ Name: "GetName" }, { Name: "OnAfterInsert", Attributes: [{ Name: "IntegrationEvent" }] }, { Name: "Helper", IsInternal: true }]
    }],
    Namespaces: [{ Name: "Microsoft", Namespaces: [{ Name: "Sales", Codeunits: [{
      Id: 80, Name: "Sales-Post",
      Properties: [{ Name: "TableNo", Value: "Sales Header" }, { Name: "Access", Value: "Internal" }, { Name: "ObsoleteState", Value: "Pending" }, { Name: "ObsoleteReason", Value: "Use Sales Post v2" }]
    }] }] }]
  }, { name: "Base Application" }, "Base.app");
  const [customer, post] = objects;
  assert.deepEqual(customer.metadata, {
    caption: "Customer",
    access: "public",
    dataClassification: "CustomerContent",
    size: { fields: 2, keys: 1, procedures: 2, publicProcedures: 1, events: 1 }
  });
  assert.equal(post.namespace, "Microsoft.Sales");
  assert.equal(post.metadata.access, "internal");
  assert.deepEqual(post.metadata.obsolete, { state: "pending", reason: "Use Sales Post v2" });
  assert.ok(Object.isFrozen(customer.metadata.size), "the cached metadata cannot be changed by a caller");
});

// The shape of a real SymbolReference.json (Base Application 29): objects in
// nested namespaces, EnumTypes, page controls with numeric kinds, actions in
// groups, the source table by ID, application areas with #, local methods.
test("symbol packages in the format the AL compiler writes are read completely", async () => {
  const { testing: symbols } = await import("../src/symbols.js");
  const objects = symbols.objectsFor({
    Namespaces: [{ Name: "Microsoft", Namespaces: [{ Name: "Sales", Namespaces: [{
      Name: "Customer",
      Tables: [{ Id: 18, Name: "Customer", Properties: [{ Name: "Caption", Value: "Customer" }], Fields: [{ Id: 1, Name: "No." }] }],
      Pages: [{
        Id: 22, Name: "Customer List",
        Properties: [{ Name: "PageType", Value: "List" }, { Name: "SourceTable", Value: "18" }, { Name: "UsageCategory", Value: "Lists" }, { Name: "ApplicationArea", Value: "#Basic, #Suite" }],
        Controls: [{ Kind: 0, Controls: [{ Kind: 1, Controls: [
          { Kind: 8, Name: "No.", Properties: [{ Name: "SourceExpression", Value: "Rec.\"No.\"" }] },
          { Kind: 8, Name: "Name", Properties: [{ Name: "SourceExpression", Value: "Rec.Name" }] }
        ] }] }],
        Actions: [{ Kind: 1, Actions: [{ Kind: 2, Name: "Ledger" }, { Kind: 2, Name: "Statistics" }] }],
        Methods: [{ Name: "GetSelection" }, { Name: "Helper", IsLocal: true }]
      }],
      EnumTypes: [{ Id: 36, Name: "Customer Type", Values: [{ Name: "Person" }, { Name: "Company" }], Properties: [{ Name: "Extensible", Value: "true" }] }],
      Profiles: [{ Name: "SALES MANAGER" }],
      ControlAddIns: [{ Name: "Chart" }]
    }] }] }]
  }, { name: "Base Application" }, "Base.app");
  const byName = new Map(objects.map((object) => [object.name, object]));
  assert.deepEqual(objects.map(({ type }) => type).sort(), ["controladdin", "enum", "page", "profile", "table"]);
  const list = byName.get("Customer List");
  assert.equal(list.namespace, "Microsoft.Sales.Customer");
  assert.equal(list.metadata.sourceTable, "Customer", "the source table ID is resolved to its name");
  assert.deepEqual(list.metadata.applicationArea, ["Basic", "Suite"]);
  assert.deepEqual(list.metadata.size, { pageFields: 2, procedures: 2, publicProcedures: 1, actions: 2 });
  assert.deepEqual(byName.get("Customer Type").metadata.size, { elements: 2 });
});
