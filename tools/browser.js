// Shared helpers to drive the game in a real Chrome (headless) via puppeteer-core.
// Used by tools/screenshots.js and test/e2e.test.js.
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

function findChrome() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

async function launch({ width = 1280, height = 720 } = {}) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH');
  return puppeteer.launch({
    executablePath,
    headless: 'new',
    defaultViewport: { width, height, deviceScaleFactor: 1 },
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--mute-audio'
    ]
  });
}

// Bot pages (viewport given) stop rendering: the sim keeps running, CPU stays free for the page we screenshot.
async function openPlayer(browser, url, name, viewport) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  page.on('pageerror', (e) => console.error(`[${name}] pageerror`, e.message));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.DBG && window.DBG.state().players.length > 0, { timeout: 15000, polling: 200 });
  await page.evaluate((n, r) => {
    document.querySelector('#lobbyName').value = n;
    document.querySelector('#lobbyName').dispatchEvent(new Event('change'));
    window.DBG.flags.render = r;
  }, name, !viewport);
  return page;
}

const ready = (page) => page.evaluate(() => { if (!window.DBG.state().players.find((p) => p.id === window.DBG.socket.id)?.ready) document.querySelector('#ready').click(); });
const phase = (page) => page.evaluate(() => window.DBG.state().phase);
const waitPhase = (page, ph, timeout = 15000) => page.waitForFunction((p) => window.DBG.state().phase === p, { timeout, polling: 200 }, ph);
const me = (page) => page.evaluate(() => window.DBG.state().players.find((p) => p.id === window.DBG.socket.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Walk towards (x, z): re-aim every 150 ms, hold W until close (client physics does the rest).
async function walkTo(page, x, z, { timeout = 40000, tolerance = 0.9 } = {}) {
  await page.evaluate(() => { window.DBG.flags.render = false; });
  const t0 = Date.now();
  let d = Infinity;
  while (Date.now() - t0 < timeout) {
    d = await page.evaluate((x, z) => {
      const P = window.DBG.player;
      const dx = x - P.x, dz = z - P.z;
      P.yaw = Math.atan2(-dx, -dz);
      window.DBG.keys.add('w');
      return Math.hypot(dx, dz);
    }, x, z);
    if (d < tolerance) break;
    await sleep(Math.min(150, (d / 7) * 1000));
  }
  await page.evaluate(() => { window.DBG.keys.delete('w'); window.DBG.flags.render = true; });
  return d;
}

// Hold keys until cond(page-eval) is true or timeout.
async function holdUntil(page, keysHeld, condFn, timeout = 8000, { release = true } = {}) {
  await page.evaluate((ks) => { ks.forEach((k) => window.DBG.keys.add(k)); window.DBG.flags.render = false; }, keysHeld);
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(condFn)) { ok = true; break; }
    await sleep(100);
  }
  await page.evaluate((ks, rel) => { if (rel) ks.forEach((k) => window.DBG.keys.delete(k)); window.DBG.flags.render = true; }, keysHeld, release);
  return ok;
}

const look = (page, yaw, pitch = 0.1) => page.evaluate((y, p) => { window.DBG.player.yaw = y; window.DBG.player.pitch = p; }, yaw, pitch);
const key = (page, k, down) => page.evaluate((k, d) => { d ? window.DBG.keys.add(k) : window.DBG.keys.delete(k); }, k, down);
const releaseKeys = (page) => page.evaluate(() => window.DBG.keys.clear());
const render = (page, on) => page.evaluate((o) => { window.DBG.flags.render = o; }, on);
const pos = (page) => page.evaluate(() => { const P = window.DBG.player; return { x: P.x, y: P.y, z: P.z }; });

module.exports = { findChrome, launch, openPlayer, ready, phase, waitPhase, me, sleep, walkTo, holdUntil, releaseKeys, look, key, pos, render };
