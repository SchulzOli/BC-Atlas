/**
 * End-to-end: record the process "post a sales order" with the BC Atlas Sync
 * extension, import the matching Page Scripting clicks, build the Fact Snapshot and
 * download all generated documentation. The whole run is recorded as one video.
 *
 * IMPORTANT: the Atlas Sync recorder is bound to the BC session that started it. A full
 * page load (page.goto / reload) creates a new BC session, so after "Start Recording"
 * this test navigates only inside the client (Alt+Q search, opening rows).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import * as bc from '../helpers/bc';
import { ARTIFACTS_DIR, FIXTURES_DIR, STATE_PATH, config } from '../helpers/env';

const PAGE_SETUP = 50150;
const PAGE_RECORDINGS = 50151;
const RECORDINGS_SEARCH = 'Atlas Sync Recordings';
const SALES_ORDERS_SEARCH = 'Sales Orders';
const PAGE_SCRIPT_FIXTURE = path.join(FIXTURES_DIR, 'sales-order-post.yml');
const RECORDING_HERE = /Recording in this session/i;

test.describe.configure({ mode: 'serial' });

test.describe('BC Atlas Sync', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(STATE_PATH)) {
      throw new Error(`No saved sign-in at ${STATE_PATH}. Run "npm run login" first.`);
    }
  });

  test('records "post a sales order" and produces a documented Fact Snapshot', async ({ page }) => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const processName = `${config.processName} ${stamp}`.slice(0, 100);
    let salesOrderNo = '';
    /** Where BC controls live: the "Main Content" iframe (re-resolved after each full page load). */
    let scope: bc.BcScope = page;

    /** A phase that may fail without failing the run - the recorder documents what happened. */
    async function tolerantStep(title: string, body: () => Promise<void>): Promise<void> {
      await test.step(title, async () => {
        try {
          await body();
        } catch (error) {
          bc.warn(`"${title}" did not complete - continuing. ${bc.errorText(error)}`);
          await bc.snap(page, `FAILED: ${title}`);
          await bc.dismissDialogs(scope);
        }
      });
    }

    async function addStepMarker(text: string, title = `Add step marker "${text}"`): Promise<void> {
      await test.step(title, async () => {
        await bc.invokeAction(scope, 'Add Step Marker', { groups: ['Record'] });
        const dialog = (await bc.topDialog(scope)) ?? scope;
        await bc.fillField(dialog, 'Step', text);
        await bc.closeDialog(scope, 'OK');
      });
    }

    /** In-session: Atlas Sync Recordings -> newest recording (first row) -> check it is ours. */
    async function openOurRecording(): Promise<void> {
      await bc.openViaSearch(scope, RECORDINGS_SEARCH);
      await bc.openFirstRow(scope);
      const opened = await bc.readField(scope, 'Process Name');
      expect(opened, 'The newest recording (first row) should be the one this test created').toBe(processName);
      const state = await bc.readField(scope, 'This Session').catch(() => '');
      if (!RECORDING_HERE.test(state)) {
        bc.warn(`"This Session" shows "${state}" - the recording may not be running in this browser session.`);
      }
    }

    // ---------------------------------------------------------------------------------------
    await test.step('1. Atlas Sync Setup: "Recorder Enabled" must be on', async () => {
      scope = await bc.openPage(page, PAGE_SETUP, 'Atlas Sync Setup');
      const enabled = await bc.isFieldChecked(scope, 'Recorder Enabled');
      expect(
        enabled,
        '"Recorder Enabled" is OFF in Atlas Sync Setup (page 50150). Turn it on, then sign out and in again ' +
          '(and re-run "npm run login") - the recorder only arms in sessions started after the change. ' +
          'This test deliberately does not toggle it.',
      ).toBe(true);
    });

    await test.step('2. Create a recording and start it', async () => {
      scope = await bc.openPage(page, PAGE_RECORDINGS, 'Atlas Sync Recordings');
      await bc.invokeAction(scope, 'New');
      await bc.fillField(scope, 'Process Name', processName);
      await bc.fillField(
        scope,
        'Description',
        `Automated Playwright run: create a sales order for ${config.customer} (item ${config.itemNo}) and post it.`,
      );
      bc.note('recording', `${await bc.readField(scope, 'No.').catch(() => '?')} - ${processName}`);

      await bc.invokeAction(scope, 'Start Recording', { groups: ['Record'] });
      await bc.closeDialog(scope, 'OK');
      await expect
        .poll(() => bc.readField(scope, 'This Session').catch(() => ''), {
          message: '"This Session" should report that this session is recording',
          timeout: 15_000,
        })
        .toMatch(RECORDING_HERE);
      await bc.snap(page, 'recording started');
    });

    await addStepMarker('Create the sales order', '3. Add step marker "Create the sales order"');

    await test.step('4. Process: create a sales order (same browser session)', async () => {
      await bc.openViaSearch(scope, SALES_ORDERS_SEARCH);
      await bc.invokeAction(scope, 'New', { groups: ['Home'] });
      await bc.fillField(scope, 'Customer Name', config.customer);
      try {
        await bc.fillLine(scope, 'Type', 'Item');
      } catch (error) {
        bc.warn(`Line "Type" not set (it usually defaults to Item): ${bc.errorText(error)}`);
      }
      await bc.fillLine(scope, 'No.', config.itemNo);
      await bc.fillLine(scope, 'Quantity', '1');
      salesOrderNo = await bc.readDocumentNo(scope, config.itemNo);
      if (salesOrderNo) bc.note('sales order', salesOrderNo);
      else bc.warn('Could not read the sales order number from the card.');
      await bc.snap(page, 'sales order with line');
    });

    await tolerantStep('5. Process: post the sales order (Ship and Invoice)', async () => {
      await openOurRecording();
      await addStepMarker('Post the order');

      await bc.openViaSearch(scope, SALES_ORDERS_SEARCH);
      if (salesOrderNo) await bc.searchList(scope, salesOrderNo);
      await bc.openFirstRow(scope);
      if (salesOrderNo) {
        const opened = await bc.readDocumentNo(scope, config.itemNo);
        if (opened !== salesOrderNo) {
          throw new Error(`Opened order "${opened}" instead of "${salesOrderNo}" - not posting it.`);
        }
      }

      try {
        await bc.invokeAction(scope, /^Post(\.\.\.|…)?$/, { groups: ['Posting', 'Home', 'Actions'] });
      } catch {
        bc.log('"Post..." not found in the action bar - using its shortcut F9.');
        await page.keyboard.press('F9');
      }
      await bc.chooseOption(scope, 'Ship and Invoice');
      await bc.closeDialog(scope, 'OK');
      const question = await bc.closeDialog(scope, 'No', { timeout: 180_000 });
      if (question) bc.note('posting', question);
    });

    await test.step('6. Stop the recording', async () => {
      await openOurRecording();
      await bc.invokeAction(scope, 'Stop Recording', { groups: ['Record'] });
      await expect
        .poll(() => bc.readField(scope, 'This Session').catch(() => ''), {
          message: '"This Session" should no longer report a running recording',
          timeout: 30_000,
        })
        .not.toMatch(RECORDING_HERE);
      bc.note('events', await bc.readField(scope, 'Event Count').catch(() => '?'));
    });

    await test.step('7. Import the clicks (Page Scripting recording)', async () => {
      // Attach the listener first: the upload dialog may open the file chooser immediately.
      const chooser = page.waitForEvent('filechooser', { timeout: 60_000 }).catch(() => null);
      await bc.invokeAction(scope, 'Import Clicks (Page Script)', { groups: ['Record'] });
      await bc.closeDialog(scope, 'Yes', { timeout: 3_000, optional: true }); // "Replace the UI steps?"

      const choose = await bc.findVisible(
        [scope.getByRole('button', { name: /^Choose/i }), scope.getByRole('link', { name: /^Choose/i })],
        10_000,
      );
      if (choose) await choose.click();
      const fileChooser = await chooser;
      if (fileChooser) {
        await fileChooser.setFiles(PAGE_SCRIPT_FIXTURE);
      } else {
        bc.log('No file chooser event - setting the hidden file input directly.');
        await scope.locator('input[type="file"]').first().setInputFiles(PAGE_SCRIPT_FIXTURE);
      }
      await bc.waitForBcIdle(page, 1_500);
      const message = await bc.closeDialog(scope, 'OK', { timeout: 60_000 });
      expect(message ?? '', 'BC should confirm the import').toMatch(/UI steps imported/i);
      bc.note('page script', message ?? '');
    });

    await test.step('8. Create the Fact Snapshot and download all documentation', async () => {
      await bc.invokeAction(scope, 'Create Snapshot', { groups: ['Document'] });
      // Building the snapshot and generating all documents can take a while.
      await expect(
        scope.getByText('Fingerprint', { exact: true }).first(),
        'The Atlas Sync Fact Snapshot card (page 50156) should open',
      ).toBeVisible({ timeout: 180_000 });
      await bc.waitForBcIdle(page, 1_500);
      await bc.snap(page, 'Atlas Sync Fact Snapshot');

      const fingerprint = await bc.readField(scope, 'Fingerprint');
      expect(fingerprint, 'The snapshot should have a fingerprint').not.toBe('');
      bc.note('fingerprint', fingerprint);
      const drift = await bc.isFieldChecked(scope, 'Drift Detected', 5_000).catch(() => null);
      bc.note('drift detected', String(drift));

      const download = page.waitForEvent('download', { timeout: 180_000 });
      await bc.invokeAction(scope, 'Download All (ZIP)', { groups: ['Process', 'Actions'] });
      const zip = await download;
      const fileName = (zip.suggestedFilename() || 'atlas-sync-documentation.zip').replace(/[<>:"/\\|?*]+/g, '_');
      const target = path.join(ARTIFACTS_DIR, fileName);
      await zip.saveAs(target);
      await test.info().attach(fileName, { path: target, contentType: 'application/zip' });
      bc.note('zip', target);
      await bc.snap(page, 'done');
    });
  });
});
