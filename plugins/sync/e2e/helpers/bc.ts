/**
 * Defensive helpers for driving the Business Central web client with Playwright.
 *
 * The BC client is a single-page app; its UI lives in an iframe titled "Main Content".
 * Every FULL page load (page.goto / reload) starts a NEW BC server session, so once a
 * session-bound process is running (e.g. an Atlas Sync recording) navigate only in-client
 * with {@link openViaSearch}, never with page.goto.
 *
 * Every helper logs what it does, runs as a (boxed) test.step and attaches a screenshot,
 * so the HTML report reads like a step-by-step guide.
 *
 * Grid helpers (openFirstRow, fillLine) use `filter({ has })`, which needs a Page or FrameLocator
 * scope (a chained Locator scope would make the inner locator relative to the wrong element).
 */
import { test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { bcUrl, config } from './env';

/** Anything we can query BC controls in: the page, the client iframe, or a dialog/part locator. */
export type BcScope = Page | FrameLocator | Locator;

const MAIN_FRAME = 'iframe[title="Main Content"]';
const LOGIN_HOST = /(^|\.)(login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|login\.microsoft\.com)$/i;
const BUSY_TEXT = /Working on it/i;
/** Action-bar menus that can hide an action, tried in this order after the caller's hints. */
const OVERFLOW_MENUS = ['More options', 'Actions', 'Process', 'Home', 'Related'];
const POLL_MS = 250;

let screenshotNo = 0;

// ---------------------------------------------------------------------------------------------
// Logging, steps, screenshots
// ---------------------------------------------------------------------------------------------

export function log(message: string): void {
  console.log(`[bc ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function inTest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}

/** Runs `body` as a boxed test.step (or plainly outside the test runner) and logs the title. */
export async function bcStep<T>(title: string, body: () => Promise<T>): Promise<T> {
  log(title);
  return inTest() ? test.step(title, body, { box: true }) : body();
}

/** Attaches a numbered screenshot of the whole browser page to the current test. */
export async function snap(page: Page, label: string): Promise<void> {
  if (!inTest() || page.isClosed()) return;
  const body = await page.screenshot().catch(() => undefined);
  if (!body) return;
  screenshotNo += 1;
  await test.info().attach(`${String(screenshotNo).padStart(2, '0')} - ${label}`, {
    body,
    contentType: 'image/png',
  });
}

/** Records a non-fatal problem as a report annotation (shown at the top of the HTML report). */
export function warn(message: string): void {
  log(`WARNING: ${message}`);
  if (inTest()) test.info().annotations.push({ type: 'warning', description: message });
}

/** Records an informational fact (fingerprint, numbers, ...) as a report annotation. */
export function note(type: string, description: string): void {
  log(`${type}: ${description}`);
  if (inTest()) test.info().annotations.push({ type, description });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

// ---------------------------------------------------------------------------------------------
// Frame, page, idle
// ---------------------------------------------------------------------------------------------

export function pageOf(scope: BcScope): Page {
  if ('owner' in scope) return scope.owner().page(); // FrameLocator
  if ('contentFrame' in scope) return scope.page(); // Locator
  return scope; // Page
}

/** The BC client iframe ("Main Content"), or the page itself when the client is not framed. */
export async function bcFrame(page: Page, timeout = 20_000): Promise<BcScope> {
  const iframe = page.locator(MAIN_FRAME).first();
  try {
    await iframe.waitFor({ state: 'attached', timeout });
    return iframe.contentFrame();
  } catch {
    log(`No ${MAIN_FRAME} found - using the page itself as BC client scope.`);
    return page;
  }
}

/** Waits until BC looks idle: network quiet-ish, no "Working on it..." overlay, short settle. */
export async function waitForBcIdle(page: Page, settleMs = 750): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  // BC keeps a websocket open, so "networkidle" may never fire - cap it.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  for (const scope of [page, page.locator(MAIN_FRAME).first().contentFrame()]) {
    await scope
      .getByText(BUSY_TEXT)
      .first()
      .waitFor({ state: 'hidden', timeout: 120_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(settleMs);
}

export function isLoginUrl(url: string): boolean {
  try {
    return LOGIN_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Fails fast with a helpful message when the saved sign-in has expired. */
export function assertSignedIn(page: Page): void {
  if (isLoginUrl(page.url())) {
    throw new Error(
      `Redirected to the Microsoft sign-in page (${new URL(page.url()).hostname}). ` +
        'The saved sign-in is missing or expired - run "npm run login" again.',
    );
  }
}

/** True once the browser is on the BC host and the web client has rendered. */
export async function isBcClientLoaded(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  let onBcHost = false;
  try {
    onBcHost = new URL(page.url()).host === new URL(config.baseUrl).host;
  } catch {
    return false;
  }
  if (!onBcHost) return false;
  if ((await page.locator(MAIN_FRAME).count()) > 0) return true;
  const title = await page.title().catch(() => '');
  return /Business Central/i.test(title) && (await page.getByRole('button').count()) > 3;
}

/**
 * Full page load of a BC page by object id. Starts a NEW BC session - use it only before a
 * session-bound process starts. Returns the client scope to query controls in.
 */
export async function openPage(page: Page, pageId: number, expectedCaption?: string): Promise<BcScope> {
  return bcStep(`Open page ${pageId}${expectedCaption ? ` "${expectedCaption}"` : ''} (new session)`, async () => {
    await page.goto(bcUrl(pageId), { waitUntil: 'domcontentloaded' });
    assertSignedIn(page);
    const scope = await bcFrame(page);
    if (expectedCaption) {
      const caption = scope.getByText(expectedCaption, { exact: true }).first();
      await caption.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {
        assertSignedIn(page);
        warn(`Page ${pageId}: caption "${expectedCaption}" not seen after 90 s - continuing.`);
      });
    }
    await waitForBcIdle(page);
    await snap(page, `page ${pageId} opened`);
    return scope;
  });
}

// ---------------------------------------------------------------------------------------------
// Locating controls
// ---------------------------------------------------------------------------------------------

type Name = string | RegExp;

function byName(name: Name): { name: Name; exact?: boolean } {
  return typeof name === 'string' ? { name, exact: true } : { name };
}

/**
 * Polls the candidate locators (in order) until one of them resolves to a visible element.
 * `preferLast` picks the last visible match per candidate (topmost dialog).
 */
export async function findVisible(
  candidates: Locator[],
  timeout: number,
  { preferLast = false }: { preferLast?: boolean } = {},
): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const candidate of candidates) {
      const elements = await candidate.all().catch(() => [] as Locator[]);
      if (preferLast) elements.reverse();
      for (const element of elements) {
        if (await element.isVisible().catch(() => false)) return element;
      }
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function actionCandidates(scope: BcScope, caption: Name): Locator[] {
  return [scope.getByRole('menuitem', byName(caption)), scope.getByRole('button', byName(caption))];
}

function fieldCandidates(scope: BcScope, caption: Name): Locator[] {
  const options = byName(caption);
  return [
    scope.getByRole('textbox', options),
    scope.getByRole('combobox', options),
    scope.getByRole('spinbutton', options),
    typeof caption === 'string' ? scope.getByLabel(caption, { exact: true }) : scope.getByLabel(caption),
  ];
}

async function closeOpenMenu(scope: BcScope): Promise<void> {
  const menu = await findVisible([scope.getByRole('menu')], 0);
  if (menu) await pageOf(scope).keyboard.press('Escape'); // Escape without a menu would close the page
}

export interface ActionOptions {
  /** Action-bar groups that may contain the action (e.g. "Posting", "Record"); tried first. */
  groups?: string[];
  /** How long to wait for a directly visible action before opening menus. */
  timeout?: number;
}

/** Finds an action-bar action by caption, opening hint groups and the overflow menus as needed. */
export async function findAction(
  scope: BcScope,
  caption: Name,
  { groups = [], timeout = 5_000 }: ActionOptions = {},
): Promise<Locator | null> {
  const direct = await findVisible(actionCandidates(scope, caption), timeout);
  if (direct) return direct;
  for (const group of [...groups, ...OVERFLOW_MENUS]) {
    const opener = await findVisible(
      [scope.getByRole('button', { name: group, exact: true }), scope.getByRole('menuitem', { name: group, exact: true })],
      0,
    );
    if (!opener) continue;
    log(`  "${String(caption)}" not visible - opening "${group}"`);
    await opener.click();
    const found = await findVisible(actionCandidates(scope, caption), 2_000);
    if (found) return found;
    await closeOpenMenu(scope);
  }
  return null;
}

/** Clicks an action-bar action (menuitem or button) by its caption. */
export async function invokeAction(scope: BcScope, caption: Name, options: ActionOptions = {}): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Invoke action "${String(caption)}"`, async () => {
    const action = await findAction(scope, caption, options);
    if (!action) {
      await snap(page, `action "${String(caption)}" not found`);
      throw new Error(
        `Action "${String(caption)}" not found (tried menuitem/button and menus ${[...(options.groups ?? []), ...OVERFLOW_MENUS].join(', ')}). ` +
          'Is the BC client language English?',
      );
    }
    await action.click();
    await waitForBcIdle(page);
    await snap(page, `after "${String(caption)}"`);
  });
}

async function setValue(input: Locator, value: string): Promise<void> {
  const tag = await input.evaluate((element) => element.tagName).catch(() => '');
  if (tag === 'SELECT') {
    await input.selectOption({ label: value });
    return;
  }
  await input.click();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (await input.isEditable().catch(() => false))) {
    await input.fill(value);
  } else {
    await pageOf(input).keyboard.type(value);
  }
}

