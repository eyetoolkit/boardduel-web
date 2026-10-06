/**
 * kg-features 输入维度对账单元测试
 *
 * 背景：kg-features.mjs 曾经把 SPATIAL=22 / GLOBAL=19 写死。这在只跑 b6c96 时
 * 完全正常，但换任何 conv1.inC 不同的权重就只在**第一次前向**时抛
 * "depth of input (N) must match input depth for filter 22" —— 报错点离根因
 * （编码器写死了平面数）极难关联。
 *
 * 现在维度从模型头读，并由 resolveInputDims() 与主干第一层交叉校验。本测试
 * 锁三件事：
 *   1. V7 布局常量与上游 nninputs.h 一致（22/19）
 *   2. 不兼容布局**早失败且报错指名**，而不是拖到 tf.conv2d
 *   3. 头与主干不一致时报出来（解析器读错头的场景）
 *   4. fillInputsV7 的平面步长从缓冲长度反推，缓冲不足时立刻报错
 *
 * 运行：node --test tests/go-katago-dims.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LIB = new URL('../public/games/go/lib/', import.meta.url);
const { SPATIAL, GLOBAL, resolveInputDims, fillInputsV7 } = await import(
  new URL('kg-features.mjs', LIB).href
);

/** 造一个最小可用的「模型头」，dims 决定平面数，convIn/ginput 可故意不一致。 */
function fakeModel({ spatial = 22, global = 19, convIn, ginput, name = 'fake', ver = 8 } = {}) {
  return {
    modelName: name,
    modelVersion: ver,
    numInputChannels: spatial,
    numInputGlobalChannels: global,
    conv1: { inC: convIn ?? spatial },
    ginput: { inC: ginput ?? global },
  };
}

test('V7 布局常量与上游 nninputs.h 一致（22 spatial / 19 global）', () => {
  assert.equal(SPATIAL, 22, 'NUM_FEATURES_SPATIAL_V7');
  assert.equal(GLOBAL, 19, 'NUM_FEATURES_GLOBAL_V7');
});

test('上游 8~16 号模型格式全部落在 V7 布局，resolveInputDims 直接放行', () => {
  // 官方 docs/NetworkArchitectures.md 里的整档：b6c96/b10c128/b15c192/b20c256 = v8，
  // b18c384nbt = v14，b28c512nbt = v15 —— spatial 全是 22。
  for (const [name, ver] of [
    ['g170-b6c96', 8], ['g170e-b10c128', 8], ['g170-b15c192', 8],
    ['g170e-b20c256x2', 8], ['kata1-b18c384nbt', 14], ['kata1-b28c512nbt', 15],
  ]) {
    const d = resolveInputDims(fakeModel({ name, ver }));
    assert.equal(d.spatial, 22, name);
    assert.equal(d.global, 19, name);
    assert.equal(d.layout, 'V7', name);
  }
});

test('非 V7 布局早失败，且报错要指名是哪个模型 / 期望多少', () => {
  // V6 = 22/16。上游存在这种布局，但本移植没实现 —— 必须在这里挡住。
  assert.throws(
    () => resolveInputDims(fakeModel({ name: 'ancient-v6', ver: 8, global: 16 })),
    (e) => {
      assert.match(e.message, /ancient-v6/, '报错要指名模型');
      assert.match(e.message, /22 spatial \/ 16 global/, '报错要写实际期望值');
      assert.match(e.message, /V7/, '报错要点明本移植只支持 V7');
      return true;
    },
  );
  // V5 = 13/12，平面数不同，更不能混。
  assert.throws(() => resolveInputDims(fakeModel({ name: 'v5', ver: 8, spatial: 13, global: 12 })), /13 spatial/);
});

test('头与主干第一层不一致时报错（解析器读错头的场景）', () => {
  assert.throws(
    () => resolveInputDims(fakeModel({ name: 'skewed', convIn: 16 })),
    /header inconsistent.*conv1\.inC=16/s,
  );
  assert.throws(
    () => resolveInputDims(fakeModel({ name: 'skewed2', ginput: 17 })),
    /ginput\.inC=17/,
  );
});

test('模型头缺字段时报错，而不是返回 undefined 让下游 NaN', () => {
  assert.throws(() => resolveInputDims({ modelName: 'broken', modelVersion: 8 }), /no usable input dims/);
  assert.throws(() => resolveInputDims(null), /no usable input dims/);
});

test('fillInputsV7 的平面步长从缓冲长度反推：缓冲不足立刻报错', () => {
  const N = 19 * 19;
  const board = new Uint8Array(N);
  // 21 个平面装不下 22 平面布局 —— 以前这会越界写或静默截断。
  assert.throws(
    () => fillInputsV7({ board, toPlay: 1, xSize: 19, ySize: 19 },
      new Float32Array(N * 21), new Float32Array(GLOBAL)),
    /cannot hold 361 positions x >=22 planes/,
  );
  assert.throws(
    () => fillInputsV7({ board, toPlay: 1, xSize: 19, ySize: 19 },
      new Float32Array(N * SPATIAL), new Float32Array(GLOBAL - 1)),
    /global buffer 18 < 19/,
  );
});

test('fillInputsV7 正常路径：on-board 平面全 1，其余按布局写', () => {
  const N = 19 * 19;
  const board = new Uint8Array(N);
  board[0] = 1;                       // 黑子放 (0,0)
  board[19 * 5 + 5] = 2;              // 白子放 (5,5)
  const S = new Float32Array(N * SPATIAL);
  const G = new Float32Array(GLOBAL);
  const info = fillInputsV7({ board, toPlay: 1, komi: 7.5, koLoc: -1, xSize: 19, ySize: 19 }, S, G);
  // 平面 0（on-board）361 个点全 1
  for (let p = 0; p < N; p++) assert.equal(S[p * SPATIAL + 0], 1, `plane0 @${p}`);
  // 平面 1 = 自己（黑）只有 (0,0)
  assert.equal(S[0 * SPATIAL + 1], 1);
  assert.equal(S[(19 * 5 + 5) * SPATIAL + 1], 0);
  // 平面 2 = 对手（白）只有 (5,5)
  assert.equal(S[(19 * 5 + 5) * SPATIAL + 2], 1);
  // G[5] = selfKomi/20，黑行棋 selfKomi = -komi
  assert.ok(Math.abs(G[5] - (-7.5 / 20)) < 1e-6, `G5=${G[5]}`);
  assert.equal(info.turns, 0, '无历史时 turns=0');
  // 没有子被写成 22 平面之外 —— 越界写会静默污染相邻点
  for (let p = 0; p < N; p++) {
    for (let c = 20; c < SPATIAL; c++) {
      assert.equal(S[p * SPATIAL + c], 0, `plane${c} @${p} 应为 0（encore 相关）`);
    }
  }
});

test('生产 lib 与 spike 实验副本的 kg-features 保持一致（防止只改一份）', () => {
  // 两份文件必须逐字相同：spike 用来跑官方对照门禁，生产是线上真正加载的那份。
  // 只改其一会让「门禁全绿」失去意义（红线：自洽 ≠ 正确）。
  const prod = readFileSync(new URL('kg-features.mjs', LIB), 'utf8');
  const spikeUrl = new URL(
    '../../../游戏检测/_spike-katago-b6c96/lib/kg-features.mjs', import.meta.url,
  );
  let spike;
  try {
    spike = readFileSync(spikeUrl, 'utf8');
  } catch {
    return;   // spike 目录不在本仓（例如 CI / 部署机），跳过
  }
  assert.equal(spike, prod, 'spike/lib 与 public/games/go/lib 的 kg-features.mjs 不一致');
});
