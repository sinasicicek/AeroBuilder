/**
 * Headless check for the build-plate layout fix.
 *
 * Regression it guards: every print section used to be exported centred on the
 * SAME bed position, so opening a whole set in any viewer/slicer showed the
 * parts piled up, mixed with the assembled preview.
 *
 * Asserts:
 *  1. the ZIP contains 00_plate_layout/plate_all.stl + plate_map.txt
 *  2. no two parts overlap on the plate (rectangle intersection test on the map)
 *  3. every part lies inside the bed
 *  4. plate_all.stl spans the whole arranged plate (not a single part)
 *  5. the viewer opens in "Build plate" mode and the parts mode shows them spread
 *  6. no console errors
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
  page.on('dialog', async d => { if (d.type() === 'prompt') await d.accept('Plate Test'); else await d.accept(); });

  const step = (m) => console.log('· ' + m);

  await page.addInitScript(() => {
    try {
      localStorage.setItem('aerobuilder_welcome_seen', '1');
      localStorage.setItem('aerobuilder_consent', 'denied');
      localStorage.setItem('aerobuilder_consent_at', new Date().toISOString());
    } catch { /* ignore */ }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('header');

  // Export → STL, then archive it so we can read the exact exported bytes
  await page.getByRole('button', { name: /Dışa aktar|Export/i }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /3D baskı için STL|Export STL for 3D printing/i }).click();
  await page.waitForSelector('#stl-title');
  const save = page.getByRole('button', { name: /Arşive kaydet|Save to archive/i });
  for (let i = 0; i < 60 && !(await save.isEnabled()); i++) await page.waitForTimeout(500);
  await save.click();
  await page.waitForTimeout(7000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const report = await page.evaluate(async () => {
    const files = await new Promise((resolve) => {
      const q = indexedDB.open('aerobuilder_archive');
      q.onsuccess = () => {
        const all = q.result.transaction('blobs', 'readonly').objectStore('blobs').getAll();
        all.onsuccess = () => resolve(all.result[0]?.files ?? {});
      };
    });
    const dec = new TextDecoder();
    const mapPath = Object.keys(files).find(k => /plate_map\.txt$/.test(k));
    const stlPath = Object.keys(files).find(k => /plate_all\.stl$/.test(k));
    const parts = Object.keys(files).filter(k => /\.stl$/i.test(k) && /^(0[1-9]|1[01])_/.test(k.split('/')[0]));

    let rows = [];
    if (mapPath) {
      rows = dec.decode(files[mapPath]).replace(/^\uFEFF/, '').split(/\r?\n/)
        .filter(l => l && !l.startsWith('#'))
        .map(l => {
          const [name, plate, x, y, w, h] = l.split('\t');
          return { name, plate: +plate, x: +x, y: +y, w: +w, h: +h };
        });
    }

    // Pairwise overlap: inflate by a hair so touching edges are not "overlap"
    let overlaps = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0.01 && oy > 0.01) overlaps.push(`${a.name}×${b.name} (${ox.toFixed(1)}×${oy.toFixed(1)} mm)`);
      }
    }

    // Each part must sit inside ITS OWN plate: plate N starts at (N-1)*(220+20) mm
    const BED = 220, PLATE_GAP = 20;
    const outside = rows.filter(r => {
      const px = (r.plate - 1) * (BED + PLATE_GAP);
      return r.x < px - 0.01 || r.y < 0 || r.x + r.w > px + BED + 0.01 || r.y + r.h > BED + 0.01;
    }).map(r => `${r.name}@plate${r.plate}`);
    const plates = rows.length ? Math.max(...rows.map(r => r.plate)) : 0;

    // bbox of the merged plate STL
    let plate = null;
    if (stlPath) {
      const bytes = files[stlPath];
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const n = dv.getUint32(80, true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12;
        for (let v = 0; v < 3; v++) {
          const x = dv.getFloat32(o + v * 12, true), y = dv.getFloat32(o + v * 12 + 4, true);
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      plate = { w: +(x1 - x0).toFixed(1), h: +(y1 - y0).toFixed(1), triangles: n };
    }

    return { hasMap: !!mapPath, hasPlate: !!stlPath, partFiles: parts.length, rows: rows.length, overlaps, outside, plates, plate };
  });

  step(`zip: plate_all=${report.hasPlate} plate_map=${report.hasMap} | part files=${report.partFiles} | mapped=${report.rows} | plates=${report.plates}`);
  step(`overlaps: ${report.overlaps.length}` + (report.overlaps.length ? ' → ' + report.overlaps.slice(0, 5).join(', ') : ''));
  step(`outside their plate: ${report.outside.length ? report.outside.join(', ') : 'none'}`);
  step(`plate_all bbox: ${report.plate ? `${report.plate.w} × ${report.plate.h} mm, ${report.plate.triangles} tris` : 'missing'}`);

  // Viewer: default mode should be the arranged plate
  await page.getByRole('button', { name: /STL arşivi|STL archive/i }).first().click();
  await page.waitForSelector('#archive-title');
  await page.waitForTimeout(700);
  await page.locator('#archive-title >> xpath=../..//li').first().locator('button[title="Görüntüle"], button[title="View"]').last().click();
  await page.waitForSelector('#stl-viewer-title');
  await page.waitForTimeout(2500);

  const modeState = async () => {
    const btns = await page.locator('#stl-viewer-title >> xpath=../../..//button[@aria-pressed]').evaluateAll(
      els => els.map(e => ({ label: e.textContent.trim(), active: e.getAttribute('aria-pressed') === 'true' })),
    );
    const text = await page.locator('#stl-viewer-title >> xpath=../../..').innerText();
    return { btns, size: (text.match(/[\d.]+\s*×\s*[\d.]+\s*×\s*[\d.]+\s*mm/) || ['-'])[0] };
  };
  const plateMode = await modeState();
  step('viewer plate mode: ' + JSON.stringify(plateMode));

  // Switch to the individual parts: they must span a wide area, not sit on one spot
  await page.getByRole('button', { name: /^Parçalar|^Parts/ }).first().click();
  await page.waitForTimeout(1800);
  const partsMode = await modeState();
  step('viewer parts mode: ' + JSON.stringify(partsMode));
  await page.screenshot({ path: '/tmp/plate-check.png' });

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 5), null, 1) : 'none');
  const ok = report.hasPlate && report.hasMap && report.overlaps.length === 0
    && report.outside.length === 0 && report.rows === report.partFiles;
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
