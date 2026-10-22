/**
 * Headless check for the airfoil selector + thickness slider.
 * - all 8 profiles render, section preview is a real path
 * - thickness slider changes the spec and survives a reload
 * - no console errors
 *
 * Run: node scripts/check-airfoil-ui.cjs
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EXE = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const OUT = '/tmp/airfoilcheck';
fs.mkdirSync(OUT, { recursive: true });
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
  await page.addInitScript(() => {
    try { localStorage.setItem('aerobuilder_welcome_seen', '1'); } catch { /* ignore */ }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const selects = page.locator('aside select');
  const afSelect = selects.first();
  const options = await afSelect.locator('option').evaluateAll(os => os.map(o => o.value));
  const previews = await page.locator('aside svg[aria-label="airfoil section"]').count();

  // Pick NACA 2412 and check the spec lands in localStorage
  await afSelect.selectOption('naca2412');
  await page.waitForTimeout(400);
  const specAfterSelect = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('aerobuilder_state_v2') || '{}');
    return s.airfoil;
  });

  // Thickness slider: last range input in the wing section
  const slider = page.locator('aside input[type="range"]').first();
  await slider.evaluate(el => {
    // React kendi value setter'ını izler → native setter şart
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '15');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  const specAfterSlider = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('aerobuilder_state_v2') || '{}');
    return s.airfoil;
  });

  await page.screenshot({ path: path.join(OUT, 'sidebar.png'), clip: { x: 0, y: 0, width: 340, height: 900 } });

  // Reload: the spec must come back
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const specAfterReload = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('aerobuilder_state_v2') || '{}');
    return s.airfoil;
  });
  const sliderValue = await page.locator('aside input[type="range"]').first().inputValue();

  console.log(JSON.stringify({
    options, previews, specAfterSelect, specAfterSlider, specAfterReload, sliderValue,
    errors, shot: path.join(OUT, 'sidebar.png'),
  }, null, 2));
  await browser.close();
})();
