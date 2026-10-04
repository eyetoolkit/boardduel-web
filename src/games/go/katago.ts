/**
 * KataGo b6c96 神经网络 AI —— 浏览器内推理（第三档「最难」）
 *
 * ═══ 为什么单独一个模块 ═══
 * ai.ts 的 easy/medium/hard 是**纯规则、零依赖、毫秒级**。本档不同：
 *   · 需要下载 TF.js 运行时（~1.1 MB，含 webgl/cpu 后端）
 *   · 需要下载模型权重 b6c96.bin.gz（3.7 MB）
 *   · 前向是**异步**的（WebGL），单手 15.6 ms（真机 GPU）/ 1022 ms（CPU 回退）
 * 所以它不能塞进 ai.ts 的同步 bestMove 契约里，必须独立成异步模块。
 *
 * ═══ 正确性基线 ═══
 * 本模块的编码器 / 面积计算 / 前向已与官方 KataGo v1.18.1 二进制逐点对照：
 * 9/13/19 三尺寸 × 黑白行棋，win/score/policy/ownership 全部吻合到 1e-6 量级。
 * 唯一残留偏差：真角点（A19/T1/A1/T19）有子时 win 最多偏 3.4e-2。
 * 门禁：_spike-katago-b6c96/tools/verify-sizes.cjs（退出码 0）。
 *
 * ═══ 棋规一致性 ═══
 * 采样只在 engine.legalMoves() 给出的合法点里进行，劫 / 自杀 / 超级劫的判定
 * **完全交给 boardduel 引擎**，本模块不重复实现，避免两套规则打架。
 */
import { legalMoves, type GoState, type Player } from './engine';

const BASE = '/games/go';
const TFJS = `${BASE}/lib`;
const MODEL = `${BASE}/model/b6c96.bin.gz`;

/** 采样温度。实测 0.30 时 KataGo 在 9×9 上 6/6 胜 W6 hard。 */
const DEFAULT_TEMP = 0.30;

type Tf = any;

export interface KatagoStatus {
  /** 是否已可推理（模型已加载且后端就绪） */
  ready: boolean;
  /** 正在加载 */
  loading: boolean;
  /** 实际使用的后端名（webgl / webgpu / cpu） */
  backend: string;
  /** 失败原因（若有），可直接展示给用户 */
  error: string | null;
}

type Progress = (msg: string) => void;

let tfPromise: Promise<Tf> | null = null;
let kgPromise: Promise<any> | null = null;
let backendName = '';
let lastError: string | null = null;

const state: KatagoStatus = { ready: false, loading: false, backend: '', error: null };

