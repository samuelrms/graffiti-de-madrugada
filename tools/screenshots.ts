// Generates the README screenshots in docs/img using a real (headless) Chrome.
// Usage: pnpm screenshots   (builds nothing: expects `pnpm build:client` to have run)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'puppeteer-core';
import { createGame } from '../src/server/http/server.ts';
import * as C from '../src/shared/city.ts';
import * as B from './browser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '..', 'dist', 'public');
if (!fs.existsSync(path.join(staticDir, 'index.html'))) { console.error('Run `pnpm build:client` first.'); process.exit(1); }

const OUT = path.join(__dirname, '..', 'docs', 'img');
fs.mkdirSync(OUT, { recursive: true });
// Freeze the local simulation while the (slow, software-rendered) screenshot is taken.
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => { window.DBG.flags.sim = false; });
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  await page.evaluate(() => { window.DBG.flags.sim = true; });
}
const city = C.generateCity();

(async () => {
  const game = createGame({ port: 0, quiet: true, countdownSeconds: 1, matchSeconds: 600, staticDir, maxPerIp: 0 });
  await game.ready;
  const url = `http://localhost:${game.port}`;
  const browser = await B.launch({ width: 1280, height: 720 });
  try {
    // A few public rooms so the home screen has something to show.
    await B.createRoom(url, 'Beco 13');
    await B.createRoom(url, 'Centro à noite');
    const roomId = await B.createRoom(url, 'Crew da Mina');
    await B.createRoom(url, 'Só pelo link', true);
    const home = await B.openPlayer(browser, url, 'Mina Tag');
    await home.waitForSelector('#home:not(.hidden)');
    await home.type('#homeName', 'Mina Tag');
    await home.type('#roomName', 'Telhado dos Tags');
    await B.sleep(3500); // room list polls every 3 s
    await shot(home, 'home');
    console.log('home.jpg');
    await home.close();

    const a = await B.openPlayer(browser, url, 'Mina Tag', undefined, roomId);
    const small = { width: 320, height: 200 };
    const b = await B.openPlayer(browser, url, 'Zé Spray', small, roomId);
    const c = await B.openPlayer(browser, url, 'Dona Neon', small, roomId);
    await B.ready(b); await B.ready(c);
    await B.sleep(300);
    await a.bringToFront();
    await shot(a, 'lobby');
    console.log('lobby.jpg');
    // Owner switches to 2 teams for the teams shot, then back to free-for-all.
    await a.select('#modeSelect', 'teams');
    await a.waitForFunction(() => window.DBG.state().players.every((p: any) => p.team >= 0), { polling: 200 });
    await B.sleep(400);
    await shot(a, 'equipes');
    console.log('equipes.jpg');
    await a.select('#modeSelect', 'ffa');
    await a.waitForFunction(() => window.DBG.state().players.every((p: any) => p.team === -1), { polling: 200 });

    await B.ready(a);
    await B.waitPhase(a, 'playing');
    await B.sleep(500);

    // Mina walks downtown: along the x=4 street to z=100, then to the tower 25 wall.
    const towerIndex = city.findIndex((b) => b.kind === 'tower');
    const tower = city[towerIndex];
    const tx = tower.x - tower.w / 2 - 3;
    await B.walkTo(a, 4, 100);
    await B.walkTo(a, tx, 100);
    await B.look(a, -Math.PI / 2, 0.08);
    await B.sleep(300);
    await shot(a, 'cidade');
    console.log('cidade.jpg');

    await B.walkTo(a, tx, tower.z);
    await B.look(a, -Math.PI / 2, 0.05);
    // Spray: hold the mouse while aiming at the wall (real client path: raycast -> paint).
    const info = C.faceInfo(tower, 1);
    const mid = Math.floor(info.cols / 2);
    for (const [i, j] of [[mid, 0], [mid - 1, 0], [mid + 1, 0], [mid, 1], [mid - 1, 1], [mid + 1, 1], [mid, 2], [mid - 2, 0], [mid + 2, 1]]) {
      await a.evaluate((k) => window.DBG.socket.emit('paint', k), C.tileKey(towerIndex, 1, i, j));
      await B.sleep(140);
    }
    await B.sleep(300);
    await shot(a, 'pichando');
    console.log('pichando.jpg');

    // Climb: hold W + Space against the wall until we gain height; keep holding while we shoot the picture.
    await B.look(a, -Math.PI / 2, 0.05);
    const climbed = await B.holdUntil(a, ['w', ' '], () => window.DBG.player.y > 7, 12000, { release: false });
    await a.evaluate(() => { window.DBG.player.pitch = 0.55; });
    await B.sleep(150);
    await shot(a, 'escalando');
    console.log('escalando.jpg', climbed, await B.pos(a));
    // Keep climbing to the roof, grab the bazooka up there.
    await a.evaluate((i) => { window.DBG.roofTarget = i; }, towerIndex);
    const onRoof = await B.holdUntil(a, ['w', ' '], () => window.DBG.player.y >= window.DBG.buildings[window.DBG.roofTarget].h - 0.1, 15000);
    await B.sleep(300);
    await B.walkTo(a, tower.x, tower.z, { timeout: 8000 });
    await B.look(a, Math.PI / 4, 0.5);
    await B.sleep(300);
    await shot(a, 'telhado');
    console.log('telhado.jpg', onRoof, await B.pos(a), await B.me(a).then((m: any) => m.weapon));

    // Combat: everyone meets at the central crossing (100, 100).
    await a.evaluate(() => window.DBG.setTool('gun'));
    await B.walkTo(a, tower.x + tower.w / 2 + 2, tower.z, { timeout: 6000 }); // walk off the roof edge
    await B.sleep(1500);
    await Promise.all([
      (async () => { await B.walkTo(a, 100, 100); })(),
      (async () => { await B.walkTo(b, 196, 100); await B.walkTo(b, 106, 100); await B.walkTo(b, 103, 102.5); })()
    ]);
    const pa = await B.pos(a);
    const pb = await B.pos(b);
    // Face Zé but keep him off-centre so the camera (behind Mina) sees him.
    await B.look(a, Math.atan2(-(pb.x - pa.x), -(pb.z - pa.z)) + 0.75, 0.12);
    await B.look(b, Math.atan2(-(pa.x - pb.x), -(pa.z - pb.z)), 0.05);
    await B.sleep(200);
    const bId = await b.evaluate(() => window.DBG.socket.id);
    for (let i = 0; i < 24; i++) {
      await a.evaluate((id) => {
        const P = window.DBG.player;
        const o = window.DBG.state().players.find((p: any) => p.id === id);
        const dx = o.x - P.x, dy = (o.y + 0.9) - (P.y + 1.4), dz = o.z - P.z;
        window.DBG.socket.emit('shoot', { ox: P.x, oy: P.y + 1.4, oz: P.z, dx, dy, dz });
      }, bId);
      if (i === 1) { await shot(a, 'combate'); console.log('combate.jpg'); }
      if (await b.evaluate(() => window.DBG.state().players.find((p: any) => p.id === window.DBG.socket.id).dead)) break;
      await B.sleep(320);
    }
    await B.sleep(250);
    await shot(a, 'kill');

    // Showcase of the 12 looks: two rows, free camera up close, HUD hidden.
    await B.sleep(800); // let shot effects fade
    await a.evaluate((colors: string[]) => {
      const D = window.DBG; const T = D.THREE;
      document.head.insertAdjacentHTML('beforeend', '<style id="noui">#ui{display:none!important}</style>');
      const cx = 100, cz = 132; // next crossing south: open ground, real players stay far behind
      D.hiddenPickups = D.scene.children.filter((o: any) => o.type === 'Group' && o.children.some((c: any) => c.isSprite) && Math.hypot(o.position.x - cx, o.position.z - cz) < 12);
      for (const o of D.hiddenPickups) o.position.y -= 500;
      D.lineup = [];
      for (let i = 0; i < 12; i++) {
        const ch = D.buildCharacter(i, colors[i]);
        const row = i < 6 ? 0 : 1;
        const col = (i % 6) - 2.5;
        ch.group.position.set(cx + col * 1.3 + (row ? 0.65 : 0), 0, cz - 3.2 + row * 2.2);
        ch.group.rotation.y = Math.PI; // face +z, towards the camera
        ch.parts.tag.visible = false;
        ch.t = i * 0.7;
        D.scene.add(ch.group);
        D.lineup.push(ch);
      }
      D.flags.freeCam = true;
      D.camera.position.set(cx, 3.0, cz + 4.2);
      D.camera.lookAt(new T.Vector3(cx, 0.9, cz - 2.2));
    }, ['#ff2d75', '#00e5ff', '#b4ff39', '#ffb300', '#b967ff', '#ff6a00', '#2dff9b', '#ff4dff', '#4d7cff', '#ffe600', '#ff3b3b', '#7dffea']);
    await B.sleep(300);
    await shot(a, 'personagens');
    console.log('personagens.jpg');
    await a.evaluate(() => {
      for (const ch of window.DBG.lineup) window.DBG.scene.remove(ch.group);
      for (const o of window.DBG.hiddenPickups) o.position.y += 500;
      window.DBG.flags.freeCam = false;
      document.querySelector('#noui')?.remove();
    });

    // Touch layout: emulate a phone.
    const m = await (await browser.createBrowserContext()).newPage();
    await m.emulate({ viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
    await m.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); });
    await m.goto(`${url}/#r=${roomId}`, { waitUntil: 'load', timeout: 90000 });
    await m.waitForFunction(() => window.DBG && window.DBG.state().players.length > 0, { polling: 200, timeout: 60000 });
    await m.evaluate(() => { document.querySelector('#overlay')!.classList.add('hidden'); });
    await B.sleep(400);
    await m.screenshot({ path: path.join(OUT, 'toque.jpg'), type: 'jpeg', quality: 82 });
    console.log('toque.jpg');
  } finally {
    await browser.close();
    await game.close();
  }
})().catch((e: unknown) => { console.error(e); process.exit(1); });
