/**
 * Measures the 3D render: is the model clipped by the frame / asymmetric?
 * Reports the canvas bbox, the drawn-model bbox (non-background pixels) and
 * left/right pixel balance. Run: node scripts/frame-check.cjs
 */
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('aerobuilder_welcome_seen', '1'); } catch { /* */ } });
  await page.goto('http://127.0.0.1:1932/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // stop the auto-rotation so measurements are repeatable
  await page.getByRole('button', { name: /3D/i }).first().click();
  await page.waitForTimeout(1500);
  await page.mouse.move(640, 450);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const shot = await page.screenshot({ clip: canvas });
  const b64 = shot.toString('base64');

  const stats = await page.evaluate(async ({ b64 }) => {
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // background = the gradient (very low saturation, high lightness); model pixels differ from their row median
    let minx = 1e9, maxx = 0, miny = 1e9, maxy = 0, n = 0, left = 0, right = 0;
    const cx = c.width / 2;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
        const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
        const sat = max - min;
        const model = sat > 28 || max < 110; // coloured model or dark shadow
        if (!model) continue;
        n++;
        if (x < cx) left++; else right++;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
    return { w: c.width, h: c.height, modelPixels: n, bbox: [minx, miny, maxx, maxy], left, right, balance: +(right / Math.max(left, 1)).toFixed(3) };
  }, { b64 });

  // 2D top view symmetric check
  await page.locator('button', { hasText: /^2D$/ }).first().click();
  await page.waitForTimeout(800);
  const c2 = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot2 = await page.screenshot({ clip: c2 });
  const stats2 = await page.evaluate(async ({ b64 }) => {
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // ink = anything clearly darker than white paper
    const cols = new Array(c.width).fill(0);
    let minx = 1e9, maxx = 0, n = 0, left = 0, right = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 690) { cols[x]++; n++; if (x < c.width / 2) left++; else right++; if (x < minx) minx = x; if (x > maxx) maxx = x; }
    }
    return { w: c.width, h: c.height, ink: n, inkBbox: [minx, maxx], left, right, balance: +(right / Math.max(left, 1)).toFixed(3), firstCols: cols.slice(0, 8), lastCols: cols.slice(-8) };
  }, { b64: shot2.toString('base64') });

  console.log(JSON.stringify({ canvas, threeD: stats, twoD: stats2 }, null, 1));
  await browser.close();
})();
