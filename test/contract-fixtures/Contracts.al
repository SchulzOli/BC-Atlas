namespace Demo;

interface Contract {
  procedure Required(): Boolean;
  procedure Inherited() begin end;
}

codeunit 50100 Handler {
  procedure Required(): Boolean begin exit(true); end;
}

codeunit 50101 Override {
  procedure Required(): Boolean begin Error('failed'); end;
}

enum 50102 Choice {
  DefaultImplementation = "Demo.Contract" = Handler;
  value(0; Defaulted) { }
  value(1; Explicit) {
    Implementation = "Demo.Contract" = Override;
  }
}
