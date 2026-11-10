/**
 * npm run login
 *
 * Opens a HEADED browser at the BC web client and waits (up to 5 minutes) until you have
 * signed in manually and the client has loaded. Then saves the browser storage state
 * (cookies, local storage) to .auth/state.json, which the tests reuse.
 * No credentials are read, typed or stored by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { isBcClientLoaded, isLoginUrl } from '../helpers/bc';
import { STATE_PATH, bcUrl } from '../helpers/env';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    const url = bcUrl();

    console.log(`Opening ${url}`);
    console.log('Sign in in the browser window. Waiting up to 5 minutes for the Business Central client...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    let loaded = false;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error('The browser window was closed before sign-in completed.');
      if (!isLoginUrl(page.url()) && (await isBcClientLoaded(page).catch(() => false))) {
        loaded = true;
        break;
      }
      await page.waitForTimeout(POLL_MS);
    }
    if (!loaded) throw new Error('Timed out after 5 minutes waiting for the Business Central client.');

    // Give BC a moment to finish writing its session cookies.
    await page.waitForTimeout(5_000);
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    await context.storageState({ path: STATE_PATH });
    console.log(`Signed in. Storage state saved to ${STATE_PATH}`);
    console.log('Keep this file private - it contains your session cookies.');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
