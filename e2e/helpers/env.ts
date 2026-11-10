import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Root of the e2e project (the folder that contains package.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT, '.env') });

/** Saved browser sign-in, written by `npm run login`. Never commit it. */
export const STATE_PATH = path.join(ROOT, '.auth', 'state.json');

/** Folder for files the test produces besides video/trace (ZIP downloads). */
export const ARTIFACTS_DIR = path.join(ROOT, 'test-results', 'artifacts');

export const FIXTURES_DIR = path.join(ROOT, 'fixtures');

function read(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export interface BcConfig {
  baseUrl: string;
  tenant: string;
  environment: string;
  company: string;
  processName: string;
  customer: string;
  itemNo: string;
  slowMo: number;
}

export const config: BcConfig = {
  baseUrl: read('BC_BASE_URL', 'https://businesscentral.dynamics.com').replace(/\/+$/, ''),
  tenant: read('BC_TENANT', ''),
  environment: read('BC_ENVIRONMENT', 'sandbox'),
  company: read('BC_COMPANY', 'CRONUS International Ltd.'),
  processName: read('BAS_PROCESS_NAME', 'Demo: Post sales order'),
  customer: read('BC_CUSTOMER', 'Adatum Corporation'),
  itemNo: read('BC_ITEM_NO', '1896-S'),
  slowMo: Number(read('SLOWMO', '250')) || 0,
};

/**
 * Deep link into the BC web client:
 * `${BC_BASE_URL}/${BC_TENANT?}/${BC_ENVIRONMENT}?company=...&page=<id>`.
 * Note: every full page load starts a NEW Business Central session.
 */
export function bcUrl(pageId?: number): string {
  const segments = [config.baseUrl, config.tenant, config.environment].filter(Boolean);
  const query = `company=${encodeURIComponent(config.company)}`;
  return pageId === undefined
    ? `${segments.join('/')}?${query}`
    : `${segments.join('/')}?${query}&page=${pageId}`;
}
