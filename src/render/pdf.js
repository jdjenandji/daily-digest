import puppeteer from 'puppeteer-core';
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const MM = 3.779528;          // px per mm at 96dpi
const PAGE_CONTENT_MM = 273;  // A4 height 297mm less 2 x 12mm margins
const CONTENT_W_MM = 186;     // A4 width 210mm less 2 x 12mm margins
const MIN_SCALE = 0.85;

let shared = null;

/**
 * Resolve Chrome without downloading one. The pinned build in the puppeteer cache is
 * preferred over system Chrome because system Chrome auto-updates and can shift print
 * metrics under a layout tuned to a fixed page count.
 */
export async function findChrome(cfg) {
  const candidates = [];
  if (cfg?.chrome?.executablePath) candidates.push(cfg.chrome.executablePath);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);

  const cacheRoot = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    const dirs = (await readdir(cacheRoot)).filter((d) => d.startsWith('mac')).sort().reverse();
    for (const d of dirs) {
      candidates.push(path.join(cacheRoot, d, 'chrome-mac-arm64',
        'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
      candidates.push(path.join(cacheRoot, d, 'chrome-mac-x64',
        'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
    }
  } catch { /* no cache directory */ }

  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');

  for (const c of candidates) {
    try { await access(c); return c; } catch { /* keep looking */ }
  }
  throw new Error(
    'No Chrome found. Install one with:\n  npx @puppeteer/browsers install chrome@stable\n'
    + 'or set chrome.executablePath in config.json.');
}

export async function launch(cfg) {
  const executablePath = await findChrome(cfg);
  return puppeteer.launch({
    executablePath,
    headless: true,
    // Stable text metrics across runs; the fit check depends on measuring reliably.
    args: ['--font-render-hinting=none', '--disable-gpu', '--no-sandbox', '--hide-scrollbars'],
  });
}

/** The server reuses one browser; the CLI opens and closes per run. */
export async function sharedBrowser(cfg) {
  if (shared && shared.connected) return shared;
  shared = await launch(cfg);
  return shared;
}

export async function closeShared() {
  if (shared) { try { await shared.close(); } catch {} shared = null; }
}

export async function renderPdf(html, cfg, { browser = null } = {}) {
  const own = !browser;
  const b = browser ?? await launch(cfg);
  const page = await b.newPage();
  try {
    // Measure at the true printable width. Chrome's default 800px viewport is 212mm,
    // so laying out against it would size every column against the wrong page.
    await page.setViewport({
      width: Math.round(CONTENT_W_MM * MM),
      height: Math.round(PAGE_CONTENT_MM * MM),
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: 'load' });
    // Measure under PRINT rules. In screen mode each .sheet carries a fixed 297mm
    // min-height for the preview, which would make every measurement meaningless.
    await page.emulateMediaType('print');
    await page.evaluateHandle('document.fonts.ready');

    // Third layer of overflow defence, after data truncation and line clamping.
    // Each sheet starts its own page, so the tallest sheet is what decides whether
    // anything spills: summing them would punish a perfectly fine two-page layout.
    const tallestPx = await page.evaluate(() =>
      Math.max(0, ...[...document.querySelectorAll('.sheet')]
        .map((s) => s.getBoundingClientRect().height)));

    const budgetPx = PAGE_CONTENT_MM * MM;
    let scale = 1;
    if (tallestPx > budgetPx) {
      // Floor at 0.85: below that, accept an extra page rather than unreadable type.
      scale = Math.max(MIN_SCALE, Number((budgetPx / tallestPx).toFixed(3)));
    }

    const pdf = await page.pdf({
      preferCSSPageSize: true,   // never combine with `format`; they conflict
      printBackground: true,
      scale,
    });
    return { pdf: Buffer.from(pdf), scale, tallestMm: Math.round(tallestPx / MM) };
  } finally {
    await page.close().catch(() => {});
    if (own) await b.close().catch(() => {});
  }
}
