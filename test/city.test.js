const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/city');

test('city generation is deterministic', () => {
  const a = JSON.stringify(C.generateCity());
  const b = JSON.stringify(C.generateCity());
  assert.equal(a, b);
});

test('buildings stay inside their blocks and the map', () => {
  for (const b of C.generateCity()) {
    assert.ok(b.x - b.w / 2 >= C.STREET - 0.01, 'min x');
    assert.ok(b.x + b.w / 2 <= C.MAP_SIZE - C.STREET + 0.01, 'max x');
    assert.ok(b.z - b.d / 2 >= C.STREET - 0.01, 'min z');
    assert.ok(b.z + b.d / 2 <= C.MAP_SIZE - C.STREET + 0.01, 'max z');
    assert.ok(b.h >= 4 && b.h <= 40);
    assert.ok(['tower', 'house', 'shop'].includes(b.kind));
  }
});

test('buildings do not overlap each other', () => {
  const bs = C.generateCity();
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
    assert.ok(!overlap, `buildings ${i} and ${j} overlap`);
  }
});

test('spawn points are on streets, unique and not inside buildings', () => {
  const spawns = C.spawnPoints();
  assert.equal(spawns.length, 12);
  assert.equal(new Set(spawns.map((s) => `${s.x},${s.z}`)).size, 12);
  for (const s of spawns) {
    for (const b of C.generateCity()) {
      const inside = Math.abs(s.x - b.x) < b.w / 2 + 1 && Math.abs(s.z - b.z) < b.d / 2 + 1;
      assert.ok(!inside, 'spawn inside building');
    }
  }
});

test('pickups never share a spot with a spawn and rooftop pickups sit on their building', () => {
  const spawnKeys = new Set(C.spawnPoints().map((s) => `${s.x},${s.z}`));
  const city = C.generateCity();
  const pks = C.pickupPoints();
  assert.ok(pks.length >= 10);
  for (const pk of pks) {
    assert.ok(!spawnKeys.has(`${pk.x},${pk.z}`));
    if (pk.roof !== undefined) {
      const b = city[pk.roof];
      assert.equal(pk.y, b.h);
      assert.equal(pk.x, b.x);
      assert.equal(pk.z, b.z);
    } else {
      assert.equal(pk.y, 0);
    }
  }
});

test('tile centers lie on the building face and keys round-trip', () => {
  const city = C.generateCity();
  city.forEach((b, bi) => {
    for (let face = 0; face < 4; face++) {
      const { cols, rows } = C.faceInfo(b, face);
      assert.ok(cols >= 1 && rows >= 1);
      const c = C.tileCenter(b, face, cols - 1, rows - 1);
      if (face === 0) assert.equal(c.x, b.x + b.w / 2);
      if (face === 1) assert.equal(c.x, b.x - b.w / 2);
      if (face === 2) assert.equal(c.z, b.z + b.d / 2);
      if (face === 3) assert.equal(c.z, b.z - b.d / 2);
      assert.ok(c.y > 0 && c.y < b.h);
      const key = C.tileKey(bi, face, cols - 1, rows - 1);
      assert.deepEqual(C.parseKey(key), { bi, face, i: cols - 1, j: rows - 1 });
    }
  });
});

test('parseKey rejects garbage', () => {
  assert.equal(C.parseKey('a:b:c:d'), null);
  assert.equal(C.parseKey('1:2:3'), null);
  assert.equal(C.parseKey('1.5:2:3:4'), null);
});

test('higher tiles are worth more', () => {
  assert.equal(C.tileValue(0), 1);
  assert.ok(C.tileValue(10) > C.tileValue(0));
  assert.ok(C.tileValue(20) >= C.tileValue(10));
});
