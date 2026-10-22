/** 2D canvas framing per tail type: does the drawing fit inside the canvas? */
const { chromium } = require('playwright-core');

const measure = async (page, b64) => page.evaluate(async ({ b64 }) => {
  const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let minx = 1e9, maxx = 0, miny = 1e9, maxy = 0, n = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 690) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  return { w: c.width, h: c.height, ink: n, bbox: [minx, miny, maxx, maxy], touchesLeft: minx <= 1, touchesRight: maxx >= c.width - 2, marginRight: c.width - 1 - maxx };
}, { b64 });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.addInitScript(() => { try { localStorage.setItem('aerobuilder_welcome_seen', '1'); } catch { /* */ } });
  await page.goto('http://127.0.0.1:1932/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const select = page.locator('select').filter({ has: page.locator('option[value="v_tail"]') });
  const out = {};
  for (const t of ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform']) {
    await select.selectOption(t);
    await page.waitForTimeout(600);
    const box = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const shot = await page.screenshot({ clip: box });
    out[t] = await measure(page, shot.toString('base64'));
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
