/** Verify the hash chain of an audit log:  npm run audit:verify -- audit.jsonl */
import { verifyAuditFile } from '../src/security/audit.ts';

const file = process.argv[2] ?? process.env.AUDIT_LOG_FILE;
if (!file) {
  console.error('Usage: npm run audit:verify -- <audit.jsonl>');
  process.exit(2);
}
const result = await verifyAuditFile(file);
if (result.ok) {
  console.log(`OK – ${result.records} records, hash chain intact.`);
} else {
  console.error(`TAMPERED – chain broken at line ${result.brokenAt} (${result.reason}); ${result.records} records verified before.`);
  process.exit(1);
}
