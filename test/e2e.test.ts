// End-to-end: real Chrome (headless) drives two clients through lobby, walking,
// painting, climbing and a kill. Run with `npm run test:e2e` (needs Chrome).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/server/http/server.ts';
import * as C from '../src/shared/city.ts';
import * as B from '../tools/browser.ts';

const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'public');
const built = fs.existsSync(path.join(staticDir, 'index.html'));

const chrome = B.findChrome();

test('two browsers play a round: lobby → paint → climb → kill', { skip: !chrome ? 'Chrome not found (set CHROME_PATH)' : !built ? 'client not built (pnpm build:client)' : false, timeout: 240000 }, async () => {
  const game = createGame({ port: 0, quiet: true, countdownSeconds: 0.5, matchSeconds: 600, staticDir, maxPerIp: 0 });
  await game.ready;
  const url = `http://localhost:${game.port}`;
  const browser = await B.launch({ width: 640, height: 360 });
  try {
    // Mina uses the home screen for real: types a room name, creates it (locked), shares the link.
    const a = await B.openPlayer(browser, url, 'Mina', { width: 320, height: 200 });
    await a.waitForSelector('#home:not(.hidden)');
    await a.type('#homeName', 'Mina');
    await a.type('#roomName', 'Beco 13');
    await a.click('#roomLocked');
    await a.click('#createBtn');
    await a.waitForFunction(() => window.DBG && window.DBG.state().players.length > 0, { timeout: 15000, polling: 200 });
    const roomId = await a.evaluate(() => location.hash.replace('#r=', ''));
    assert.match(roomId, /^[a-z0-9]{6}$/);
    const listed = (await (await fetch(`${url}/api/rooms`)).json()) as Array<{ id: string }>;
    assert.ok(!listed.some((r) => r.id === roomId), 'locked room is not listed');
    const b = await B.openPlayer(browser, url, 'Zé', { width: 320, height: 200 }, roomId);
    assert.equal(await B.phase(a), 'lobby');
    assert.equal(await a.evaluate(() => window.DBG.state().players.map((p: any) => p.name).sort().join(',')), 'Mina,Zé');
    // A second tab of Mina's browser (same localStorage token) is refused.
    const tab2 = await a.browserContext().newPage();
    await tab2.goto(`${url}/#r=${roomId}`, { waitUntil: 'networkidle0' });
    await tab2.waitForFunction(() => /outra aba|another tab/.test(document.querySelector('#homeError')?.textContent ?? ''), { timeout: 8000, polling: 200 });
    await tab2.close();
    assert.equal(await a.evaluate(() => window.DBG.state().players.length), 2);
    // Owner (Mina) switches to 2 teams: one per side, team colours applied.
    await a.select('#modeSelect', 'teams');
    await a.waitForFunction(() => window.DBG.state().players.every((p: any) => p.team >= 0), { timeout: 5000, polling: 200 });
    assert.deepEqual(await a.evaluate(() => window.DBG.state().players.map((p: any) => p.team).sort()), [0, 1]);
    await a.select('#modeSelect', 'ffa');
    await a.waitForFunction(() => window.DBG.state().players.every((p: any) => p.team === -1), { timeout: 5000, polling: 200 });
    await B.ready(a);
    await B.sleep(300);
    assert.equal(await B.phase(a), 'lobby', 'waits for everyone');
    await B.ready(b);
    await B.waitPhase(a, 'playing');
    await B.sleep(1600); // respawn grace

    // Walking obeys physics and the server accepts it (no corrections).
    await a.evaluate(() => { window.corr = []; window.DBG.socket.on('correct', (d: any) => window.corr.push(d.reason)); });
    const tower = C.generateCity().find((b) => b.kind === 'tower')!;
    const tx = tower.x - tower.w / 2 - 3;
    assert.ok((await B.walkTo(a, 4, 100)) < 1);
    assert.ok((await B.walkTo(a, tx, 100)) < 1);
    assert.ok((await B.walkTo(a, tx, tower.z)) < 1);
    assert.deepEqual(await a.evaluate(() => window.corr), []);

    // Painting through the real client path: aim the camera at the wall and hold the mouse.
    await B.look(a, -Math.PI / 2, 0.05);
    await B.render(a, true);
    await a.evaluate(() => { window.DBG.flags.render = true; });
    await a.screenshot({ type: 'jpeg', quality: 10 }); // force a frame so the camera is updated
    const aim = await a.evaluate(() => window.DBG.aimWallTile());
    assert.ok(aim && aim.dist <= 4.5, `crosshair on a wall tile in range: ${JSON.stringify(aim)}`);
    await a.evaluate(() => window.DBG.press(true));
    // tryPaint runs from requestAnimationFrame; headless only paints frames on demand, so force a few.
    for (let i = 0; i < 6; i++) { await a.screenshot({ type: 'jpeg', quality: 10 }); await B.sleep(150); }
    await a.evaluate(() => window.DBG.press(false));
    const mine = await B.me(a);
    assert.ok(mine.tiles >= 1, `painted ${mine.tiles} tiles`);
    const other = await B.me(b);
    assert.equal(other.score, 0);
    assert.ok(await b.evaluate(() => window.DBG.state().players.some((p: any) => p.tiles > 0)), 'other client sees the score');

    // Pause menu: Esc opens it, language switch re-renders the UI, Esc closes it.
    await a.keyboard.press('Escape');
    await a.waitForSelector('#pause:not(.hidden)', { timeout: 3000 });
    await a.select('#setLang', 'pt-BR');
    assert.equal(await a.evaluate(() => document.querySelector('#pauseResume')?.textContent), 'Continuar');
    await a.select('#setLang', 'en');
    assert.equal(await a.evaluate(() => document.querySelector('#pauseResume')?.textContent), 'Resume');
    assert.equal(await a.evaluate(() => document.documentElement.lang), 'en');
    assert.match(await a.evaluate(() => document.querySelector('#tool')?.textContent ?? ''), /Paint pistol/);
    await a.keyboard.press('Escape');
    await a.waitForSelector('#pause.hidden', { timeout: 3000 });
    assert.ok(await a.evaluate(() => !!(window as any).AudioContext), 'Web Audio available');

    // Climbing: hold W + Space against the wall.
    const climbed = await B.holdUntil(a, ['w', ' '], () => window.DBG.player.y > 5, 10000);
    assert.ok(climbed, 'gained height on the wall');
    await B.sleep(1500);
    assert.deepEqual(await a.evaluate(() => window.corr), [], 'server accepted the climb');

    // Combat: Zé walks to Mina's street; Mina shoots him until he drops.
    await B.walkTo(b, 196, 100);
    await B.walkTo(b, tx - 2, 100);
    await B.walkTo(b, tx - 2, tower.z + 4);
    await B.walkTo(a, tx - 1, tower.z, { timeout: 5000 });
    assert.ok(Math.hypot((await B.pos(a)).x - (await B.pos(b)).x, (await B.pos(a)).z - (await B.pos(b)).z) < 8, 'players met');
    await a.evaluate(() => window.DBG.setTool('gun'));
    const bId = await b.evaluate(() => window.DBG.socket.id);
    let dead = false;
    await B.look(a, 0, 0.05);
    for (let i = 0; i < 24 && !dead; i++) {
      await a.evaluate((id) => {
        const P = window.DBG.player;
        const o = window.DBG.state().players.find((p: any) => p.id === id);
        window.DBG.socket.emit('shoot', { ox: P.x, oy: P.y + 1.4, oz: P.z, dx: o.x - P.x, dy: (o.y + 0.9) - (P.y + 1.4), dz: o.z - P.z });
      }, bId);
      await B.sleep(300);
      dead = (await B.me(b)).dead;
    }
    assert.ok(dead, `Zé was killed (hp ${(await B.me(b)).hp}, mina at ${JSON.stringify(await B.pos(a))}, zé at ${JSON.stringify(await B.pos(b))})`);
    assert.equal((await B.me(a)).kills, 1);
    assert.ok(await a.evaluate(() => document.querySelector('#feed')!.textContent!.includes('Zé')), 'kill feed shows the victim');
    await a.waitForFunction(() => !window.DBG.state().players.find((p: any) => p.name === 'Zé').dead, { timeout: 6000, polling: 200 });
    // Quick play from a third browser lands in this public-less world: Mina's room is locked, so a new public room is created.
    const q = await B.openPlayer(browser, url, 'Quick', { width: 320, height: 200 });
    await q.waitForSelector('#home:not(.hidden)');
    await q.type('#homeName', 'Quick');
    await q.click('#quickplay');
    await q.waitForFunction(() => window.DBG && window.DBG.state().players.length > 0, { timeout: 15000, polling: 200 });
    const qRoom = await q.evaluate(() => location.hash.replace('#r=', ''));
    assert.notEqual(qRoom, roomId, 'locked room is never picked by quick play');
    assert.match(await q.evaluate(() => document.querySelector('#lobbyRoom')?.textContent ?? ''), /Rua aberta/);
    await q.close();

    // Owner leaves: Zé inherits the room; when he leaves too the room is destroyed.
    await a.evaluate(() => window.DBG.socket.emit('leave'));
    await b.waitForFunction(() => document.querySelector('#roomBadge')?.textContent, { timeout: 5000, polling: 200 });
    await B.sleep(300);
    assert.equal((await (await fetch(`${url}/api/rooms/${roomId}`)).json()).ownerId, await b.evaluate(() => window.DBG.socket.id));
    await b.evaluate(() => window.DBG.socket.emit('leave'));
    await B.sleep(300);
    assert.equal((await fetch(`${url}/api/rooms/${roomId}`)).status, 404, 'room destroyed when empty');
  } finally {
    await browser.close();
    await game.close();
  }
});
