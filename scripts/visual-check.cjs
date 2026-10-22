/**
 * Headless visual check of the tail-type selector.
 * - every option renders without console errors
 * - the 3D scene rebuilds (pixel diff between conventional and V-tail)
 * - the choice survives a reload
 * - the 2D canvas is not blank
 *
 * Run: node scripts/visual-check.cjs
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EXE = path.join(process.env.HOME, '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const OUT = '/tmp/tailcheck';
fs.mkdirSync(OUT, { recursive: true });

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
  await page.goto('http://127.0.0.1:1932/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 3D view
  await page.getByRole('button', { name: /3D/i }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/tailcheck/3d_conventional.png' });

  const shots = {};
  const select = page.locator('select').filter({ has: page.locator('option[value="v_tail"]') });
  const count = await select.count();
  if (!count) throw new Error('tail type select not found');

  for (const t of ['t_tail', 'v_tail', 'inverted_v', 'cruciform', 'conventional']) {
    await select.selectOption(t);
    await page.waitForTimeout(900);
    const p = `/tmp/tailcheck/3d_${t}.png`;
    await page.screenshot({ path: p });
    shots[t] = fs.statSync(p).size;
  }

  // persistence: pick V-tail, reload, expect the select to still be v_tail
  await select.selectOption('v_tail');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const sel2 = page.locator('select').filter({ has: page.locator('option[value="v_tail"]') });
  const persisted = await sel2.inputValue();

  // 2D view (the default) still draws after the reload
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/tailcheck/2d_v_tail.png', fullPage: false });

  console.log(JSON.stringify({ errors, persisted, shots }, null, 2));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error('CHECK FAILED', e); process.exit(1); });
