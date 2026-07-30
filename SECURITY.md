# Security policy

## Supported versions

Security fixes are applied to the latest released version and the default
branch. Older releases may not receive patches.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub's private vulnerability reporting](https://github.com/SchulzOli/ALD2Tree/security/advisories/new)
to share:

- the affected version or commit;
- reproduction steps or a proof of concept;
- the possible impact; and
- any suggested mitigation.

You should receive an acknowledgement within seven days. The maintainers will
investigate, coordinate a fix and disclosure where appropriate, and credit
reporters who wish to be named.

BC Atlas parses source files and may invoke a locally installed `d2` executable
for PNG or PDF output. Do not analyze untrusted repositories with executable
configuration or replace the renderer with an untrusted binary.