/** Types `value` into the field with caption `caption` and presses Tab to validate it. */
export async function fillField(scope: BcScope, caption: string, value: string, timeout = 20_000): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Set field "${caption}" = "${value}"`, async () => {
    const input = await findVisible(fieldCandidates(scope, caption), timeout);
    if (!input) throw new Error(`Field "${caption}" not found or not visible.`);
    await setValue(input, value);
    await input.press('Tab').catch(() => page.keyboard.press('Tab'));
    await waitForBcIdle(page);
    await snap(page, `"${caption}" = ${value}`);
  });
}

function xpathLiteral(text: string): string {
  return text.includes('"') ? `'${text}'` : `"${text}"`;
}

/** Reads the displayed value of a field (editable input or read-only text). */
export async function readField(scope: BcScope, caption: string, timeout = 15_000): Promise<string> {
  const input = await findVisible(fieldCandidates(scope, caption), timeout);
  if (input) {
    const value = await input.inputValue().catch(() => null);
    return (value ?? (await input.innerText().catch(() => ''))).trim();
  }
  // Read-only fields can render as caption element + value element.
  const valueAfterCaption = scope.locator(
    `xpath=//*[normalize-space(text())=${xpathLiteral(caption)}]/following::*[normalize-space(.)!=''][1]`,
  );
  const element = await findVisible([valueAfterCaption], 2_000);
  if (!element) throw new Error(`Field "${caption}" not found.`);
  return (await element.innerText()).trim();
}

