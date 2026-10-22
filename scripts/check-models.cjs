/**
 * Headless check for the design library ("Modellerim").
 *  1. first run migrates the existing design into a model ("Model 1") with a thumbnail
 *  2. editing marks the model dirty (header dot)
 *  3. "save as new" creates a second named model; the header shows its name
 *  4. loading the first model restores its snapshot
 *  5. overwriting keeps a version history entry, and restoring it works
 *  6. the active model survives a reload
 *  7. no console errors
 */
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const URL = 'http://127.0.0.1:1932/';

const modelsBtn = 'header button[title="Modellerim"], header button[title="My models"]';
const inDialog = '#models-title';

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  const answers = [];
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept(answers.shift() ?? d.defaultValue());
    else await d.accept();
  });

  const step = (m) => console.log('· ' + m);
  const idb = () => page.evaluate(async () => await new Promise((resolve) => {
    const req = indexedDB.open('aerobuilder_archive');
    req.onsuccess = () => {
      const db = req.result;
      const all = db.transaction('models', 'readonly').objectStore('models').getAll();
      all.onsuccess = () => resolve(all.result.map(m => ({
        name: m.name, history: (m.history || []).length, thumb: !!m.thumb,
        stations: (m.snapshot?.dimensions?.fuseStations || []).length,
        turns: m.snapshot?.controls?.aileronStart ?? null,
      })));
      all.onerror = () => resolve('ERR ' + all.error);
    };
    req.onerror = () => resolve('ERR ' + req.error);
  }));

  await page.addInitScript(() => {
    try {
      localStorage.setItem('aerobuilder_welcome_seen', '1');
      localStorage.setItem('aerobuilder_consent', 'denied');
      localStorage.setItem('aerobuilder_consent_at', new Date().toISOString());
    } catch { /* ignore */ }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('header');
  await page.waitForTimeout(3000); // migration + thumbnail
  step('models after first run: ' + JSON.stringify(await idb()));
  step('header: ' + (await page.locator(modelsBtn).innerText()).replace(/\n/g, ' '));

  const dirtyDot = 'header span[title="Kaydedilmemiş değişiklik"], header span[title="Unsaved changes"]';
  step('dirty before edit: ' + await page.locator(dirtyDot).count());

  // 2. Edit the design → dirty
  await page.getByRole('radio', { name: /Uçan kanat|Flying wing/i }).click();
  await page.waitForTimeout(900);
  step('dirty after edit: ' + await page.locator(dirtyDot).count());

  // 3. Save as a new model
  await page.locator(modelsBtn).click();
  await page.waitForSelector(inDialog, { timeout: 5000 });
  await page.waitForTimeout(600);
  answers.push('Geniş Gövde');
  await page.getByRole('button', { name: /Yeni model olarak kaydet|Save as new model/i }).click();
  await page.waitForTimeout(2500);
  step('models after save-as-new: ' + JSON.stringify(await idb()));
  step('dirty after save: ' + await page.locator(dirtyDot).count());

  // 4. Load the first model again
  const card = (name) => page.locator(`${inDialog} >> xpath=../..//li`).filter({ hasText: name }).first();
  await card('Model 1').locator('button[title="Yükle"], button[title="Load"]').first().click();
  await page.waitForTimeout(1200);
  step('header after load: ' + (await page.locator(modelsBtn).innerText()).replace(/\n/g, ' '));
  step('dirty after load: ' + await page.locator(dirtyDot).count());

  // 5. Overwrite the model → one history entry, then restore it
  await page.getByRole('radio', { name: /Klasik|Conventional/i }).first().click();
  await page.waitForTimeout(700);
  await page.locator(modelsBtn).click();
  await page.waitForSelector(inDialog, { timeout: 5000 });
  await page.waitForTimeout(400);
  answers.push('Model 1');
  await page.getByRole('button', { name: /^Modeli kaydet$|^Save model$/i }).click();
  await page.waitForTimeout(2500);
  step('models after overwrite: ' + JSON.stringify(await idb()));
  await card('Model 1').locator('button[title="Sürümler"], button[title="Versions"]').first().click();
  await page.waitForTimeout(400);
  const versionsText = await card('Model 1').innerText();
  step('versions panel: ' + versionsText.split('\n').filter(l => /Ger|Restore/.test(l)).join(' / '));
  await card('Model 1').getByRole('button', { name: /Geri yükle|Restore/i }).first().click();
  await page.waitForTimeout(2000);
  step('models after restore: ' + JSON.stringify(await idb()));

  // 6. Reload → active model survives
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  step('header after reload: ' + (await page.locator(modelsBtn).innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: '/tmp/models-library.png' });

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 6), null, 1) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
