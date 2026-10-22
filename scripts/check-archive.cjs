/**
 * Headless check for the new STL archive + viewer.
 *   1. archive dialog opens (empty state)
 *   2. exporting to the archive stores a set in IndexedDB
 *   3. the gallery lists it with a thumbnail and metadata
 *   4. the viewer renders the set on a WebGL canvas
 *   5. no console errors anywhere
 */
const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const URL = 'http://127.0.0.1:1932/';

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', async d => { await d.accept('Headless Test Set'); });

  const step = (m) => console.log('· ' + m);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('aerobuilder_welcome_seen', '1');
      localStorage.setItem('aerobuilder_consent', 'denied'); // keep the consent banner out of the way
      localStorage.setItem('aerobuilder_consent_at', new Date().toISOString());
    } catch { /* ignore */ }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('header');
  step('app loaded');

  const exportBtn = page.getByRole('button', { name: /Export|Dışa aktar/i }).first();
  const openExport = async () => {
    await exportBtn.click();
    await page.waitForTimeout(200);
  };

  // 0. Export menüsünde arşiv/görüntüleyici OLMAMALI; header'da bağımsız butonlar olmalı
  await openExport();
  const menuText = await page.getByRole('menu').first().innerText();
  const menuHasArchive = /STL arşivi|STL archive/i.test(menuText);
  const menuHasViewer = /STL görüntüleyici|STL viewer/i.test(menuText);
  step(`export menu items: ${menuText.replace(/\n+/g, ' | ')}`);
  if (menuHasArchive || menuHasViewer) throw new Error('export menüsünde hâlâ arşiv/görüntüleyici var');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Viewer butonu dialogu doğrudan açmalı
  await page.getByRole('button', { name: /STL viewer|STL görüntüleyici/i }).first().click();
  await page.waitForSelector('#stl-viewer-title', { timeout: 5000 });
  step('viewer opened from header button');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 1. Archive dialog, empty state — artık header'daki bağımsız buton
  await page.getByRole('button', { name: /STL archive|STL arşivi/i }).first().click();
  await page.waitForSelector('#archive-title', { timeout: 5000 });
  await page.waitForTimeout(500);
  const emptyVisible = await page.locator('#archive-title').isVisible();
  const emptyText = await page.locator('#archive-title').locator('..').locator('..').innerText();
  step(`archive dialog open=${emptyVisible}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 2. Save a set from the export dialog
  await openExport();
  await page.getByRole('menuitem', { name: /3D baskı için STL|Export STL for 3D printing/i }).first().click();
  await page.waitForSelector('#stl-title', { timeout: 5000 });
  const saveBtn = page.getByRole('button', { name: /Save to archive|Arşive kaydet/i });
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
  // wait until the plan is computed (button enabled)
  for (let i = 0; i < 60; i++) {
    if (await saveBtn.isEnabled()) break;
    await page.waitForTimeout(500);
  }
  const planText = await page.locator('#stl-title').locator('..').locator('..').innerText();
  step('plan computed: ' + (planText.match(/\d+ parts? to print|\d+ parça/) || ['no part count'])[0]);
  await saveBtn.click();
  await page.waitForTimeout(6000); // thumbnail render + IDB write

  const dbCount = await page.evaluate(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('aerobuilder_archive');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sets', 'readonly');
        const all = tx.objectStore('sets').getAll();
        all.onsuccess = () => resolve({
          sets: all.result.map(s => ({ name: s.name, parts: s.meta.parts, bytes: s.meta.bytes, thumb: !!s.thumb })),
        });
        all.onerror = () => resolve({ error: String(all.error) });
      };
      req.onerror = () => resolve({ error: String(req.error) });
    });
  });
  step('indexedDB → ' + JSON.stringify(dbCount));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3. Gallery
  await page.getByRole('button', { name: /STL archive|STL arşivi/i }).first().click();
  await page.waitForSelector('#archive-title', { timeout: 5000 });
  await page.waitForTimeout(800);
  const cards = await page.locator('#archive-title >> xpath=../..//li').count();
  const thumbs = await page.locator('#archive-title >> xpath=../..//img').count();
  const cardText = await page.locator('#archive-title >> xpath=../..//li').first().innerText().catch(() => '');
  step(`gallery cards=${cards} thumbs=${thumbs}`);
  step('card: ' + cardText.replace(/\n+/g, ' | '));
  await page.screenshot({ path: '/tmp/archive-gallery.png' });

  // 4. Viewer
  const viewBtn = page.locator('#archive-title >> xpath=../..//li').first().locator('button[title="View"], button[title="Görüntüle"]').first();
  await viewBtn.click();
  await page.waitForSelector('#stl-viewer-title', { timeout: 5000 });
  await page.waitForTimeout(3500);
  const hasCanvas = await page.locator('#stl-viewer-title >> xpath=../../..//canvas').count();
  const viewerText = await page.locator('#stl-viewer-title >> xpath=../../..').innerText();
  const tris = (viewerText.match(/[\d.,]+\s*(triangles|üçgen)/) || ['no triangle count'])[0];
  const size = (viewerText.match(/[\d.]+\s*×\s*[\d.]+\s*×\s*[\d.]+\s*mm/) || ['no size'])[0];
  step(`viewer canvas=${hasCanvas} tris=${tris} size=${size}`);
  await page.screenshot({ path: '/tmp/archive-viewer.png' });

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 6), null, 1) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