/** State of a Boolean field (toggle). Returns null when it cannot be determined. */
export async function isFieldChecked(scope: BcScope, caption: string, timeout = 20_000): Promise<boolean | null> {
  const toggle = await findVisible(
    [
      scope.getByRole('checkbox', { name: caption, exact: true }),
      scope.getByRole('switch', { name: caption, exact: true }),
    ],
    timeout,
  );
  if (toggle) return toggle.isChecked();
  const text = await readField(scope, caption, 2_000).catch(() => '');
  if (/^(yes|true|on)$/i.test(text)) return true;
  if (/^(no|false|off)$/i.test(text)) return false;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

/** The topmost visible dialog, or null. */
export async function topDialog(scope: BcScope, timeout = 10_000): Promise<Locator | null> {
  return findVisible([scope.getByRole('dialog'), scope.getByRole('alertdialog')], timeout, { preferLast: true });
}

/**
 * Answers a BC message box / confirm / dialog page by clicking `buttonName` ("OK", "Yes", "No").
 * Returns the dialog text, or null when `optional` and no such dialog appeared.
 */
export async function closeDialog(
  scope: BcScope,
  buttonName: string,
  { timeout = 20_000, optional = false }: { timeout?: number; optional?: boolean } = {},
): Promise<string | null> {
  const page = pageOf(scope);
  return bcStep(`Dialog: choose "${buttonName}"${optional ? ' (if shown)' : ''}`, async () => {
    const options = { name: buttonName, exact: true };
    const button = await findVisible(
      [
        scope.getByRole('dialog').getByRole('button', options),
        scope.getByRole('alertdialog').getByRole('button', options),
        scope.getByRole('button', options),
      ],
      timeout,
      { preferLast: true },
    );
    if (!button) {
      if (optional) return null;
      await snap(page, `no "${buttonName}" dialog`);
      throw new Error(`No dialog with a "${buttonName}" button appeared within ${timeout / 1000} s.`);
    }
    const dialog = button.locator('xpath=ancestor::*[@role="dialog" or @role="alertdialog"][1]');
    const text = ((await dialog.innerText({ timeout: 1_000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (text) log(`  dialog says: ${text.slice(0, 300)}`);
    await snap(page, `dialog before "${buttonName}"`);
    await button.click();
    await waitForBcIdle(page);
    return text;
  });
}

/** Selects an option in a BC option dialog (StrMenu), e.g. "Ship and Invoice". */
export async function chooseOption(scope: BcScope, caption: string): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Choose option "${caption}"`, async () => {
    const option = await findVisible(
      [
        scope.getByRole('radio', { name: caption, exact: true }),
        scope.getByRole('option', { name: caption, exact: true }),
        scope.getByRole('dialog').getByText(caption, { exact: true }),
      ],
      20_000,
      { preferLast: true },
    );
    if (!option) throw new Error(`Option "${caption}" not found in the dialog.`);
    await option.click();
    await snap(page, `option "${caption}" selected`);
  });
}

/** Best effort: closes any dialogs left open after a failure so the run can continue. */
export async function dismissDialogs(scope: BcScope, maxDialogs = 3): Promise<void> {
  for (let i = 0; i < maxDialogs; i += 1) {
    const dialog = await topDialog(scope, 1_000);
    if (!dialog) return;
    const button = await findVisible(
      ['Cancel', 'Close', 'No', 'OK'].map((name) => dialog.getByRole('button', { name, exact: true })),
      500,
    );
    if (!button) return;
    log(`  dismissing leftover dialog with "${(await button.innerText().catch(() => '?')).trim()}"`);
    await button.click();
    await waitForBcIdle(pageOf(scope));
  }
}

// ---------------------------------------------------------------------------------------------
// In-session navigation, lists and lines
// ---------------------------------------------------------------------------------------------

/**
 * Opens a page through the BC search ("Tell me", Alt+Q) - stays in the SAME BC session,
 * unlike page.goto.
 */
export async function openViaSearch(scope: BcScope, query: string): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Search (Alt+Q) and open "${query}"`, async () => {
    // After Alt+Q the search box has the focus.
    const focusedInput = (timeout: number) =>
      findVisible([scope.locator('input:focus, textarea:focus'), page.locator('input:focus, textarea:focus')], timeout);
    await page.keyboard.press('Alt+Q');
    let box = await focusedInput(3_000);
    if (!box) {
      const searchName = /^(Tell me|Search \(Alt\+Q\))/i;
      const button = await findVisible(
        [scope.getByRole('button', { name: searchName }), page.getByRole('button', { name: searchName })],
        3_000,
      );
      if (!button) throw new Error('Could not open the BC search ("Tell me", Alt+Q).');
      await button.click();
      box = await focusedInput(5_000);
    }
    if (!box) throw new Error('The BC search box did not receive the focus.');
    await box.fill(query);
    await waitForBcIdle(page, 1_500);
    await snap(page, `search results for "${query}"`);

    const container: BcScope = (await topDialog(scope, 1_000)) ?? scope;
    const startsWith = new RegExp(`^${escapeRegExp(query)}\\b`);
    const result = await findVisible(
      [
        container.getByRole('link', { name: query, exact: true }),
        container.getByRole('option', { name: query, exact: true }),
        container.getByRole('button', { name: query, exact: true }),
        container.getByRole('link', { name: startsWith }),
        container.getByRole('option', { name: startsWith }),
      ],
      10_000,
    );
    if (result) await result.click();
    else await page.keyboard.press('Enter'); // first result is highlighted
    await waitForBcIdle(page, 1_500);
    await snap(page, `"${query}" opened`);
  });
}

/** Uses the list page's own search box to narrow the rows. */
export async function searchList(scope: BcScope, text: string): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Search list for "${text}"`, async () => {
    const button = await findVisible([scope.getByRole('button', { name: 'Search', exact: true })], 10_000);
    if (!button) throw new Error('List "Search" button not found.');
    await button.click();
    const box = await findVisible([scope.getByRole('searchbox'), scope.getByPlaceholder('Search')], 3_000);
    if (box) await box.fill(text);
    else await page.keyboard.type(text);
    await waitForBcIdle(page, 1_500);
    await snap(page, `list filtered by "${text}"`);
  });
}

/** Opens the record of the first data row of the (first visible) list. */
export async function openFirstRow(scope: BcScope): Promise<void> {
  const page = pageOf(scope);
  await bcStep('Open the first row of the list', async () => {
    const row = await findVisible([scope.getByRole('row').filter({ has: scope.getByRole('gridcell') })], 30_000);
    if (!row) throw new Error('No data row found in the list.');
    const link = await findVisible([row.getByRole('link'), row.locator('a[href], a[tabindex]')], 1_000);
    if (link) {
      await link.click();
    } else {
      // No drill-down link: select the row, then use View/Edit or Enter.
      await row.getByRole('gridcell').nth(1).click();
      const view = await findAction(scope, /^(View|Edit)$/, { timeout: 1_000 });
      if (view) await view.click();
      else await page.keyboard.press('Enter');
    }
    await waitForBcIdle(page, 1_500);
    await snap(page, 'first row opened');
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The grid (repeater) that has a column header `column`, preferably inside part `part`. */
async function findLinesGrid(scope: BcScope, column: string, part: string): Promise<Locator | null> {
  const header = scope.getByRole('columnheader', { name: column, exact: true });
  return findVisible(
    [
      scope.getByRole('region', { name: part }).getByRole('grid').filter({ has: header }),
      scope.getByRole('grid').filter({ has: header }),
    ],
    20_000,
  );
}

/**
 * Sets `column` = `value` in the first editable row of a lines part (repeater inside a part,
 * e.g. the "Lines" of a sales order) and presses Tab.
 */
export async function fillLine(
  scope: BcScope,
  column: string,
  value: string,
  { part = 'Lines' }: { part?: string } = {},
): Promise<void> {
  const page = pageOf(scope);
  await bcStep(`Line: set "${column}" = "${value}"`, async () => {
    const grid = await findLinesGrid(scope, column, part);
    if (!grid) throw new Error(`No lines grid with a "${column}" column found.`);

    // 1) Cell editors usually carry the column caption as accessible name.
    let editor: Locator | null = null;
    for (const role of ['combobox', 'textbox', 'spinbutton'] as const) {
      for (const candidate of await grid.getByRole(role, { name: column, exact: true }).all()) {
        if ((await candidate.isVisible().catch(() => false)) && (await candidate.isEditable().catch(() => false))) {
          editor = candidate;
          break;
        }
      }
      if (editor) break;
    }

    // 2) Fallback: map the column header index to the cell of the first data row.
    if (!editor) {
      const headerRow = grid.getByRole('row').filter({ has: scope.getByRole('columnheader') }).first();
      const headers = (await headerRow.locator(':scope > *').allInnerTexts()).map(normalize);
      let index = headers.indexOf(column);
      if (index < 0) index = headers.findIndex((header) => header.startsWith(column));
      if (index < 0) throw new Error(`Column "${column}" not found. Headers: ${headers.join(' | ')}`);
      const firstRow = grid.getByRole('row').filter({ has: scope.getByRole('gridcell') }).first();
      const cell = firstRow.locator(':scope > *').nth(index);
      await cell.click();
      const inner = cell.locator('input, textarea, select').first();
      editor = (await inner.count()) > 0 ? inner : cell;
    }

    await setValue(editor, value);
    await page.keyboard.press('Tab');
    await waitForBcIdle(page);
    await snap(page, `line "${column}" = ${value}`);
  });
}

/**
 * The document number of the open card, taken from the caption ("S-ORD101005 ∙ Adatum ...")
 * or, failing that, from the "No." field. Returns '' when unknown.
 */
export async function readDocumentNo(scope: BcScope, notEqualTo?: string): Promise<string> {
  const page = pageOf(scope);
  const texts: string[] = [];
  for (const heading of await scope.getByRole('heading').all()) {
    if (await heading.isVisible().catch(() => false)) texts.push(await heading.innerText().catch(() => ''));
  }
  texts.push(await page.title().catch(() => ''));
  for (const text of texts) {
    const match = /(\S*\d\S*)\s*[∙·•]\s*\S/.exec(text);
    if (match && match[1] !== notEqualTo) return match[1];
  }
  const fieldValue = await readField(scope, 'No.', 3_000).catch(() => '');
  return fieldValue && fieldValue !== notEqualTo ? fieldValue : '';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
