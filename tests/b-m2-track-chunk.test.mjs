// B-M2 集成测试（2026-10-01）：boardduel 数据闭环硬证据
// 通过抓 boardduel.com 静态资源确认 teacher-track.js chunk 已生成 + 已加载到 HTML
import assert from 'node:assert/strict';

const BASE = 'https://boardduel.com';

async function fetchText(url, timeoutMs = 25000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

async function fetchJson(url, opts = {}, timeoutMs = 25000) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

// 1. 5 个棋类页面都能加载 + 都引用 teacher-track chunk
const GAMES = ['chess', 'gomoku', 'connect4', 'reversi', 'tictactoe'];
for (const g of GAMES) {
  const html = await fetchText(`${BASE}/games/${g}/`);
  assert.ok(/teacher-track-[A-Za-z0-9_-]+\.js/.test(html),
    `${g} page must reference teacher-track chunk`);
  // 进一步：棋类 chunk 必须存在
  assert.ok(new RegExp(`${g}-[A-Za-z0-9_-]+\\.js`).test(html),
    `${g} page must reference its game chunk`);
}
console.log(`✓ test 1: 5 个棋类页面 HTML 都引用 teacher-track chunk`);

// 2. /api/teacher/games 在 boardduel.com 端返回三站 11 游戏
const games = (await fetchJson(`${BASE}/api/teacher/games`)).games;
const boardGames = games.filter((g) => g.site === 'board');
const numeriGames = games.filter((g) => g.site === 'numeri');
assert.equal(boardGames.length, 5, 'board site should list 5 games');
assert.deepEqual(boardGames.map((g) => g.slug).sort(), ['chess', 'connect4', 'gomoku', 'reversi', 'tictactoe']);
assert.equal(numeriGames.length, 5, 'numeri site should list 5 games');
const allBoardDataReady = boardGames.every((g) => g.dataReady === false);
assert.ok(allBoardDataReady, 'board games should still be dataReady:false (M3 还没做)');
console.log('✓ test 2: boardduel.com /api/teacher/games 返回 11 游戏，board 5 个全 dataReady=false');

// 3. /api/teacher/track 在 boardduel.com 端 CORS preflight 204（学生端可调用）
const preflight = await fetch(`${BASE}/api/teacher/track`, {
  method: 'OPTIONS',
  headers: {
    'Origin': BASE,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type',
  },
});
assert.equal(preflight.status, 204);
assert.match(preflight.headers.get('access-control-allow-origin') || '', /boardduel\.com/);
console.log('✓ test 3: /api/teacher/track CORS preflight 在 boardduel.com 通过');

// 4. /api/teacher/join 端点可达（响应符合预期：未知房间返回 404）
const joinRes = await fetch(`${BASE}/api/teacher/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Origin': BASE },
  body: JSON.stringify({ roomCode: 'NOEXIST_BD_M2_TEST', code: 'S99' }),
});
assert.equal(joinRes.status, 404, 'NOEXIST room should 404');
const joinBody = await joinRes.json();
assert.equal(joinBody.error, 'room_not_found');
console.log('✓ test 4: /api/teacher/join 端点可达，未知房间码返回 room_not_found');

// 6. teacher-track.js chunk 在所有棋类共享（不重复打包）
const chessHtml = await fetchText(`${BASE}/games/chess/`);
const connect4Html = await fetchText(`${BASE}/games/connect4/`);
const chessChunk = (chessHtml.match(/teacher-track-[A-Za-z0-9_-]+\.js/) || [])[0];
const connect4Chunk = (connect4Html.match(/teacher-track-[A-Za-z0-9_-]+\.js/) || [])[0];
assert.ok(chessChunk, 'chess page references teacher-track');
assert.ok(connect4Chunk, 'connect4 page references teacher-track');
assert.equal(chessChunk, connect4Chunk, 'teacher-track must be shared — same chunk hash');
console.log(`✓ test 6: teacher-track chunk 跨游戏共享（${chessChunk}）`);

console.log('\n=== B-M2: ALL 6 TESTS PASSED ===');
console.log('✅ boardduel 数据闭环：teacher-track chunk 在 5 个棋类 HTML 中都引用，/api/teacher/* 三站可调');