export function katagoStatus(): KatagoStatus {
  return { ...state };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/** 加载 TF.js + kg 模块并选一个能用的后端。重复调用共享同一个 Promise。 */
function bootTf(progress?: Progress): Promise<Tf> {
  if (tfPromise) return tfPromise;
  state.loading = true;
  state.error = null;

  tfPromise = (async () => {
    progress?.('tfjs');
    // core 必须先加载；后端按 webgl → cpu 顺序试，webgpu 在集显上反而更慢，不进默认链。
    await loadScript(`${TFJS}/tf-core.min.js`);
    const w = globalThis as any;
    if (!w.tf) throw new Error('tfjs core did not register window.tf');
    const tf = w.tf;

    await loadScript(`${TFJS}/tf-backend-webgl.min.js`);
    try {
      await tf.setBackend('webgl');
      await tf.ready();
      backendName = 'webgl';
    } catch {
      // WebGL 不可用（老设备 / 禁 GPU / 无头环境）→ 退到 CPU。单手会慢到 1 s 量级，
      // 但至少能玩；UI 层据此提示。
      await loadScript(`${TFJS}/tf-backend-cpu.min.js`);
      await tf.setBackend('cpu');
      await tf.ready();
      backendName = 'cpu';
    }
    return tf;
  })()
    .then(async (tf) => {
      progress?.('modules');
      const [{ KgModel }, { parseKataGoModelV8 }] = await Promise.all([
        import(/* @vite-ignore */ `${TFJS}/kg-model.mjs`),
        import(/* @vite-ignore */ `${TFJS}/kg-parse.mjs`),
      ]);
      const kg = globalThis as any;
      kg.KgModel = KgModel;
      kg.parseKataGoModelV8 = parseKataGoModelV8;
      // 面积计算模块被 kg-features 内部 import，这里挂到全局供 page 侧对齐
      if (!kg.KG_AREA) {
        try {
          kg.KG_AREA = await import(/* @vite-ignore */ `${TFJS}/kg-area.mjs`);
        } catch { /* 面积模块缺失会导致 planes 18/19 退化为空，属可接受降级 */ }
      }
      state.backend = backendName;
      return tf;
    })
    .catch((e) => {
      lastError = e instanceof Error ? e.message : String(e);
      state.error = lastError;
      tfPromise = null;      // 允许重试
      throw e;
    })
    .finally(() => { state.loading = false; });

  return tfPromise;
}

/**
 * 重建落子历史里每一手的**落子方**。
 *
 * 不能靠 `go.board[m]` 反推 —— 那是被子占据后的颜色，且让子局黑棋先摆子、白先走，
 * 黑白并非从黑开始交替。用「当前 toPlay + 剩余手数」倒推才对：
 * n 步历史之后的下一个走子方就是 go.toPlay，于是第 i 手的颜色 = toPlay 往前推 (n-1-i) 次。
 */
function buildHistory(go: GoState, moves: number[]): { player: Player; pos: number }[] {
  const played = moves.filter((m) => m >= 0);
  const n = played.length;
  const hist: { player: Player; pos: number }[] = [];
  for (let i = 0; i < n; i++) {
    // 第 i 手与下一手（i = n-1 的下一手，即 go.toPlay）之间隔了 (n-1-i) 次换手
    let c: Player = go.toPlay;
    for (let k = 0; k < n - 1 - i; k++) c = (c === 1 ? 2 : 1);
    hist.push({ player: c, pos: played[i] });
  }
  return hist;
}

/** 拉模型权重 + 解析，按需按棋盘尺寸建实例。 */
function bootKg(size: number, progress?: Progress): Promise<any> {
  if (kgPromise) return kgPromise;
  progress?.('model');
  kgPromise = (async () => {
    const tf = await bootTf(progress);
    const res = await fetch(MODEL);
    if (!res.ok) throw new Error(`model fetch failed: HTTP ${res.status}`);
    const raw = new Uint8Array(await res.arrayBuffer());
    progress?.('parse');
    const parsed = tf.tidy(() => tf.decode(raw, 'string'));
    const m = new (globalThis as any).KgModel(tf, parsed, size);
    // fillInputsV7 挂在 kg-features 上，makeInput 需要它
    const features = await import(/* @vite-ignore */ `${TFJS}/kg-features.mjs`);
    m.fillInputsV7 = features.fillInputsV7;
    m.SPATIAL = features.SPATIAL;
    m.GLOBAL = features.GLOBAL;
    m.DEFAULT_RULES = features.DEFAULT_RULES;
    state.ready = true;
    return m;
  })().catch((e) => {
    lastError = e instanceof Error ? e.message : String(e);
    state.error = lastError;
    kgPromise = null;
    throw e;
  });
  return kgPromise;
}

/**
 * 构造一次前向所需的张量。
 * 这段原本是 spike 页 KG 门面对象上的方法，集成时搬进模块内部 —— 页面胶水不该是
 * 生产代码的依赖。
 */
function forwardOnce(model: any, tf: Tf, spec: any) {
  const B = model.boardSize ?? spec.size;
  const N = B * B;
  const board = new Uint8Array(N);
  for (const [x, y, c] of spec.stones) board[y * B + x] = c;
  const spatial = new Float32Array(N * model.SPATIAL);
  const global = new Float32Array(model.GLOBAL);
  model.fillInputsV7({
    board,
    toPlay: spec.toPlay,
    moves: spec.moves,
    komi: 7.5,
    koLoc: -1,
    xSize: B,
    ySize: B,
  }, spatial, global);
  const S = Float32Array.from(spatial);
  const G = Float32Array.from(global);
  return tf.tidy(() => {
    const s = tf.tensor4d(S, [1, B, B, model.SPATIAL]);
    const g = tf.tensor2d(G, [1, model.GLOBAL]);
    return model.forward(s, g);
  });
}

/** 预热：进入第三档时先调用，让 UI 有机会显示加载态。 */
export async function warmupKatago(size: number, progress?: Progress): Promise<KatagoStatus> {
  try {
    await bootKg(size, progress);
    return katagoStatus();
  } catch {
    return katagoStatus();      // 错误已记在 state.error
  }
}

/**
 * 选一手。
 *
 * @param go       boardduel 引擎的当前局面
 * @param size     棋盘尺寸
 * @param moves    落子历史（按时间顺序，含 pass 的 -1），喂给 v7 编码器的历史平面
 * @param temp     采样温度，缺省 0.30
 * @returns 合法落点下标；无合法点时返回 -1（应 pass）
 */
export async function bestMoveKatago(
  go: GoState,
  size: number,
  moves: number[],
  temp = DEFAULT_TEMP,
  progress?: Progress,
): Promise<number> {
  const legal = legalMoves(go);
  if (legal.length === 0) return -1;

  const model = await bootKg(size, progress);
  const tf = (globalThis as any).tf;

  // v7 编码器要的是 [x, y, color] 的棋子列表 + 落子历史
  const stones: [number, number, Player][] = [];
  for (let i = 0; i < go.board.length; i++) {
    const c = go.board[i];
    if (c === 0) continue;
    stones.push([i % size, Math.floor(i / size), c as Player]);
  }
  const hist = buildHistory(go, moves);

  const out = forwardOnce(model, tf, { stones, toPlay: go.toPlay, moves: hist, size });

  // 采样：只在合法点上做温度 softmax，再按概率抽一手
  const n = size * size;
  const logits = out.policy.dataSync() as Float32Array;
  const passLogit = (out.policyPass.dataSync() as Float32Array)[0];
  const legalMask = new Uint8Array(n);
  for (const i of legal) legalMask[i] = 1;

  let mx = -Infinity;
  for (let i = 0; i < n; i++) if (legalMask[i] && logits[i] > mx) mx = logits[i];
  if (passLogit > mx) mx = passLogit;

  const w = new Float64Array(n + 1);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (!legalMask[i]) continue;
    const v = Math.exp((logits[i] - mx) / temp);
    w[i] = v; sum += v;
  }
  w[n] = Math.exp((passLogit - mx) / temp); sum += w[n];

  let r = Math.random() * sum;
  for (let i = 0; i < n; i++) {
    if (!legalMask[i]) continue;
    r -= w[i];
    if (r <= 0) return i;
  }
  // 理论上不可达（r 已被 pass 权重截断），兜底取第一合法点
  return legal[0];
}

/** 局面评估（给 UI 用的胜率/目数），失败返回 null。 */
export async function evaluateKatago(
  go: GoState,
  size: number,
  moves: number[],
  progress?: Progress,
): Promise<{ winProbWhite: number; scoreWhite: number } | null> {
  try {
    const model = await bootKg(size, progress);
    const tf = (globalThis as any).tf;
    const stones: [number, number, Player][] = [];
    for (let i = 0; i < go.board.length; i++) {
      const c = go.board[i];
      if (c === 0) continue;
      stones.push([i % size, Math.floor(i / size), c as Player]);
    }
    const hist = buildHistory(go, moves);

    const out = forwardOnce(model, tf, { stones, toPlay: go.toPlay, moves: hist, size });
    const v = Array.from(out.value.dataSync() as Float32Array);
    const mx = Math.max(...v);
    const ev = v.map((x) => Math.exp(x - mx));
    const sum = ev.reduce((a, b) => a + b, 0);
    const sv = out.scoreValue.dataSync() as Float32Array;
    return {
      winProbWhite: (go.toPlay === 1 ? ev[1] : ev[0]) / sum,
      scoreWhite: (go.toPlay === 1 ? -1 : 1) * sv[0] * 20,
    };
  } catch {
    return null;
  }
}
