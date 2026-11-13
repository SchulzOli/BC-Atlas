/**
 * Generate a new API key.
 *
 *   npm run create-api-key -- --name "ERP-Sync" --scopes bc.read,bc.customers.write [--expires 2027-12-31] [--file api-keys.json]
 *
 * The plaintext key is printed ONCE. Only its SHA-256 hash is stored.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateApiKey, type ApiKeyRecord } from '../src/security/apikeys.ts';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    scopes: { type: 'string', default: 'bc.read' },
    expires: { type: 'string' },
    file: { type: 'string' },
  },
});

if (!values.name) {
  console.error('Usage: npm run create-api-key -- --name <name> --scopes bc.read,events.read [--expires YYYY-MM-DD] [--file api-keys.json]');
  process.exit(1);
}

const expiresAt = values.expires ? new Date(values.expires).toISOString() : undefined;
const { key, record } = generateApiKey(values.name, values.scopes!.split(',').map((s) => s.trim()).filter(Boolean), expiresAt);

if (values.file) {
  const list: ApiKeyRecord[] = existsSync(values.file) ? JSON.parse(readFileSync(values.file, 'utf8')) : [];
  list.push(record);
  writeFileSync(values.file, JSON.stringify(list, null, 2) + '\n', { mode: 0o600 });
  console.error(`Record appended to ${values.file}`);
} else {
  console.error('Add this record to your API_KEYS_FILE:');
  console.log(JSON.stringify(record, null, 2));
}
console.error('\nAPI key (shown only once – store it in a secret manager):');
console.error(`  ${key}\n`);
