// End-to-end: real Chrome (headless) drives two clients through lobby, walking,
// painting, climbing and a kill. Run with `npm run test:e2e` (needs Chrome).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../server');
const C = require('../shared/city');
const B = require('../tools/browser');

const chrome = B.findChrome();

test('two browsers play a round: lobby → paint → climb → kill', { skip: !chrome && 'Chrome not found (set CHROME_PATH)', timeout: 240000 }, async () => {
  const game = createGame({ port: 0, quiet: true, countdownSeconds: 0.5, matchSeconds: 600 });
  await game.ready;
  const url = `http://localhost:${game.port}`;
  const browser = await B.launch({ width: 640, height: 360 });
  try {
    const a = await B.openPlayer(browser, url, 'Mina', { width: 320, height: 200 });
    const b = await B.openPlayer(browser, url, 'Zé', { width: 320, height: 200 });
    assert.equal(await B.phase(a), 'lobby');
    await B.ready(a);
    await B.sleep(300);
    assert.equal(await B.phase(a), 'lobby', 'waits for everyone');
    await B.ready(b);
    await B.waitPhase(a, 'playing');
    await B.sleep(1600); // respawn grace

    // Walking obeys physics and the server accepts it (no corrections).
    await a.evaluate(() => { window.corr = []; window.DBG.socket.on('correct', (d) => window.corr.push(d.reason)); });
    const tower = C.generateCity()[25];
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
    assert.ok(await b.evaluate(() => window.DBG.state().players.some((p) => p.tiles > 0)), 'other client sees the score');

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
    for (let i = 0; i < 12 && !dead; i++) {
      await a.evaluate((id) => {
        const P = window.DBG.player;
        const o = window.DBG.state().players.find((p) => p.id === id);
        window.DBG.socket.emit('shoot', { ox: P.x, oy: P.y + 1.4, oz: P.z, dx: o.x - P.x, dy: (o.y + 0.9) - (P.y + 1.4), dz: o.z - P.z });
      }, bId);
      await B.sleep(300);
      dead = (await B.me(b)).dead;
    }
    assert.ok(dead, 'Zé was killed');
    assert.equal((await B.me(a)).kills, 1);
    assert.ok(await a.evaluate(() => document.querySelector('#feed').textContent.includes('Zé')), 'kill feed shows the victim');
    await a.waitForFunction(() => !window.DBG.state().players.find((p) => p.name === 'Zé').dead, { timeout: 6000, polling: 200 });
  } finally {
    await browser.close();
    await game.close();
  }
});
