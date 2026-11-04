table 50200 Ledger { }

codeunit 50201 Context {
  var
    LedgerRecord: Record Ledger;
    Resolver: Codeunit PartnerResolver;
    Planner: Codeunit PlanningService;

  procedure LoadPartner()
  begin
    LedgerRecord.Get('PARTNER');
  end;

  procedure ResolvePartner()
  begin
    Resolver.Resolve();
  end;

  procedure BuildPlan()
  begin
    Planner.Build();
  end;
}

codeunit 50202 PartnerResolver {
  var LedgerRecord: Record Ledger;

  procedure Resolve()
  begin
    LedgerRecord.Get('PARTNER');
  end;
}

codeunit 50203 PlanningService {
  procedure Build()
  begin
  end;
}
