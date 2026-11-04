table 50300 Ledger { }

codeunit 50301 PartnerContextFacade {
  var Writer: Codeunit PartnerWriteService;

  procedure SavePartner()
  begin
    Writer.SavePartner();
  end;
}

codeunit 50302 PartnerWriteService {
  var LedgerRecord: Record Ledger;

  procedure SavePartner()
  begin
    LedgerRecord.Insert();
  end;
}
