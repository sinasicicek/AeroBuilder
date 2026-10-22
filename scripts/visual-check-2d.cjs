/** 2D (deterministic) screenshots of every tail type + pixel diff. */
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('aerobuilder_welcome_seen', '1'); } catch { /* */ } });
  await page.goto('http://127.0.0.1:1932/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const select = page.locator('select').filter({ has: page.locator('option[value="v_tail"]') });
  for (const t of ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform']) {
    await select.selectOption(t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/tailcheck/2d_${t}.png` });
  }
  // diff conventional vs others, on the drawing area only
  const files = {};
  for (const t of ['conventional', 't_tail', 'v_tail', 'inverted_v', 'cruciform']) {
    files[t] = fs.readFileSync(`/tmp/tailcheck/2d_${t}.png`).toString('base64');
  }
  const res = await page.evaluate(async files => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
    const grab = async src => {
      const im = await load(src); const c = document.createElement('canvas');
      c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width };
    };
    const base = await grab(files.conventional);
    const out = {};
    for (const [t, src] of Object.entries(files)) {
      if (t === 'conventional') continue;
      const o = await grab(src);
      let n = 0, minx = 1e9, miny = 1e9, maxx = 0, maxy = 0;
      for (let i = 0; i < o.d.length; i += 4) {
        const df = Math.abs(o.d[i] - base.d[i]) + Math.abs(o.d[i + 1] - base.d[i + 1]) + Math.abs(o.d[i + 2] - base.d[i + 2]);
        if (df > 20) {
          n++; const px = (i / 4) % o.w, py = Math.floor(i / 4 / o.w);
          if (px < minx) minx = px; if (px > maxx) maxx = px;
          if (py < miny) miny = py; if (py > maxy) maxy = py;
        }
      }
      out[t] = { diff: n, bbox: [minx, miny, maxx, maxy] };
    }
    return out;
  }, files);
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();
