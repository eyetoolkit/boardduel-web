/**
 * 共享 AI Worker 客户端 — 2026-10-23 第三批（审计项 ⑪）
 *
 * 背景：8 款游戏的 AI 搜索全部在主线程同步跑。黑白棋/中国象棋的 hard 档
 * 已到秒级冻结（点击无响应、动画卡顿、时钟停走）。本模块把 AI 搜索
 * 搬进 Web Worker，主线程只留 UI。
 *
 * 设计约束：
 * 1. **引擎是纯函数**：worker 侧 import 引擎、postMessage 进出。
 *    各游戏的薄 worker 文件（如 games/chess/ai-worker.ts）只做转发，零逻辑。
 * 2. **降级路径必存**：Worker 不可用（老浏览器 / 沙箱 / 构造抛错）时
 *    回退同步调用。AI 卡顿远比"worker 加载失败"轻微，不能因为没有
 *    worker 就让 AI 完全不工作。
 * 3. **请求必须幂等**：同一局里旧请求可能晚于新请求回来（ worker 卡顿后
 *    恢复），调用方用 state.aiThinking / 守卫丢弃过期结果——本模块只保证
 *    单次请求的 resolve/reject 语义。
 * 4. **超时兜底**：worker 卡死（死循环 bug）时不能让页面永远转圈。
 *    超时后 reject，调用方回退同步（或显示错误），绝不挂起。
 */

/** 请求：发给 worker 的消息 */
export interface AiRequest {
  /** 单调递增 id，用于把 response 对回 request */
  id: number;
  /** 引擎自定义参数（board/state/player/level…），须可结构化克隆 */
  payload: unknown;
}

/** 响应：worker 回的消息 */
export interface AiResponse {
  id: number;
  ok: boolean;
  /** 引擎返回的着法（Move 对象或格子下标），失败时为 null */
  move?: unknown;
  error?: string;
}

/** 薄 worker 的入站处理函数（由各游戏 worker 文件提供） */
export type AiWorkerHandler = (payload: unknown) => unknown;

let nextId = 1;

/**
 * 创建一次性的 AI 请求通道。
 *
 * @param workerFactory Worker 构造函数（Vite `?worker` 导入的默认导出：
 *        `import ChessAiWorker from './ai-worker.ts?worker'`）。
 *        ⚠️ 不要传 `new URL('./ai-worker.ts', import.meta.url)`——Vite 会把
 *        <4KB 的 worker 源内联成 base64 data URI，而 module worker 不接受
 *        data: URI（2026-10-23 实测：worker 从不启动、fallback 静默接管）。
 * @param payload      引擎自定义参数（board/state/player/level…），须可结构化克隆
 * @param timeoutMs    worker 无响应超时；超时后 reject 并终止 worker
 * @param syncFallback Worker 不可用/超时时的同步兜底（通常是引擎 bestMove 本身）
 * @returns 执行一次 AI 搜索的 Promise；失败时（含兜底也抛错）reject
 */
export function runAiSearch<T>(
  workerFactory: new () => Worker,
  payload: unknown,
  timeoutMs: number,
  syncFallback: () => T,
): Promise<T> {
  const id = nextId++;
  let worker: Worker | null = null;
  let settled = false;

  return new Promise<T>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (worker) {
        worker.terminate();   // 一次性通道：用完即毁，杜绝串局
        worker = null;
      }
      fn();
    };

    const timer = window.setTimeout(() => {
      finish(() => {
        // 超时：先试同步兜底。兜底也炸才 reject —— 兜底是同一份引擎代码，
        // 能跑通同步说明 worker 侧有环境问题，同步结果至少正确。
        try { resolve(syncFallback()); }
        catch (e) { reject(new Error('AI worker timeout and sync fallback failed: ' + String(e))); }
      });
    }, timeoutMs);

    try {
      worker = new workerFactory();
    } catch {
      // 构造失败（老浏览器不支持 module worker）：直接同步兜底
      finish(() => {
        try { resolve(syncFallback()); }
        catch (e) { reject(e); }
      });
      return;
    }

    worker.addEventListener('error', (ev) => {
      finish(() => {
        try { resolve(syncFallback()); }
        catch { reject(new Error('AI worker error: ' + (ev.message || 'unknown'))); }
      });
    });

    worker.addEventListener('message', (ev: MessageEvent<AiResponse>) => {
      const data = ev.data;
      if (!data || data.id !== id) return;      // 不是这一轮的结果（理论不存在，一次性通道）
      finish(() => {
        if (data.ok) resolve(data.move as T);
        else {
          // worker 侧引擎抛错：同步兜底一次；兜底失败才报错
          try { resolve(syncFallback()); }
          catch { reject(new Error(data.error || 'AI worker failed')); }
        }
      });
    });

    const req: AiRequest = { id, payload };
    worker.postMessage(req);
  });
}

/**
 * 薄 worker 侧的标准入口：把 message 转给引擎处理函数，结果回传。
 * 各游戏的 ai-worker.ts 只需：
 *   import { bestMove } from './engine';
 *   import { wireAiWorker } from '../../shared/ai-worker';
 *   wireAiWorker((p) => bestMove(p.state, p.level));
 */
export function wireAiWorker(handler: AiWorkerHandler): void {
  self.addEventListener('message', (ev: MessageEvent<AiRequest>) => {
    const { id, payload } = ev.data || {};
    if (typeof id !== 'number') return;
    try {
      const move = handler(payload);
      const res: AiResponse = { id, ok: true, move };
      (self as unknown as Worker).postMessage(res);
    } catch (e) {
      const res: AiResponse = { id, ok: false, error: String(e) };
      (self as unknown as Worker).postMessage(res);
    }
  });
}
