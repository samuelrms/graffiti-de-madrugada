// Drives the game in a real (headless) Chrome via puppeteer-core.
// Used by tools/screenshots.ts and test/e2e.test.ts.
import fs from 'node:fs';
import puppeteer, { type Browser, type Page, type Viewport } from 'puppeteer-core';
import './global.d.ts';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter((p): p is string => !!p);

export function findChrome(): string | null {
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

export async function launch({ width = 1280, height = 720 } = {}): Promise<Browser> {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH');
  return puppeteer.launch({
    executablePath,
    headless: true,
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

/** Creates a room through the HTTP API and returns its id. */
export async function createRoom(url: string, name: string, locked = false): Promise<string> {
  const r = await fetch(`${url}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, locked }) });
  return ((await r.json()) as { id: string }).id;
}

/** Opens a player tab straight into a room (deep link). Bot pages (viewport given) stop rendering so the CPU stays free for the page we screenshot. */
export async function openPlayer(browser: Browser, url: string, name: string, viewport?: Viewport, roomId?: string): Promise<Page> {
  // Each player gets its own browser context (separate localStorage => separate client token).
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (viewport) await page.setViewport(viewport);
  page.on('pageerror', (e) => console.error(`[${name}] pageerror`, (e as Error).message));
  await page.goto(roomId ? `${url}/#r=${roomId}` : url, { waitUntil: 'load', timeout: 60000 });
  if (!roomId) return page; // caller drives the home screen
  try {
    await page.waitForFunction(() => window.DBG && window.DBG.state().players.length > 0, { timeout: 45000, polling: 200 });
  } catch (e) {
    const err = await page.evaluate(() => document.querySelector('#homeError')?.textContent);
    throw new Error(`${name} could not join room ${roomId}: ${err || (e as Error).message}`);
  }
  await page.evaluate((n, r) => {
    const input = document.querySelector<HTMLInputElement>('#lobbyName')!;
    input.value = n;
    input.dispatchEvent(new Event('change'));
    window.DBG.flags.render = r;
    document.querySelector('#audioHint')?.remove(); // no user gesture in the harness
  }, name, !viewport);
  await page.waitForFunction((n) => window.DBG.state().players.find((p: any) => p.id === window.DBG.socket.id)?.name === n, { timeout: 5000, polling: 100 }, name);
  return page;
}

export const ready = (page: Page) => page.evaluate(() => {
  if (!window.DBG.state().players.find((p: any) => p.id === window.DBG.socket.id)?.ready) document.querySelector<HTMLButtonElement>('#ready')!.click();
});
export const phase = (page: Page): Promise<string> => page.evaluate(() => window.DBG.state().phase);
export const waitPhase = (page: Page, ph: string, timeout = 15000) => page.waitForFunction((p) => window.DBG.state().phase === p, { timeout, polling: 200 }, ph);
export const me = (page: Page): Promise<any> => page.evaluate(() => window.DBG.state().players.find((p: any) => p.id === window.DBG.socket.id));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Walk towards (x, z): re-aim every 150 ms, hold W until close (client physics does the rest). */
export async function walkTo(page: Page, x: number, z: number, { timeout = 40000, tolerance = 0.9 } = {}): Promise<number> {
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

/** Hold keys until cond() (evaluated in the page) is true or timeout. */
export async function holdUntil(page: Page, keysHeld: string[], condFn: () => boolean, timeout = 8000, { release = true } = {}): Promise<boolean> {
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

export const releaseKeys = (page: Page) => page.evaluate(() => window.DBG.keys.clear());
export const render = (page: Page, on: boolean) => page.evaluate((o) => { window.DBG.flags.render = o; }, on);
export const look = (page: Page, yaw: number, pitch = 0.1) => page.evaluate((y, p) => { window.DBG.player.yaw = y; window.DBG.player.pitch = p; }, yaw, pitch);
export const key = (page: Page, k: string, down: boolean) => page.evaluate((k, d) => { if (d) window.DBG.keys.add(k); else window.DBG.keys.delete(k); }, k, down);
export const pos = (page: Page): Promise<{ x: number; y: number; z: number }> => page.evaluate(() => { const P = window.DBG.player; return { x: P.x, y: P.y, z: P.z }; });
